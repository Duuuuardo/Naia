// Início de um run de campanha — usado pelo dispatch imediato (rota) e pelo
// tick do scheduler (via /internal/campaigns/:id/start-run). A cada run a
// audiência é re-resolvida e o saldo de créditos checado; o envio em si é
// paceado pelo worker (handlers/pacer.ts), que consome as mensagens 'queued'.

import { db, campaigns, campaignMessages, campaignRuns, campaignConnections, campaignVariants, connections, contacts, entitlements as entitlementsTable } from '@naia/db'
import { eq, and, sql, inArray, asc } from 'drizzle-orm'
import { getQueue, QUEUES, defaultJobOptions } from '@naia/queue'
import type { PacerJob, Schedule, ChannelType } from '@naia/schemas'
import { computeNextRunAt, DEFAULT_TIMEZONE } from '@naia/scheduling'
import { resolveCampaignTargets, type SegmentFilter } from '../routes/contacts'
import { handleTagsAdded } from './automation-triggers'
import { generateId } from './crypto'

export function parseSchedule(json: string): Schedule {
  try {
    return JSON.parse(json) as Schedule
  } catch {
    return { type: 'immediate' }
  }
}

type Targetable = typeof contacts.$inferSelect

/**
 * Canal de envio por contato. WhatsApp tem prioridade em campanha mista:
 * telefone é o identificador mais forte e o WhatsApp é o canal primário de
 * alcance no Brasil. Null = contato inelegível para os canais disponíveis.
 */
export function resolveContactChannel(
  contact: Targetable,
  availableChannels: Set<string>,
): ChannelType | null {
  if (!contact.optInStatus) return null
  if (contact.whatsappPhone && availableChannels.has('whatsapp')) return 'whatsapp'
  if (contact.telegramChatId && availableChannels.has('telegram')) return 'telegram'
  return null
}

export type StartRunResult =
  | { started: true; runId: string; totalContacts: number; quotaTruncated: boolean }
  | { started: false; reason: string; runStatus?: 'skipped_quota' | 'completed' | 'failed' }

export async function startCampaignRun(
  campaignId: string,
  opts: { scheduledFor?: Date } = {},
): Promise<StartRunResult> {
  const now = new Date()
  const scheduledFor = opts.scheduledFor ?? now

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  if (!campaign) return { started: false, reason: 'Campanha não encontrada.' }
  if (!['draft', 'scheduled', 'running'].includes(campaign.status)) {
    return { started: false, reason: `Campanha em status '${campaign.status}' não pode iniciar run.` }
  }

  const schedule = parseSchedule(campaign.scheduleJson)
  const tz = campaign.timezone || DEFAULT_TIMEZONE
  const runNumber = campaign.occurrenceCount + 1

  // Próxima ocorrência calculada já com este run contado — persistida junto
  // do início do run para o scheduler nunca perder o fio após restart.
  const nextRunAt = computeNextRunAt(schedule, now, tz, runNumber)

  const connRows = await db
    .select({ connection: connections })
    .from(campaignConnections)
    .innerJoin(connections, eq(campaignConnections.connectionId, connections.id))
    .where(eq(campaignConnections.campaignId, campaignId))
    .orderBy(asc(campaignConnections.position))

  const activeConns = connRows.map((r) => r.connection).filter((c) => c.status === 'active')

  if (activeConns.length === 0) {
    await db.update(campaigns).set({ status: 'failed', nextRunAt: null, updatedAt: now }).where(eq(campaigns.id, campaignId))
    await insertSkippedRun(campaignId, runNumber, scheduledFor, 'failed', 'Nenhuma conexão ativa disponível.')
    return { started: false, reason: 'Nenhuma conexão ativa disponível.', runStatus: 'failed' }
  }

  const availableChannels = new Set(activeConns.map((c) => c.channel))

  let filter: SegmentFilter = { type: 'all' }
  try {
    filter = JSON.parse(campaign.segmentFilter) as SegmentFilter
  } catch {
    /* mantém all */
  }

  const targets = await resolveCampaignTargets(
    campaign.workspaceId,
    activeConns.map((c) => c.id),
    filter,
  )

  const eligible: Array<{ contact: Targetable; channel: ChannelType }> = []
  for (const contact of targets) {
    const channel = resolveContactChannel(contact, availableChannels)
    if (channel) eligible.push({ contact, channel })
  }

  if (eligible.length === 0) {
    await advanceAfterRun(campaignId, nextRunAt, runNumber, now)
    await insertSkippedRun(campaignId, runNumber, scheduledFor, 'completed', 'Nenhum contato elegível para os canais selecionados.')
    return { started: false, reason: 'Nenhum contato elegível.', runStatus: 'completed' }
  }

  return launchRun(campaign, eligible, runNumber, scheduledFor, nextRunAt)
}

