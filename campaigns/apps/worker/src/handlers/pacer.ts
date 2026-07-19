// Pacer: um job auto-reagendável por run ativo. Cada passo pega a mensagem
// 'queued' mais antiga do run, escolhe uma conexão saudável (round-robin),
// enfileira o envio e se reagenda com intervalo aleatório do preset de
// velocidade. Pause/resume/cancel são observados a cada passo — o estado no
// Postgres é a única fonte da verdade; o Redis guarda no máximo um job de
// controle por run.

import { db, campaigns, campaignRuns, campaignMessages, campaignConnections, campaignVariants, campaignVariantMedia, mediaAssets, connections, contacts, entitlements, automationEnrollments, workspaces } from '@naia/db'
import { eq, and, sql, asc, desc, inArray } from 'drizzle-orm'
import { getQueue, QUEUES, defaultJobOptions, getOutboundQueueName } from '@naia/queue'
import type { PacerJob, SendMessageJob, Schedule, Speed, MediaRef, SpeedChannel } from '@naia/schemas'
import { notifyWorkspaceOwner } from '../lib/vianova-notifications'
import {
  isWithinWorkingHours,
  nextWindowStart,
  startOfNextDay,
  randomIntervalMs,
  burstPauseMs,
  renderTemplate,
  DEFAULT_TIMEZONE,
} from '@naia/scheduling'

const TERMINAL_RUN = ['completed', 'failed', 'cancelled', 'skipped_quota'] as const

const NAIA_WEB_URL = () => process.env.NAIA_WEB_URL ?? 'http://localhost:3001'

// Sem conexão saudável o run estaciona e reavalia — só falha de vez após o teto.
// Cobre queda de conexão no meio do envio (ex: WhatsApp reconectando).
const NO_CONNECTION_RETRY_MS = 60_000
const NO_CONNECTION_MAX_WAIT_MS = 6 * 60 * 60 * 1000

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export async function enqueuePacerStep(runId: string, campaignId: string, sentInBurst: number, delayMs: number, noConnSince?: number): Promise<void> {
  await db
    .update(campaignRuns)
    .set({ nextPacerAt: new Date(Date.now() + delayMs), updatedAt: new Date() })
    .where(eq(campaignRuns.id, runId))
  await getQueue<PacerJob>(QUEUES.CAMPAIGN_PACER).add(
    `pacer:${runId}:${Date.now()}`,
    { runId, campaignId, sentInBurst, noConnSince },
    { ...defaultJobOptions, delay: delayMs, removeOnComplete: { count: 100 } },
  )
}

