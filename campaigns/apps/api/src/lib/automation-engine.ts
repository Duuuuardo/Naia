// Motor da régua de comunicação (Automações 2.0). Executa os passos das
// inscrições (automation_enrollments) vencidas: delays viram reagendamento,
// add_tag aplica a tag (e pode acionar outras automações / freio de mão), e
// passos de mensagem viram um run numa campanha persistente por
// (automação, passo) — reusando créditos, opt-in, pacer e histórico da infra
// de campanhas sem criar uma campanha por contato.

import { db, automations, automationEnrollments, automationConnections, connections, campaigns, campaignConnections, contacts, entitlements as entitlementsTable } from '@naia/db'
import { eq, and, sql, gte, asc, inArray } from 'drizzle-orm'
import { hasActiveSubscription, canCreateCampaign } from '@naia/entitlements'
import type { AutomationStep } from '@naia/schemas'
import { parseSteps, handleTagsAdded } from './automation-triggers'
import { startAdhocRun } from './campaign-runner'
import { replaceVariants } from '../routes/campaigns'
import { generateId } from './crypto'

type Enrollment = typeof automationEnrollments.$inferSelect
type AutomationRow = typeof automations.$inferSelect

// Falha de conexão oscila em segundos — retry curto; cota/assinatura só muda
// na virada do ciclo — retry longo.
const RETRY_CONNECTION_MS = 5 * 60 * 1000
const RETRY_QUOTA_MS = 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** Chave determinística que identifica a campanha persistente de um passo.
 * Serializada sempre por este helper — a busca depende da igualdade exata
 * da string em campaigns.segment_filter. */
function stepFilterKey(stepIndex: number): string {
  return JSON.stringify({ type: 'enrollment_step', stepIndex })
}

export async function executeDueEnrollments(automationId: string, enrollmentIds: string[]): Promise<{ processed: number }> {
  if (enrollmentIds.length === 0) return { processed: 0 }
  const now = new Date()

  const [automation] = await db.select().from(automations).where(eq(automations.id, automationId)).limit(1)
  const enrollments = await db
    .select()
    .from(automationEnrollments)
    .where(and(
      inArray(automationEnrollments.id, enrollmentIds),
      eq(automationEnrollments.automationId, automationId),
      eq(automationEnrollments.status, 'active'),
    ))
  if (enrollments.length === 0) return { processed: 0 }

  const steps = automation ? parseSteps(automation) : []
  if (!automation || steps.length === 0) {
    // Automação apagada ou sem passos: as inscrições não têm o que executar
    await db
      .update(automationEnrollments)
      .set({ status: 'cancelled', updatedAt: now })
      .where(inArray(automationEnrollments.id, enrollments.map((e) => e.id)))
    return { processed: 0 }
  }
  // Automação desativada pausa a régua (o claim do scheduler já pula
  // inativas; este guard cobre corrida entre claim e toggle) — reativar retoma
  if (!automation.active) return { processed: 0 }

  // Passo 1: avança delays/tags de cada inscrição até esbarrar num passo de
  // mensagem (que é disparado em lote no passo 2) ou concluir.
  const messageBatches = new Map<number, Enrollment[]>()
  for (const enrollment of enrollments) {
    const messageIndex = await advanceToMessageStep(automation, steps, enrollment, now)
    if (messageIndex !== null) {
      const group = messageBatches.get(messageIndex) ?? []
      group.push(enrollment)
      messageBatches.set(messageIndex, group)
    }
  }

  // Passo 2: um run por passo de mensagem com todos os contatos devidos
  for (const [stepIndex, group] of messageBatches) {
    await dispatchMessageStep(automation, steps, stepIndex, group, now)
  }

  return { processed: enrollments.length }
}

/** Processa delays e add_tags a partir do índice atual. Retorna o índice do
 * passo de mensagem a disparar agora, ou null se a inscrição foi reagendada,
 * concluída ou cancelada (pelo próprio freio de mão de um add_tag). */
