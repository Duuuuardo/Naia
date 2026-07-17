// Automações (triggers) — hoje só aniversário. A automação em si não envia
// nada: quando dispara, spawna uma campanha real (kind='automation') que herda
// runs, cota, pacing e histórico do modelo de campanhas.

import { Elysia, t } from 'elysia'
import { db, automations, automationConnections, connections, campaigns } from '@naia/db'
import { eq, and, desc, asc, inArray } from 'drizzle-orm'
import { canUseSpeed } from '@naia/entitlements'
import { SpeedSchema, type Speed, type SpeedChannel } from '@naia/schemas'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'

const ContentInput = t.Array(
  t.Object({
    body: t.String({ minLength: 1 }),
    mediaAssetIds: t.Optional(t.Array(t.String())),
  }),
  { minItems: 1 },
)

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

async function loadWorkspaceConnections(workspaceId: string, connectionIds: string[]) {
  const rows = await db
    .select()
    .from(connections)
    .where(and(inArray(connections.id, connectionIds), eq(connections.workspaceId, workspaceId)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return connectionIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
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

      const result = []
      for (const automation of rows) {
        const detail = await automationWithConnections(automation.id)
        result.push({ ...automation, connections: detail?.connections ?? [] })
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

      if (!TIME_RE.test(body.sendTime)) { set.status = 400; return { message: 'Horário de envio inválido (use HH:mm).' } }

      const conns = await loadWorkspaceConnections(params.workspaceId, body.connectionIds)
      if (conns.length !== body.connectionIds.length) {
        set.status = 400; return { message: 'Uma ou mais conexões selecionadas não existem neste workspace.' }
      }

      const speed: Speed = body.speed ?? { preset: 'medio' }
      const channels = [...new Set(conns.map((c) => c.channel))].filter(
        (c): c is SpeedChannel => c === 'whatsapp' || c === 'telegram',
      )
      const speedCheck = canUseSpeed(ctx.entitlements, speed, channels)
      if (!speedCheck.allowed) { set.status = 403; return { message: speedCheck.reason } }

      const id = generateId()
      await db.insert(automations).values({
        id,
        workspaceId: params.workspaceId,
        type: body.type,
        name: body.name,
        active: body.active ?? true,
        sendTime: body.sendTime,
        timezone: body.timezone ?? 'America/Sao_Paulo',
        contentJson: JSON.stringify(body.content),
        speedJson: JSON.stringify(speed),
      })
      for (let i = 0; i < conns.length; i++) {
        await db.insert(automationConnections).values({ automationId: id, connectionId: conns[i]!.id, position: i })
      }

      const detail = await automationWithConnections(id)
      return { automation: detail ? { ...detail.automation, connections: detail.connections } : null }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: t.Literal('birthday'),
        connectionIds: t.Array(t.String(), { minItems: 1 }),
        content: ContentInput,
        sendTime: t.String(),
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

      const updates: Partial<typeof automations.$inferInsert> = { updatedAt: new Date() }
      if (body.name !== undefined) updates.name = body.name
      if (body.active !== undefined) updates.active = body.active
      if (body.timezone !== undefined) updates.timezone = body.timezone
      if (body.content !== undefined) updates.contentJson = JSON.stringify(body.content)
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
      return { automation: detail ? { ...detail.automation, connections: detail.connections } : null }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        connectionIds: t.Optional(t.Array(t.String(), { minItems: 1 })),
        content: t.Optional(ContentInput),
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
