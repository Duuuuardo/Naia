// Reconciliação periódica (startup + a cada 60s). O Postgres é a fonte da
// verdade; o Redis guarda só jobs de controle — então recuperar de crash é
// ressuscitar pacers perdidos e recontar contadores, nunca reprocessar Redis.

import { db, campaigns, campaignRuns, campaignMessages } from '@naia/db'
import { eq, and, inArray, like, or, sql, lt, isNull } from 'drizzle-orm'
import { getQueue, QUEUES, defaultJobOptions } from '@naia/queue'
import type { PacerJob } from '@naia/schemas'
import { completeRun } from './handlers/pacer'

/** Contadores da campanha = agregado real de campaign_messages. */
async function reconcileCampaignCounts(): Promise<void> {
  const activeOrRecent = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(inArray(campaigns.status, ['running', 'scheduled', 'paused', 'completed', 'failed']))

  for (const c of activeOrRecent) {
    try {
      const [counts] = await db
        .select({
          sent: sql<number>`count(*) filter (where status in ('sent', 'delivered', 'read'))::int`,
          delivered: sql<number>`count(*) filter (where delivered_at is not null or status in ('delivered', 'read'))::int`,
          read: sql<number>`count(*) filter (where read_at is not null or status = 'read')::int`,
          failed: sql<number>`count(*) filter (where status = 'failed')::int`,
        })
        .from(campaignMessages)
        .where(eq(campaignMessages.campaignId, c.id))

      if (!counts) continue

      await db.update(campaigns).set({
        sentCount: counts.sent,
        deliveredCount: counts.delivered,
        readCount: counts.read,
        failedCount: counts.failed,
      }).where(eq(campaigns.id, c.id))
    } catch (e) {
      console.error(`[recovery] erro ao reconciliar contadores da campanha ${c.id}:`, e)
    }
  }
}

/** Contadores dos runs não-terminais = agregado real das mensagens do run. */
async function reconcileRunCounts(): Promise<void> {
  const activeRuns = await db
    .select({ id: campaignRuns.id })
    .from(campaignRuns)
    .where(inArray(campaignRuns.status, ['running', 'paused', 'pending']))

  for (const r of activeRuns) {
    try {
      const [counts] = await db
        .select({
          sent: sql<number>`count(*) filter (where status in ('sent', 'delivered', 'read'))::int`,
          delivered: sql<number>`count(*) filter (where delivered_at is not null or status in ('delivered', 'read'))::int`,
          read: sql<number>`count(*) filter (where read_at is not null or status = 'read')::int`,
          failed: sql<number>`count(*) filter (where status = 'failed')::int`,
        })
        .from(campaignMessages)
        .where(eq(campaignMessages.runId, r.id))

      if (!counts) continue

      await db.update(campaignRuns).set({
        sentCount: counts.sent,
        deliveredCount: counts.delivered,
        readCount: counts.read,
        failedCount: counts.failed,
      }).where(eq(campaignRuns.id, r.id))
    } catch (e) {
      console.error(`[recovery] erro ao reconciliar contadores do run ${r.id}:`, e)
    }
  }
}

/** 'sending' órfão (>10min sem update = job de envio sumiu) volta pra fila.
 * O crédito debitado no claim do pacer é estornado: a mensagem re-enfileirada
 * será debitada de novo quando reivindicada — sem estorno, cada crash no meio
 * do envio cobraria a mensagem duas vezes. */
async function resetStaleSending(): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60_000)
  const refunds = (await db.execute(sql`
    WITH reset AS (
      UPDATE campaign_messages cm SET status = 'queued', updated_at = now()
      FROM campaigns c
      WHERE cm.campaign_id = c.id
        AND cm.status = 'sending'
        AND cm.updated_at < ${cutoff}
      RETURNING cm.id, c.workspace_id
    )
    SELECT workspace_id AS "workspaceId", count(*)::int AS c FROM reset GROUP BY 1
  `)) as unknown as Array<{ workspaceId: string; c: number }>

  for (const refund of refunds) {
    await db.execute(sql`
      UPDATE entitlements SET credits_balance = credits_balance + ${refund.c}, updated_at = now()
      WHERE workspace_id = ${refund.workspaceId}
    `)
  }
  const total = refunds.reduce((acc, r) => acc + r.c, 0)
  if (total > 0) {
    console.log(`[recovery] ${total} mensagens presas em 'sending' devolvidas pra fila (créditos estornados)`)
  }
}