async function advanceToMessageStep(
  automation: AutomationRow,
  steps: AutomationStep[],
  enrollment: Enrollment,
  now: Date,
): Promise<number | null> {
  let index = enrollment.currentStepIndex
  while (true) {
    const step = steps[index]
    if (!step) {
      await db
        .update(automationEnrollments)
        .set({ status: 'completed', currentStepIndex: index, updatedAt: now })
        .where(and(eq(automationEnrollments.id, enrollment.id), eq(automationEnrollments.status, 'active')))
      return null
    }

    if (step.action === 'message') return index

    if (step.action === 'delay') {
      const hours = step.delayHours ?? 0
      if (hours <= 0) {
        index++
        continue
      }
      // Delay em currentStepIndex = ainda não aplicado (ao aplicar, o índice
      // avança junto do reagendamento). Delay no fim da régua não tem efeito.
      const isLast = !steps[index + 1]
      await db
        .update(automationEnrollments)
        .set(
          isLast
            ? { status: 'completed', currentStepIndex: index + 1, updatedAt: now }
            : { currentStepIndex: index + 1, nextStepAt: new Date(now.getTime() + hours * HOUR_MS), updatedAt: now },
        )
        .where(and(eq(automationEnrollments.id, enrollment.id), eq(automationEnrollments.status, 'active')))
      return null
    }

    // add_tag
    if (step.tag?.trim()) {
      const tag = step.tag.trim()
      await db
        .update(contacts)
        .set({ tags: sql`array_append(${contacts.tags}, ${tag})`, updatedAt: now })
        .where(and(eq(contacts.id, enrollment.contactId), sql`NOT (${contacts.tags} @> ARRAY[${tag}]::text[])`))
      await handleTagsAdded(automation.workspaceId, [enrollment.contactId], [tag])
      // O freio de mão pode ter cancelado esta própria inscrição
      const [fresh] = await db
        .select({ status: automationEnrollments.status })
        .from(automationEnrollments)
        .where(eq(automationEnrollments.id, enrollment.id))
        .limit(1)
      if (fresh?.status !== 'active') return null
    }
    index++
    await db
      .update(automationEnrollments)
      .set({ currentStepIndex: index, updatedAt: now })
      .where(and(eq(automationEnrollments.id, enrollment.id), eq(automationEnrollments.status, 'active')))
  }
}

/** Dispara o passo de mensagem para um grupo de inscrições e avança cada uma
 * além do passo (aplicando o delay seguinte, se houver). Falha de cota ou
 * conexão reagenda o grupo para retry em 1h sem avançar. */
async function dispatchMessageStep(
  automation: AutomationRow,
  steps: AutomationStep[],
  stepIndex: number,
  group: Enrollment[],
  now: Date,
): Promise<void> {
  const step = steps[stepIndex]!
  const ids = group.map((e) => e.id)

  const retryLater = async (reason: string) => {
    const delay = /conexão/i.test(reason) ? RETRY_CONNECTION_MS : RETRY_QUOTA_MS
    await db
      .update(automationEnrollments)
      .set({ nextStepAt: new Date(now.getTime() + delay), updatedAt: now })
      .where(and(inArray(automationEnrollments.id, ids), eq(automationEnrollments.status, 'active')))
    await db
      .update(automations)
      .set({ lastResultJson: JSON.stringify({ matched: group.length, skipReason: reason }), updatedAt: now })
      .where(eq(automations.id, automation.id))
    console.warn(`[automation-engine] automação ${automation.id} passo ${stepIndex}: ${reason} — retry em ${Math.round(delay / 60000)}min (${group.length} inscrições)`)
  }

  const ensured = await ensureStepCampaign(automation, steps, stepIndex, step)
  if (!ensured.ok) {
    await retryLater(ensured.message)
    return
  }

  const run = await startAdhocRun(ensured.campaignId, group.map((e) => e.contactId))
  // 'Nenhum contato elegível' (opt-out etc.) conta como processado — a régua
  // segue; falha operacional (conexão, créditos) segura o grupo para retry.
  if (!run.started && run.runStatus !== 'completed') {
    await retryLater(run.reason)
    return
  }

  for (const enrollment of group) {
    let nextIndex = stepIndex + 1
    const updates: Partial<typeof automationEnrollments.$inferInsert> = { updatedAt: now }
    const next = steps[nextIndex]
    if (!next) {
      updates.status = 'completed'
      updates.currentStepIndex = nextIndex
    } else if (next.action === 'delay' && (next.delayHours ?? 0) > 0) {
      nextIndex++
      if (!steps[nextIndex]) {
        updates.status = 'completed' // delay no fim não tem efeito
        updates.currentStepIndex = nextIndex
      } else {
        updates.currentStepIndex = nextIndex
        updates.nextStepAt = new Date(now.getTime() + (next.delayHours ?? 0) * HOUR_MS)
      }
    } else {
      updates.currentStepIndex = nextIndex
      updates.nextStepAt = now // próximo tick processa o passo seguinte
    }
    await db
      .update(automationEnrollments)
      .set(updates)
      .where(and(eq(automationEnrollments.id, enrollment.id), eq(automationEnrollments.status, 'active')))
  }

  await db
    .update(automations)
    .set({
      lastResultJson: JSON.stringify({
        matched: group.length,
        campaignId: ensured.campaignId,
        skipReason: run.started ? undefined : run.reason,
      }),
      updatedAt: now,
    })
    .where(eq(automations.id, automation.id))
}

