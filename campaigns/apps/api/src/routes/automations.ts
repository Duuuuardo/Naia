// Automações (triggers) — aniversário (fluxo diário), webhook externo
// (carrinho abandonado etc.), tag adicionada e contato novo. A automação em
// si não envia nada: quando dispara, spawna uma campanha real
// (kind='automation') que herda runs, cota, pacing e histórico do modelo de
// campanhas — via evaluate diário (aniversário) ou via régua de inscrições
// (automation_enrollments, ver lib/automation-engine.ts).

import { Elysia, t } from 'elysia'
import { db, automations, automationConnections, automationEnrollments, connections, campaigns } from '@naia/db'
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm'
import { canUseSpeed, canCreateAutomation, canActivateAutomation, defaultSpeedPreset } from '@naia/entitlements'
import { SpeedSchema, type Speed, type SpeedChannel, type AutomationStep, type AutomationType } from '@naia/schemas'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { parseTriggerConfig, parseJsonArray } from '../lib/automation-triggers'
import { generateId, generateToken } from '../lib/crypto'

const ContentInput = t.Array(
  t.Object({
    body: t.String({ minLength: 1 }),
    mediaAssetIds: t.Optional(t.Array(t.String())),
  }),
  { minItems: 1 },
)

const StepInput = t.Object({
  id: t.String(),
  action: t.Union([t.Literal('message'), t.Literal('delay'), t.Literal('add_tag')]),
  content: t.Optional(
    t.Array(
      t.Object({
        body: t.String(),
        mediaAssetIds: t.Optional(t.Array(t.String())),
      }),
    ),
  ),
  delayHours: t.Optional(t.Integer({ minimum: 1, maximum: 24 * 90 })),
  tag: t.Optional(t.String()),
})

const AutomationTypeInput = t.Union([
  t.Literal('birthday'),
  t.Literal('webhook'),
  t.Literal('tag_added'),
  t.Literal('contact_created'),
])

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Valida a combinação tipo × conteúdo × passos. Retorna mensagem de erro ou null. */
function validateAutomationShape(input: {
  type: AutomationType
  content?: Array<{ body: string }>
  steps?: AutomationStep[]
  triggerTag?: string
}): string | null {
  const steps = input.steps ?? []
  if (input.type === 'birthday') {
    if (steps.length > 0) return 'Automação de aniversário não usa cadência de passos.'
    if (!input.content || input.content.length === 0) return 'Escreva ao menos uma mensagem.'
    return null
  }
  if (input.type === 'tag_added' && !input.triggerTag?.trim()) {
    return 'Informe a tag que dispara a automação.'
  }
  if (steps.length === 0) {
    if (!input.content || input.content.length === 0) return 'Adicione ao menos um passo de mensagem.'
    return null
  }
  if (steps.length > 20) return 'A cadência aceita no máximo 20 passos.'
  let hasMessage = false
  for (const step of steps) {
    if (step.action === 'message') {
      const bodies = (step.content ?? []).filter((v) => v.body?.trim() || (v.mediaAssetIds?.length ?? 0) > 0)
      if (bodies.length === 0) return 'Todo passo de mensagem precisa de conteúdo.'
      hasMessage = true
    } else if (step.action === 'delay') {
      if (!step.delayHours || step.delayHours < 1) return 'Todo passo de espera precisa de horas (mínimo 1).'
    } else if (step.action === 'add_tag') {
      if (!step.tag?.trim()) return 'Todo passo de tag precisa do nome da tag.'
    }
  }
  if (!hasMessage) return 'A cadência precisa de ao menos um passo de mensagem.'
  return null
}

/** Monta o triggerJson do tipo, preservando o secret do webhook em edições. */
function buildTriggerJson(type: AutomationType, triggerTag: string | undefined, existingJson?: string): string {
  if (type === 'webhook') {
    const existing = existingJson ? parseTriggerConfig(existingJson) : {}
    return JSON.stringify({ secret: existing.secret ?? generateToken() })
  }
  if (type === 'tag_added') return JSON.stringify({ tag: triggerTag?.trim() ?? '' })
  return '{}'
}