/**
 * Pacers perdidos: run 'running' cujo próximo passo (next_pacer_at) venceu há
 * mais de 3 minutos — o job do Redis morreu com o worker. Parks longos
 * (janela de horário, pausa de rajada) têm next_pacer_at no futuro e não
 * disparam este caminho.
 */
async function resurrectLostPacers(): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 60_000)
  const stuckRuns = await db
    .select()
    .from(campaignRuns)
    .where(and(eq(campaignRuns.status, 'running'), lt(campaignRuns.nextPacerAt, cutoff)))

  for (const run of stuckRuns) {
    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignMessages)
      .where(and(eq(campaignMessages.runId, run.id), inArray(campaignMessages.status, ['queued', 'sending'])))

    if ((pending?.count ?? 0) === 0) {
      await completeRun(run.id, run.campaignId)
      continue
    }

    console.log(`[recovery] run ${run.id} sem pacer há >3min — re-enfileirando (${pending?.count} mensagens pendentes)`)
    await db.update(campaignRuns).set({ nextPacerAt: new Date(), updatedAt: new Date() }).where(eq(campaignRuns.id, run.id))
    await getQueue<PacerJob>(QUEUES.CAMPAIGN_PACER).add(
      `pacer:${run.id}:${Date.now()}`,
      { runId: run.id, campaignId: run.campaignId, sentInBurst: 0 },
      { ...defaultJobOptions, removeOnComplete: { count: 100 } },
    )
  }
}

/**
 * Campanhas 'running' sem nenhum run ativo e sem mensagens pendentes —
 * inclui o legado pré-runs (mensagens com run_id null). Devolve ao
 * agendamento ou conclui.
 */
async function closeOrphanRunningCampaigns(): Promise<void> {
  const runningCampaigns = await db.select().from(campaigns).where(eq(campaigns.status, 'running'))

  for (const campaign of runningCampaigns) {
    const [activeRuns] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignRuns)
      .where(and(eq(campaignRuns.campaignId, campaign.id), inArray(campaignRuns.status, ['running', 'paused', 'pending'])))
    if ((activeRuns?.count ?? 0) > 0) continue

    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignMessages)
      .where(and(eq(campaignMessages.campaignId, campaign.id), inArray(campaignMessages.status, ['queued', 'sending'])))
    if ((pending?.count ?? 0) > 0) continue

    const now = new Date()
    if (campaign.nextRunAt) {
      await db.update(campaigns).set({ status: 'scheduled', updatedAt: now })
        .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'running')))
    } else {
      await db.update(campaigns).set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'running')))
      console.log(`[recovery] campanha ${campaign.id} (${campaign.name}) sem pendências — marcada como concluída`)
    }
  }
}

/** Mensagens de erro internas vazadas pra failure_reason viram texto neutro. */
async function sanitizeFailureReasons(): Promise<void> {
  await db.update(campaignMessages).set({
    failureReason: 'Falha ao processar envio ou iniciar disparo da mensagem na campanha.',
    updatedAt: new Date(),
  }).where(and(
    eq(campaignMessages.status, 'failed'),
    or(
      like(campaignMessages.failureReason, '%Failed query:%'),
      like(campaignMessages.failureReason, '%syntax error%'),
      like(campaignMessages.failureReason, '%update "%'),
      like(campaignMessages.failureReason, '%DrizzleError%'),
      like(campaignMessages.failureReason, '%PostgresError%'),
    ),
  ))
}

export async function reconcileRunningCampaigns(): Promise<void> {
  try {
    await sanitizeFailureReasons().catch((e) => console.error('[recovery] erro no cleanup de failure_reason:', e))
    await resetStaleSending()
    await reconcileRunCounts()
    await reconcileCampaignCounts()
    await resurrectLostPacers()
    await closeOrphanRunningCampaigns()
  } catch (err) {
    console.error('[recovery] Erro ao reconciliar campanhas em andamento:', err)
  }
}