/** Localiza (ou cria) a campanha persistente do passo e sincroniza conexões
 * e variantes com o estado atual da automação — edições na automação passam
 * a valer no disparo seguinte. Gates de entitlement valem na criação, como
 * no evaluate de aniversário. */
async function ensureStepCampaign(
  automation: AutomationRow,
  steps: AutomationStep[],
  stepIndex: number,
  step: AutomationStep,
): Promise<{ ok: true; campaignId: string } | { ok: false; message: string }> {
  const content = (step.content ?? []).filter((v) => v.body?.trim() || (v.mediaAssetIds?.length ?? 0) > 0)
  if (content.length === 0) return { ok: false, message: 'Passo de mensagem sem conteúdo.' }

  const connRows = await db
    .select({ connection: connections })
    .from(automationConnections)
    .innerJoin(connections, eq(automationConnections.connectionId, connections.id))
    .where(eq(automationConnections.automationId, automation.id))
    .orderBy(asc(automationConnections.position))
  const activeConns = connRows.map((r) => r.connection).filter((c) => c.status === 'active')
  if (activeConns.length === 0) return { ok: false, message: 'Nenhuma conexão ativa vinculada à automação.' }

  const filterKey = stepFilterKey(stepIndex)
  const [existing] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.automationId, automation.id), eq(campaigns.segmentFilter, filterKey)))
    .limit(1)

  if (existing) {
    await db.delete(campaignConnections).where(eq(campaignConnections.campaignId, existing.id))
    for (let i = 0; i < activeConns.length; i++) {
      await db.insert(campaignConnections).values({ campaignId: existing.id, connectionId: activeConns[i]!.id, position: i })
    }
    const variantResult = await replaceVariants(automation.workspaceId, existing.id, content)
    if (!variantResult.ok) return { ok: false, message: variantResult.message }
    return { ok: true, campaignId: existing.id }
  }

  const [ent] = await db.select().from(entitlementsTable).where(eq(entitlementsTable.workspaceId, automation.workspaceId)).limit(1)
  if (!ent) return { ok: false, message: 'Workspace sem entitlement sincronizado.' }
  const subCheck = hasActiveSubscription(ent)
  if (!subCheck.allowed) return { ok: false, message: subCheck.reason }
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const [created] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, automation.workspaceId), gte(campaigns.createdAt, monthStart)))
  const campaignCheck = canCreateCampaign(ent, created?.count ?? 0)
  if (!campaignCheck.allowed) return { ok: false, message: campaignCheck.reason }

  const messageOrdinal = steps.slice(0, stepIndex + 1).filter((s) => s.action === 'message').length
  const totalMessages = steps.filter((s) => s.action === 'message').length
  const label = totalMessages > 1 ? ` — Mensagem ${messageOrdinal}` : ''
  const uniqueChannels = [...new Set(activeConns.map((c) => c.channel))]
  const campaignId = generateId()
  await db.insert(campaigns).values({
    id: campaignId,
    workspaceId: automation.workspaceId,
    name: `${automation.name}${label}`,
    channel: uniqueChannels.length === 1 ? (uniqueChannels[0] as 'whatsapp' | 'telegram') : 'mixed',
    status: 'draft',
    kind: 'automation',
    automationId: automation.id,
    segmentFilter: filterKey,
    scheduleJson: JSON.stringify({ type: 'immediate' }),
    speedJson: automation.speedJson,
    timezone: automation.timezone,
    consentAt: new Date(),
  })
  for (let i = 0; i < activeConns.length; i++) {
    await db.insert(campaignConnections).values({ campaignId, connectionId: activeConns[i]!.id, position: i })
  }
  const variantResult = await replaceVariants(automation.workspaceId, campaignId, content)
  if (!variantResult.ok) {
    await db.delete(campaigns).where(eq(campaigns.id, campaignId))
    return { ok: false, message: variantResult.message }
  }
  return { ok: true, campaignId }
}