function getPublicApiUrl(): string {
  const value = process.env.NAIA_PUBLIC_API_URL || process.env.NAIA_API_URL
  if (!value || value.trim().length === 0) {
    throw new Error('[automations] NAIA_PUBLIC_API_URL or NAIA_API_URL is required')
  }
  return value
}

const PUBLIC_API_URL = getPublicApiUrl()

/** Campos derivados que a UI consome (URL do webhook, tag do gatilho). */
function presentAutomation<T extends { id: string; type: string; triggerJson: string }>(automation: T) {
  const config = parseTriggerConfig(automation.triggerJson)
  return {
    ...automation,
    triggerTag: automation.type === 'tag_added' ? (config.tag ?? null) : null,
    webhookUrl:
      automation.type === 'webhook' && config.secret
        ? `${PUBLIC_API_URL}/v1/triggers/webhook/${automation.id}?key=${config.secret}`
        : null,
  }
}

async function loadWorkspaceConnections(workspaceId: string, connectionIds: string[]) {
  const rows = await db
    .select()
    .from(connections)
    .where(and(inArray(connections.id, connectionIds), eq(connections.workspaceId, workspaceId)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return connectionIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
}

async function countActiveAutomations(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.active, true)))
  return row?.count ?? 0
}

async function automationWithConnections(automationId: string) {
  const [automation] = await db.select().from(automations).where(eq(automations.id, automationId)).limit(1)
  if (!automation) return null
  const connRows = await db
    .select({ connection: connections, position: automationConnections.position })
    .from(automationConnections)
    .innerJoin(connections, eq(automationConnections.connectionId, connections.id))
    .where(eq(automationConnections.automationId, automationId))
    .orderBy(asc(automationConnections.position))
  return {
    automation,
    connections: connRows.map((r) => ({
      id: r.connection.id,
      name: r.connection.name,
      channel: r.connection.channel,
      status: r.connection.status,
    })),
  }
}