/**
 * Run com audiência explícita — usado pelo motor de cadência (passos de
 * mensagem de automation_enrollments). Diferente do startCampaignRun, aceita
 * campanha 'completed' (a campanha de passo é reusada a cada leva) e não mexe
 * no agendamento próprio da campanha.
 */
export async function startAdhocRun(campaignId: string, contactIds: string[]): Promise<StartRunResult> {
  const now = new Date()
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  if (!campaign) return { started: false, reason: 'Campanha não encontrada.' }
  if (campaign.status === 'paused' || campaign.status === 'cancelled') {
    return { started: false, reason: `Campanha em status '${campaign.status}' não pode iniciar run.` }
  }

  const connRows = await db
    .select({ connection: connections })
    .from(campaignConnections)
    .innerJoin(connections, eq(campaignConnections.connectionId, connections.id))
    .where(eq(campaignConnections.campaignId, campaignId))
    .orderBy(asc(campaignConnections.position))
  const activeConns = connRows.map((r) => r.connection).filter((c) => c.status === 'active')
  if (activeConns.length === 0) {
    // Sem falhar a campanha: o passo da cadência tenta de novo mais tarde
    return { started: false, reason: 'Nenhuma conexão ativa disponível.' }
  }

  const availableChannels = new Set(activeConns.map((c) => c.channel))
  const rows = await db
    .select()
    .from(contacts)
    .where(and(inArray(contacts.id, contactIds), eq(contacts.workspaceId, campaign.workspaceId)))

  const eligible: Array<{ contact: Targetable; channel: ChannelType }> = []
  for (const contact of rows) {
    const channel = resolveContactChannel(contact, availableChannels)
    if (channel) eligible.push({ contact, channel })
  }
  if (eligible.length === 0) {
    return { started: false, reason: 'Nenhum contato elegível.', runStatus: 'completed' }
  }

  return launchRun(campaign, eligible, campaign.occurrenceCount + 1, now, campaign.nextRunAt)
}

