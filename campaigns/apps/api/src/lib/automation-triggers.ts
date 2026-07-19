// Gatilhos de automação (contact_created / tag_added) e o freio de mão
// (stop tags). Este módulo fica na base da cadeia de imports — é usado pelo
// campaign-runner e pelo automation-engine, então não pode importar nenhum
// dos dois.

import { db, automations, automationEnrollments } from '@naia/db'
import { eq, and, sql } from 'drizzle-orm'
import type { AutomationStep, AutomationTriggerConfig } from '@naia/schemas'
import { generateId } from './crypto'

export function parseJsonArray<T>(json: string): T[] {
  try {
    const value = JSON.parse(json)
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

export function parseTriggerConfig(json: string): AutomationTriggerConfig {
  try {
    return (JSON.parse(json) as AutomationTriggerConfig) ?? {}
  } catch {
    return {}
  }
}

/** Passos efetivos da automação: stepsJson, ou contentJson como passo único
 * implícito de mensagem (o caso "dispara e pronto", sem régua). */
export function parseSteps(automation: { stepsJson: string; contentJson: string }): AutomationStep[] {
  const steps = parseJsonArray<AutomationStep>(automation.stepsJson)
  if (steps.length > 0) return steps
  const content = parseJsonArray<{ body: string; mediaAssetIds?: string[] }>(automation.contentJson)
  if (content.length === 0) return []
  return [{ id: 'single', action: 'message', content }]
}

/** Inscreve o contato na cadência — ou reinicia a inscrição ativa existente
 * (novo evento do mesmo gatilho recomeça a régua com o contexto novo, em vez
 * de duplicar mensagens). `nextStepAt` customizado serve de lease quando o
 * chamador vai executar o primeiro passo inline (evita corrida com o tick). */
export async function enrollContact(
  automation: { id: string; workspaceId: string },
  contactId: string,
  context: Record<string, unknown> = {},
  opts: { nextStepAt?: Date } = {},
): Promise<string> {
  const now = new Date()
  const nextStepAt = opts.nextStepAt ?? now
  const [existing] = await db
    .select({ id: automationEnrollments.id })
    .from(automationEnrollments)
    .where(
      and(
        eq(automationEnrollments.automationId, automation.id),
        eq(automationEnrollments.contactId, contactId),
        eq(automationEnrollments.status, 'active'),
      ),
    )
    .limit(1)
  if (existing) {
    await db
      .update(automationEnrollments)
      .set({ currentStepIndex: 0, nextStepAt, contextJson: JSON.stringify(context), updatedAt: now })
      .where(eq(automationEnrollments.id, existing.id))
    return existing.id
  }
  const id = generateId()
  await db.insert(automationEnrollments).values({
    id,
    workspaceId: automation.workspaceId,
    automationId: automation.id,
    contactId,
    currentStepIndex: 0,
    nextStepAt,
    status: 'active',
    contextJson: JSON.stringify(context),
  })
  return id
}

/** Contato novo no workspace (cadastro manual ou importação) → inscreve nas
 * automações contact_created ativas. */
export async function handleContactCreated(workspaceId: string, contactId: string): Promise<void> {
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.active, true), eq(automations.type, 'contact_created')))
  for (const automation of rows) {
    if (parseSteps(automation).length === 0) continue
    await enrollContact(automation, contactId)
  }
}

/** Tags adicionadas a contatos. Chamar em TODO ponto que aplica tag (rota de
 * contato, importação, tag de audiência de campanha, passo add_tag).
 * Faz duas coisas, nesta ordem:
 * 1. Freio de mão — cancela inscrições ativas cuja automação lista alguma
 *    das tags em stopOnTagsJson (ex: "comprou" derruba a régua de carrinho).
 * 2. Gatilho tag_added — inscreve o contato nas automações ativas disparadas
 *    por alguma das tags. */
export async function handleTagsAdded(workspaceId: string, contactIds: string[], tags: string[]): Promise<void> {
  const cleanTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  if (contactIds.length === 0 || cleanTags.length === 0) return

  const idList = sql.join(contactIds.map((id) => sql`${id}`), sql`, `)
  const tagArray = sql`ARRAY[${sql.join(cleanTags.map((t) => sql`${t}`), sql`, `)}]::text[]`
  await db.execute(sql`
    UPDATE automation_enrollments e SET status = 'cancelled', updated_at = now()
    FROM automations a
    WHERE e.automation_id = a.id
      AND e.status = 'active'
      AND e.workspace_id = ${workspaceId}
      AND e.contact_id IN (${idList})
      AND a.stop_on_tags_json::jsonb ?| ${tagArray}
  `)

  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.active, true), eq(automations.type, 'tag_added')))
  for (const automation of rows) {
    const config = parseTriggerConfig(automation.triggerJson)
    if (!config.tag || !cleanTags.includes(config.tag)) continue
    if (parseSteps(automation).length === 0) continue
    for (const contactId of contactIds) {
      await enrollContact(automation, contactId, { tag: config.tag })
    }
  }
}