export const automationRoutes = new Elysia()
  .use(authPlugin)

  // GET /workspaces/:workspaceId/automations
  .get(
    '/workspaces/:workspaceId/automations',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const rows = await db
        .select()
        .from(automations)
        .where(eq(automations.workspaceId, params.workspaceId))
        .orderBy(desc(automations.createdAt))

      // Inscrições ativas na régua, por automação (badge "N na cadência")
      const enrollmentCounts = await db
        .select({ automationId: automationEnrollments.automationId, count: sql<number>`count(*)::int` })
        .from(automationEnrollments)
        .where(and(eq(automationEnrollments.workspaceId, params.workspaceId), eq(automationEnrollments.status, 'active')))
        .groupBy(automationEnrollments.automationId)
      const countByAutomation = new Map(enrollmentCounts.map((r) => [r.automationId, r.count]))

      const result = []
      for (const automation of rows) {
        const detail = await automationWithConnections(automation.id)
        result.push({
          ...presentAutomation(automation),
          connections: detail?.connections ?? [],
          activeEnrollments: countByAutomation.get(automation.id) ?? 0,
        })
      }
      return { automations: result }
    },
  )

  // POST /workspaces/:workspaceId/automations
  .post(
    '/workspaces/:workspaceId/automations',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const sendTime = body.sendTime ?? '09:00'
      if (!TIME_RE.test(sendTime)) { set.status = 400; return { message: 'Horário de envio inválido (use HH:mm).' } }

      const shapeError = validateAutomationShape(body)
      if (shapeError) { set.status = 400; return { message: shapeError } }

      const conns = await loadWorkspaceConnections(params.workspaceId, body.connectionIds)
      if (conns.length !== body.connectionIds.length) {
        set.status = 400; return { message: 'Uma ou mais conexões selecionadas não existem neste workspace.' }
      }

      const speed: Speed = body.speed ?? { preset: defaultSpeedPreset(ctx.entitlements.tier) }
      const channels = [...new Set(conns.map((c) => c.channel))].filter(
        (c): c is SpeedChannel => c === 'whatsapp' || c === 'telegram',
      )
      const speedCheck = canUseSpeed(ctx.entitlements, speed, channels)
      if (!speedCheck.allowed) { set.status = 403; return { message: speedCheck.reason } }

      const activeCount = await countActiveAutomations(params.workspaceId)
      const automationCheck = canCreateAutomation(ctx.entitlements, activeCount)
      if (!automationCheck.allowed) { set.status = 403; return { message: automationCheck.reason } }

      // Automação ativa envia mensagens sozinha — exige email confirmado no
      // Vianova, igual ao disparo de campanhas.
      if ((body.active ?? true) && !session?.emailVerified) {
        set.status = 403
        return { message: 'Confirme o email da sua conta Vianova para ativar automações. Se já confirmou, saia e entre novamente.' }
      }

      const id = generateId()
      await db.insert(automations).values({
        id,
        workspaceId: params.workspaceId,
        type: body.type,
        name: body.name,
        active: body.active ?? true,
        sendTime,
        timezone: body.timezone ?? 'America/Sao_Paulo',
        contentJson: JSON.stringify(body.content ?? []),
        stepsJson: JSON.stringify(body.steps ?? []),
        stopOnTagsJson: JSON.stringify(body.stopOnTags ?? []),
        triggerJson: buildTriggerJson(body.type, body.triggerTag),
        speedJson: JSON.stringify(speed),
      })
      for (let i = 0; i < conns.length; i++) {
        await db.insert(automationConnections).values({ automationId: id, connectionId: conns[i]!.id, position: i })
      }

      const detail = await automationWithConnections(id)
      return { automation: detail ? { ...presentAutomation(detail.automation), connections: detail.connections } : null }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: AutomationTypeInput,
        connectionIds: t.Array(t.String(), { minItems: 1 }),
        content: t.Optional(ContentInput),
        steps: t.Optional(t.Array(StepInput)),
        stopOnTags: t.Optional(t.Array(t.String())),
        triggerTag: t.Optional(t.String()),
        sendTime: t.Optional(t.String()),
        timezone: t.Optional(t.String()),
        speed: t.Optional(SpeedSchema),
        active: t.Optional(t.Boolean()),
      }),
    },
  )

  // PATCH /workspaces/:workspaceId/automations/:automationId
  .patch(
    '/workspaces/:workspaceId/automations/:automationId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(automations)
        .where(and(eq(automations.id, params.automationId), eq(automations.workspaceId, params.workspaceId)))
        .limit(1)
      if (!existing) { set.status = 404; return { message: 'Automação não encontrada.' } }

      // Valida a forma final (campos do body sobrepostos ao que já existe)
      const mergedSteps = body.steps ?? parseJsonArray<AutomationStep>(existing.stepsJson)
      const mergedContent = body.content ?? parseJsonArray<{ body: string }>(existing.contentJson)
      const existingTriggerTag = parseTriggerConfig(existing.triggerJson).tag
      const mergedTriggerTag = body.triggerTag ?? existingTriggerTag
      const shapeError = validateAutomationShape({
        type: existing.type,
        content: mergedContent,
        steps: mergedSteps,
        triggerTag: mergedTriggerTag,
      })
      if (shapeError) { set.status = 400; return { message: shapeError } }

      if (body.active === true && !existing.active) {
        if (!session?.emailVerified) {
          set.status = 403
          return { message: 'Confirme o email da sua conta Vianova para ativar automações. Se já confirmou, saia e entre novamente.' }
        }
        const activeCount = await countActiveAutomations(params.workspaceId)
        const activationCheck = canActivateAutomation(ctx.entitlements, activeCount)
        if (!activationCheck.allowed) { set.status = 403; return { message: activationCheck.reason } }
      }

      const updates: Partial<typeof automations.$inferInsert> = { updatedAt: new Date() }
      if (body.name !== undefined) updates.name = body.name
      if (body.active !== undefined) updates.active = body.active
      if (body.timezone !== undefined) updates.timezone = body.timezone
      if (body.content !== undefined) updates.contentJson = JSON.stringify(body.content)
      if (body.steps !== undefined) updates.stepsJson = JSON.stringify(body.steps)
      if (body.stopOnTags !== undefined) updates.stopOnTagsJson = JSON.stringify(body.stopOnTags)
      if (body.triggerTag !== undefined) {
        updates.triggerJson = buildTriggerJson(existing.type, body.triggerTag, existing.triggerJson)
      }
      if (body.sendTime !== undefined) {
        if (!TIME_RE.test(body.sendTime)) { set.status = 400; return { message: 'Horário de envio inválido (use HH:mm).' } }
        updates.sendTime = body.sendTime
      }

      let conns = await loadWorkspaceConnections(params.workspaceId, body.connectionIds ?? [])
      if (body.connectionIds !== undefined) {
        if (conns.length !== body.connectionIds.length || conns.length === 0) {
          set.status = 400; return { message: 'Uma ou mais conexões selecionadas não existem neste workspace.' }
        }
      } else {
        const detail = await automationWithConnections(params.automationId)
        conns = (detail?.connections ?? []) as typeof conns
      }

      if (body.speed !== undefined) {
        const channels = [...new Set(conns.map((c) => c.channel))].filter(
          (c): c is SpeedChannel => c === 'whatsapp' || c === 'telegram',
        )
        const speedCheck = canUseSpeed(ctx.entitlements, body.speed, channels)
        if (!speedCheck.allowed) { set.status = 403; return { message: speedCheck.reason } }
        updates.speedJson = JSON.stringify(body.speed)
      }

      await db.update(automations).set(updates).where(eq(automations.id, params.automationId))

      if (body.connectionIds !== undefined) {
        await db.delete(automationConnections).where(eq(automationConnections.automationId, params.automationId))
        for (let i = 0; i < conns.length; i++) {
          await db.insert(automationConnections).values({ automationId: params.automationId, connectionId: conns[i]!.id, position: i })
        }
      }

      const detail = await automationWithConnections(params.automationId)
      return { automation: detail ? { ...presentAutomation(detail.automation), connections: detail.connections } : null }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        connectionIds: t.Optional(t.Array(t.String(), { minItems: 1 })),
        content: t.Optional(ContentInput),
        steps: t.Optional(t.Array(StepInput)),
        stopOnTags: t.Optional(t.Array(t.String())),
        triggerTag: t.Optional(t.String()),
        sendTime: t.Optional(t.String()),
        timezone: t.Optional(t.String()),
        speed: t.Optional(SpeedSchema),
        active: t.Optional(t.Boolean()),
      }),
    },
  )

  // POST /workspaces/:workspaceId/automations/:automationId/toggle
  .post(
    '/workspaces/:workspaceId/automations/:automationId/toggle',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(automations)
        .where(and(eq(automations.id, params.automationId), eq(automations.workspaceId, params.workspaceId)))
        .limit(1)
      if (!existing) { set.status = 404; return { message: 'Automação não encontrada.' } }

      if (!existing.active) {
        const activeCount = await countActiveAutomations(params.workspaceId)
        const activationCheck = canActivateAutomation(ctx.entitlements, activeCount)
        if (!activationCheck.allowed) { set.status = 403; return { message: activationCheck.reason } }
      }

      await db.update(automations).set({ active: !existing.active, updatedAt: new Date() }).where(eq(automations.id, existing.id))
      return { active: !existing.active }
    },
  )

  // DELETE /workspaces/:workspaceId/automations/:automationId
  .delete(
    '/workspaces/:workspaceId/automations/:automationId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(automations)
        .where(and(eq(automations.id, params.automationId), eq(automations.workspaceId, params.workspaceId)))
        .limit(1)
      if (!existing) { set.status = 404; return { message: 'Automação não encontrada.' } }

      // automationId em campaigns é referência fraca (sem FK) — limpa em código
      await db.update(campaigns).set({ automationId: null }).where(eq(campaigns.automationId, existing.id))
      await db.delete(automations).where(eq(automations.id, existing.id))
      return { message: 'Automação excluída.' }
    },
  )