/** Núcleo compartilhado: créditos, tag de audiência, mensagens e pacer. */
async function launchRun(
  campaign: typeof campaigns.$inferSelect,
  eligible: Array<{ contact: Targetable; channel: ChannelType }>,
  runNumber: number,
  scheduledFor: Date,
  nextRunAt: Date | null,
): Promise<StartRunResult> {
  const now = new Date()
  const campaignId = campaign.id

  // Créditos: saldo disponível determina quantos contatos cabem neste run
  const [ent] = await db
    .select()
    .from(entitlementsTable)
    .where(eq(entitlementsTable.workspaceId, campaign.workspaceId))
    .limit(1)
  const remaining = Math.max(0, ent?.creditsBalance ?? 0)

  if (remaining === 0) {
    await advanceAfterRun(campaignId, nextRunAt, runNumber, now)
    await insertSkippedRun(
      campaignId,
      runNumber,
      scheduledFor,
      'skipped_quota',
      'Créditos de disparo esgotados.',
    )
    return { started: false, reason: 'Créditos de disparo esgotados.', runStatus: 'skipped_quota' }
  }

  const quotaTruncated = eligible.length > remaining
  const batch = quotaTruncated ? eligible.slice(0, remaining) : eligible
  const excess = quotaTruncated ? eligible.slice(remaining) : []

  // Tag de audiência: aplicada a todos os contatos alcançados neste run
  if (campaign.applyTagOnDispatch) {
    const ids = batch.map((e) => e.contact.id)
    const tagged = await db
      .update(contacts)
      .set({ tags: sql`array_append(${contacts.tags}, ${campaign.applyTagOnDispatch})`, updatedAt: now })
      .where(and(inArray(contacts.id, ids), sql`NOT (${contacts.tags} @> ARRAY[${campaign.applyTagOnDispatch}]::text[])`))
      .returning({ id: contacts.id })
    // Tag nova pode acionar automações (tag_added) e o freio de mão
    if (tagged.length > 0) {
      await handleTagsAdded(campaign.workspaceId, tagged.map((t) => t.id), [campaign.applyTagOnDispatch])
    }
  }

  const variants = await db
    .select()
    .from(campaignVariants)
    .where(eq(campaignVariants.campaignId, campaignId))
    .orderBy(asc(campaignVariants.position))

  const runId = generateId()
  await db.insert(campaignRuns).values({
    id: runId,
    campaignId,
    runNumber,
    status: 'running',
    scheduledFor,
    startedAt: now,
    totalContacts: eligible.length,
    quotaTruncated,
    failedCount: excess.length,
    nextPacerAt: now,
  })

  // Variantes rotacionadas por índice — anti-spam por variação de texto
  const messageRows = batch.map((e, i) => ({
    id: generateId(),
    campaignId,
    runId,
    contactId: e.contact.id,
    channel: e.channel,
    variantId: variants.length > 0 ? variants[i % variants.length]!.id : null,
    status: 'queued' as const,
  }))

  // Contatos além da cota entram como 'failed' imediatamente — visíveis na UI
  const failedRows = excess.map((e) => ({
    id: generateId(),
    campaignId,
    runId,
    contactId: e.contact.id,
    channel: e.channel,
    variantId: null as string | null,
    status: 'failed' as const,
    failureReason: 'Créditos de disparo esgotados.',
  }))

  const allRows = [...messageRows, ...failedRows]
  for (let i = 0; i < allRows.length; i += 500) {
    await db.insert(campaignMessages).values(allRows.slice(i, i + 500))
  }

  await db
    .update(campaigns)
    .set({
      status: 'running',
      startedAt: campaign.startedAt ?? now,
      totalContacts: sql`${campaigns.totalContacts} + ${eligible.length}`,
      failedCount: sql`${campaigns.failedCount} + ${excess.length}`,
      occurrenceCount: runNumber,
      nextRunAt,
      updatedAt: now,
    })
    .where(eq(campaigns.id, campaignId))

  await getQueue<PacerJob>(QUEUES.CAMPAIGN_PACER).add(
    `pacer:${runId}:0`,
    { runId, campaignId, sentInBurst: 0 },
    { ...defaultJobOptions, removeOnComplete: { count: 100 } },
  )

  console.log(
    `[campaign-runner] campanha ${campaignId} run #${runNumber} iniciado — ${batch.length} contatos${quotaTruncated ? ` (${excess.length} bloqueados por cota)` : ''}`,
  )
  return { started: true, runId, totalContacts: eligible.length, quotaTruncated }
}

/** Run que não vai executar (skip/vazio): registra e avança o agendamento. */
async function insertSkippedRun(
  campaignId: string,
  runNumber: number,
  scheduledFor: Date,
  status: 'skipped_quota' | 'completed' | 'failed',
  skipReason: string,
): Promise<void> {
  await db
    .insert(campaignRuns)
    .values({
      id: generateId(),
      campaignId,
      runNumber,
      status,
      scheduledFor,
      completedAt: new Date(),
      skipReason,
    })
    .onConflictDoNothing()
}

/** Avança occurrenceCount/nextRunAt quando o run não gerou mensagens. */
async function advanceAfterRun(
  campaignId: string,
  nextRunAt: Date | null,
  runNumber: number,
  now: Date,
): Promise<void> {
  await db
    .update(campaigns)
    .set({
      occurrenceCount: runNumber,
      nextRunAt,
      status: nextRunAt ? 'scheduled' : 'completed',
      completedAt: nextRunAt ? null : now,
      updatedAt: now,
    })
    .where(eq(campaigns.id, campaignId))
}