export async function handlePacerStep(job: PacerJob): Promise<void> {
  const { runId, campaignId } = job
  const now = new Date()

  const [run] = await db.select().from(campaignRuns).where(eq(campaignRuns.id, runId)).limit(1)
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  if (!run || !campaign) return
  if ((TERMINAL_RUN as readonly string[]).includes(run.status)) return

  // Pausa/cancelamento: sai sem se reagendar (resume re-enfileira o pacer)
  if (campaign.status === 'paused' || campaign.status === 'cancelled' || run.status === 'paused') {
    if (run.status === 'running' && campaign.status === 'paused') {
      await db.update(campaignRuns).set({ status: 'paused', nextPacerAt: null, updatedAt: now }).where(eq(campaignRuns.id, runId))
    }
    return
  }

  const schedule = parseJson<Schedule>(campaign.scheduleJson, { type: 'immediate' })
  const speed = parseJson<Speed>(campaign.speedJson, { preset: 'medio' })
  const tz = campaign.timezone || DEFAULT_TIMEZONE

  // Janela de funcionamento: estaciona até a próxima abertura
  if (!isWithinWorkingHours(schedule, now, tz)) {
    const windowStart = nextWindowStart(schedule, now, tz)
    const delay = Math.max(windowStart.getTime() - now.getTime(), 30_000) + Math.floor(Math.random() * 30_000)
    console.log(`[pacer] run ${runId} fora da janela de envio — retomando em ${Math.round(delay / 60000)}min`)
    await enqueuePacerStep(runId, campaignId, job.sentInBurst, delay)
    return
  }

  // Teto diário: excedente rola para a próxima janela do dia seguinte
  if (schedule.dailyCap) {
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS c FROM campaign_messages
      WHERE campaign_id = ${campaignId}
        AND sent_at IS NOT NULL
        AND ((sent_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date = (now() AT TIME ZONE ${tz})::date
    `)) as unknown as Array<{ c: number }>
    const sentToday = rows[0]?.c ?? 0
    if (sentToday >= schedule.dailyCap) {
      const nextDay = startOfNextDay(now, tz)
      const target = nextWindowStart(schedule, nextDay, tz)
      const delay = Math.max(target.getTime() - now.getTime(), 60_000)
      console.log(`[pacer] run ${runId} atingiu o teto diário (${schedule.dailyCap}) — retomando em ${Math.round(delay / 3_600_000)}h`)
      await enqueuePacerStep(runId, campaignId, 0, delay)
      return
    }
  }

  // Créditos esgotados no meio do run: falha o restante e conclui
  const [ent] = await db.select({ creditsBalance: entitlements.creditsBalance, tier: entitlements.tier }).from(entitlements).where(eq(entitlements.workspaceId, campaign.workspaceId)).limit(1)
  if (ent && ent.creditsBalance <= 0) {
    const failed = await db
      .update(campaignMessages)
      .set({ status: 'failed', failureReason: 'Créditos de disparo esgotados.', updatedAt: now })
      .where(and(eq(campaignMessages.runId, runId), eq(campaignMessages.status, 'queued')))
      .returning({ id: campaignMessages.id })
    if (failed.length > 0) {
      await db.update(campaignRuns).set({ failedCount: sql`${campaignRuns.failedCount} + ${failed.length}`, updatedAt: now }).where(eq(campaignRuns.id, runId))
      await db.update(campaigns).set({ failedCount: sql`${campaigns.failedCount} + ${failed.length}`, updatedAt: now }).where(eq(campaigns.id, campaignId))
    }
    await notifyWorkspaceOwner(campaign.workspaceId, {
      type: 'product',
      title: 'Créditos de disparo esgotados',
      body: `A campanha "${campaign.name}" foi interrompida porque os créditos do workspace acabaram.`,
      actionUrl: `${NAIA_WEB_URL()}/${campaign.workspaceId}/billing`,
      actionLabel: 'Adicionar créditos',
      metadata: { campaignId, campaignName: campaign.name, reason: 'credits_exhausted' },
    }, 'emailOnCreditsExhausted')
    await completeRun(runId, campaignId)
    return
  }

  // Claim atômico da próxima mensagem (skip locked protege contra pacer duplicado)
  const claimedRows = (await db.execute(sql`
    UPDATE campaign_messages SET status = 'sending', updated_at = now()
    WHERE id = (
      SELECT id FROM campaign_messages
      WHERE run_id = ${runId} AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, contact_id AS "contactId", variant_id AS "variantId", channel
  `)) as unknown as Array<{ id: string; contactId: string; variantId: string | null; channel: 'whatsapp' | 'telegram' | null }>

  const claimed = claimedRows[0]
  if (!claimed) {
    // Sem fila: espera os envios em trânsito antes de concluir
    const [inflight] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignMessages)
      .where(and(eq(campaignMessages.runId, runId), eq(campaignMessages.status, 'sending')))
    if ((inflight?.count ?? 0) > 0) {
      await enqueuePacerStep(runId, campaignId, job.sentInBurst, 5_000)
      return
    }
    await completeRun(runId, campaignId)
    return
  }

  const channel = claimed.channel ?? (campaign.channel === 'telegram' ? 'telegram' : 'whatsapp')

  // Conexões saudáveis da campanha, round-robin por canal
  const connRows = await db
    .select({ connection: connections })
    .from(campaignConnections)
    .innerJoin(connections, eq(campaignConnections.connectionId, connections.id))
    .where(eq(campaignConnections.campaignId, campaignId))
    .orderBy(asc(campaignConnections.position))
  const healthyAll = connRows.map((r) => r.connection).filter((c) => c.status === 'active')
  const healthyForChannel = healthyAll.filter((c) => c.channel === channel)

  if (healthyAll.length === 0) {
    // Estaciona o run até a conexão voltar (reconexão do WhatsApp, instabilidade):
    // devolve a mensagem reivindicada à fila e reavalia a cada minuto, até o teto.
    const since = job.noConnSince ?? Date.now()
    if (Date.now() - since < NO_CONNECTION_MAX_WAIT_MS) {
      await db.update(campaignMessages).set({ status: 'queued', updatedAt: now }).where(eq(campaignMessages.id, claimed.id))
      console.warn(`[pacer] run ${runId} sem conexão ativa — aguardando reconexão (desde ${new Date(since).toISOString()})`)
      await enqueuePacerStep(runId, campaignId, job.sentInBurst, NO_CONNECTION_RETRY_MS, since)
      return
    }
    // Teto de espera estourado — invariante: erro de conexão reflete no status da campanha
    await db.update(campaignMessages).set({ status: 'failed', failureReason: 'Nenhuma conexão ativa disponível.', updatedAt: now })
      .where(and(eq(campaignMessages.runId, runId), inArray(campaignMessages.status, ['queued', 'sending'])))
    const [counts] = await db
      .select({ failed: sql<number>`count(*) filter (where status = 'failed')::int` })
      .from(campaignMessages)
      .where(eq(campaignMessages.runId, runId))
    await db.update(campaignRuns).set({
      status: 'failed',
      skipReason: 'Nenhuma conexão ativa disponível.',
      failedCount: counts?.failed ?? run.failedCount,
      completedAt: now,
      nextPacerAt: null,
      updatedAt: now,
    }).where(eq(campaignRuns.id, runId))
    await db.update(campaigns).set({ status: 'failed', nextRunAt: null, completedAt: now, updatedAt: now }).where(eq(campaigns.id, campaignId))
    await notifyWorkspaceOwner(campaign.workspaceId, {
      type: 'product',
      title: 'Campanha falhou: sem conexão ativa',
      body: `A campanha "${campaign.name}" falhou porque nenhuma conexão ativa ficou disponível após várias tentativas.`,
      actionUrl: `${NAIA_WEB_URL()}/${campaign.workspaceId}/connections`,
      actionLabel: 'Ver conexões',
      metadata: { campaignId, campaignName: campaign.name, reason: 'no_active_connection' },
    }, 'emailOnCampaignFailed')
    console.error(`[pacer] run ${runId} falhou — nenhuma conexão ativa`)
    return
  }

  if (healthyForChannel.length === 0) {
    // Canal do contato sem conexão saudável: mesma espera estacionada do caso
    // geral (campanha mista com um canal fora aguarda junto — raro e mais
    // seguro do que falhar a mensagem na hora)
    const since = job.noConnSince ?? Date.now()
    if (Date.now() - since < NO_CONNECTION_MAX_WAIT_MS) {
      await db.update(campaignMessages).set({ status: 'queued', updatedAt: now }).where(eq(campaignMessages.id, claimed.id))
      console.warn(`[pacer] run ${runId} sem conexão ${channel} ativa — aguardando reconexão`)
      await enqueuePacerStep(runId, campaignId, job.sentInBurst, NO_CONNECTION_RETRY_MS, since)
      return
    }
    await markMessageFailed(claimed.id, runId, campaignId, `Nenhuma conexão ${channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'} ativa disponível.`)
    await enqueuePacerStep(runId, campaignId, job.sentInBurst, 1_000)
    return
  }

  const [freshRun] = await db
    .select({ sent: campaignRuns.sentCount, failed: campaignRuns.failedCount })
    .from(campaignRuns)
    .where(eq(campaignRuns.id, runId))
    .limit(1)
  const rotation = (freshRun?.sent ?? 0) + (freshRun?.failed ?? 0)
  const connection = healthyForChannel[rotation % healthyForChannel.length]!

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, claimed.contactId)).limit(1)
  if (!contact) {
    await markMessageFailed(claimed.id, runId, campaignId, 'Contato não encontrado.')
    await enqueuePacerStep(runId, campaignId, job.sentInBurst, 1_000)
    return
  }

  // Variante + mídia (rotação foi atribuída na criação das mensagens)
  let body = ''
  let media: MediaRef[] = []
  if (claimed.variantId) {
    const [variant] = await db.select().from(campaignVariants).where(eq(campaignVariants.id, claimed.variantId)).limit(1)
    if (variant) {
      body = variant.body
      const mediaRows = await db
        .select({ asset: mediaAssets, position: campaignVariantMedia.position })
        .from(campaignVariantMedia)
        .innerJoin(mediaAssets, eq(campaignVariantMedia.mediaAssetId, mediaAssets.id))
        .where(eq(campaignVariantMedia.variantId, variant.id))
      media = mediaRows
        .sort((a, b) => a.position - b.position)
        .map((m) => ({ storageKey: m.asset.storageKey, mimeType: m.asset.mimeType, kind: m.asset.kind, filename: m.asset.filename }))
    }
  }
  if (!body) {
    const [firstVariant] = await db
      .select()
      .from(campaignVariants)
      .where(eq(campaignVariants.campaignId, campaignId))
      .orderBy(asc(campaignVariants.position))
      .limit(1)
    body = firstVariant?.body ?? ''
  }
  if (!body && media.length === 0) {
    await markMessageFailed(claimed.id, runId, campaignId, 'Campanha sem conteúdo de mensagem.')
    await enqueuePacerStep(runId, campaignId, job.sentInBurst, 1_000)
    return
  }

  await db.update(campaignMessages).set({ connectionId: connection.id, updatedAt: now }).where(eq(campaignMessages.id, claimed.id))

  // Decremento atômico — o crédito é consumido ao despachar, não ao entregar.
  // GREATEST evita saldo negativo em caso de corrida entre pacers paralelos.
  await db
    .update(entitlements)
    .set({ creditsBalance: sql`GREATEST(${entitlements.creditsBalance} - 1, 0)`, updatedAt: now })
    .where(eq(entitlements.workspaceId, campaign.workspaceId))

  // Campanha de automação: variáveis do evento que inscreveu o contato na
  // régua (ex: {{cart_url}} do webhook) entram como custom fields na renderização
  let templateContact = contact
  if (campaign.automationId) {
    const [enrollment] = await db
      .select({ contextJson: automationEnrollments.contextJson })
      .from(automationEnrollments)
      .where(and(eq(automationEnrollments.automationId, campaign.automationId), eq(automationEnrollments.contactId, contact.id)))
      .orderBy(desc(automationEnrollments.createdAt))
      .limit(1)
    if (enrollment) {
      const context = parseJson<Record<string, unknown>>(enrollment.contextJson, {})
      const custom = parseJson<Record<string, string>>(contact.customFields, {})
      for (const [key, value] of Object.entries(context)) {
        if (value !== null && value !== undefined) custom[key] = String(value)
      }
      templateContact = { ...contact, customFields: JSON.stringify(custom) }
    }
  }

  const content = renderTemplate(body, templateContact)
  const queue = getQueue<SendMessageJob>(getOutboundQueueName(channel as 'whatsapp' | 'telegram', campaign.workspaceId, ent?.tier))
  await queue.add(
    `send:${claimed.id}`,
    {
      campaignId,
      campaignMessageId: claimed.id,
      contactId: contact.id,
      channel,
      connectionId: connection.id,
      content,
      kind: 'campaign',
      runId,
      variantId: claimed.variantId ?? undefined,
      media: media.length > 0 ? media : undefined,
    },
    // BullMQ 5 não aceita ':' em jobId customizado
    { ...defaultJobOptions, jobId: `send-${claimed.id}` },
  )

  // Pausa de rajada ou intervalo aleatório do preset
  const sentInBurst = job.sentInBurst + 1
  if (speed.pauseEveryN && sentInBurst >= speed.pauseEveryN) {
    const pause = burstPauseMs(speed)
    console.log(`[pacer] run ${runId} — pausa de rajada de ${Math.round(pause / 60000)}min após ${sentInBurst} envios`)
    await enqueuePacerStep(runId, campaignId, 0, pause)
  } else {
    await enqueuePacerStep(runId, campaignId, sentInBurst, randomIntervalMs(speed, channel as SpeedChannel))
  }
}

async function markMessageFailed(messageId: string, runId: string, campaignId: string, reason: string): Promise<void> {
  const now = new Date()
  await db.update(campaignMessages).set({ status: 'failed', failureReason: reason, updatedAt: now }).where(eq(campaignMessages.id, messageId))
  await db.update(campaignRuns).set({ failedCount: sql`${campaignRuns.failedCount} + 1`, updatedAt: now }).where(eq(campaignRuns.id, runId))
  await db.update(campaigns).set({ failedCount: sql`${campaigns.failedCount} + 1`, updatedAt: now }).where(eq(campaigns.id, campaignId))
}

/** Fecha o run e devolve a campanha ao agendamento (ou conclui de vez). */
export async function completeRun(runId: string, campaignId: string): Promise<void> {
  const now = new Date()
  const [counts] = await db
    .select({
      sent: sql<number>`count(*) filter (where status in ('sent', 'delivered', 'read'))::int`,
      delivered: sql<number>`count(*) filter (where delivered_at is not null or status in ('delivered', 'read'))::int`,
      read: sql<number>`count(*) filter (where read_at is not null or status = 'read')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(campaignMessages)
    .where(eq(campaignMessages.runId, runId))

  await db.update(campaignRuns).set({
    status: 'completed',
    completedAt: now,
    nextPacerAt: null,
    sentCount: counts?.sent ?? 0,
    deliveredCount: counts?.delivered ?? 0,
    readCount: counts?.read ?? 0,
    failedCount: counts?.failed ?? 0,
    updatedAt: now,
  }).where(and(eq(campaignRuns.id, runId), inArray(campaignRuns.status, ['running', 'pending'])))

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  if (!campaign || campaign.status !== 'running') return

  if (campaign.nextRunAt) {
    await db.update(campaigns).set({ status: 'scheduled', updatedAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'running')))
    console.log(`[pacer] run ${runId} concluído — campanha ${campaignId} reagendada para ${campaign.nextRunAt.toISOString()}`)
  } else {
    await db.update(campaigns).set({ status: 'completed', completedAt: now, updatedAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'running')))
    const sent = counts?.sent ?? 0
    const delivered = counts?.delivered ?? 0
    const failed = counts?.failed ?? 0
    await notifyWorkspaceOwner(campaign.workspaceId, {
      type: 'product',
      title: 'Campanha finalizada',
      body: `A campanha "${campaign.name}" foi concluída. ${sent} enviada${sent === 1 ? '' : 's'}, ${delivered} entregue${delivered === 1 ? '' : 's'}${failed > 0 ? `, ${failed} falha${failed === 1 ? '' : 's'}` : ''}.`,
      actionUrl: `${NAIA_WEB_URL()}/${campaign.workspaceId}/campaigns/${campaignId}`,
      actionLabel: 'Ver resultados',
      metadata: { campaignId, campaignName: campaign.name, sent, delivered, failed },
    }, 'emailOnCampaignCompleted')
    console.log(`[pacer] run ${runId} concluído — campanha ${campaignId} finalizada`)
  }
}
