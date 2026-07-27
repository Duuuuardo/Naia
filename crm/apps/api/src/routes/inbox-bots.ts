import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { botFlows, botSessions } from '@crm/db/schema'
import { eq, and, desc, count, inArray, gte } from 'drizzle-orm'
import { canActivateBot } from '@crm/entitlements'
import type { BotFlowDefinition } from '@crm/schemas'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { isSuperadmin } from '../lib/superadmin'
import { getWorkspaceEntitlements } from '../lib/workspace-entitlements'

// TypeBox da definition do fluxo — espelha BotFlowDefinition de @crm/schemas.
const BotDefinitionBody = t.Object({
  nodes: t.Array(
    t.Object({
      id: t.String({ minLength: 1 }),
      kind: t.Union([
        t.Literal('start'),
        t.Literal('message'),
        t.Literal('menu'),
        t.Literal('buttons'),
        t.Literal('condition'),
        t.Literal('collect_input'),
        t.Literal('delay'),
        t.Literal('assign_queue'),
        t.Literal('assign_agent'),
        t.Literal('close_conversation'),
        t.Literal('manage_tag'),
        t.Literal('webhook'),
        t.Literal('end'),
      ]),
      position: t.Optional(t.Object({ x: t.Number(), y: t.Number() })),
      data: t.Record(t.String(), t.Unknown()),
    }),
  ),
  edges: t.Array(
    t.Object({
      id: t.String({ minLength: 1 }),
      source: t.String({ minLength: 1 }),
      target: t.String({ minLength: 1 }),
      sourceHandle: t.Optional(t.String()),
    }),
  ),
})

// Validação estrutural do grafo: exatamente 1 nó start, ids de nó únicos e
// arestas com source/target existentes. Retorna a mensagem de erro ou null.
function validateBotDefinition(definition: BotFlowDefinition): string | null {
  if (definition.nodes.length === 0) {
    return 'O fluxo precisa de ao menos um nó.'
  }
  const nodeIds = new Set(definition.nodes.map((n) => n.id))
  if (nodeIds.size !== definition.nodes.length) {
    return 'Há nós com id duplicado no fluxo.'
  }
  const startCount = definition.nodes.filter((n) => n.kind === 'start').length
  if (startCount !== 1) {
    return 'O fluxo precisa de exatamente um nó do tipo start.'
  }
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return `A aresta ${edge.id} aponta para um nó inexistente.`
    }
  }
  return null
}

export const inboxBotsRoutes = new Elysia({ name: 'inbox-bots' })
  .use(authInboxPlugin)

  // GET /inbox/bots — lista de fluxos do workspace (leitura para todo agente).
  .get('/inbox/bots', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const rows = await db
      .select({
        id: botFlows.id,
        name: botFlows.name,
        status: botFlows.status,
        triggerKind: botFlows.triggerKind,
        triggerKeywords: botFlows.triggerKeywords,
        createdAt: botFlows.createdAt,
        updatedAt: botFlows.updatedAt,
      })
      .from(botFlows)
      .where(eq(botFlows.workspaceId, agent.workspaceId))
      .orderBy(desc(botFlows.updatedAt))

    return { bots: rows }
  })

  // GET /inbox/bots/:id — fluxo completo, com a definition (editor visual).
  .get('/inbox/bots/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [bot] = await db
      .select()
      .from(botFlows)
      .where(and(eq(botFlows.id, params.id), eq(botFlows.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!bot) {
      set.status = 404
      return { message: 'Fluxo não encontrado.' }
    }

    return { bot }
  })

  // POST /inbox/bots — superadmin cria fluxo (nasce draft).
  .post(
    '/inbox/bots',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem criar fluxos de bot.' }
      }

      const invalid = validateBotDefinition(body.definition)
      if (invalid) {
        set.status = 400
        return { message: invalid }
      }

      const [bot] = await db
        .insert(botFlows)
        .values({
          id: generateId(),
          workspaceId: agent.workspaceId,
          name: body.name,
          triggerKind: body.triggerKind,
          triggerKeywords: body.triggerKeywords ?? [],
          definition: body.definition,
          createdByAgentId: agent.id,
        })
        .returning()

      set.status = 201
      return { bot }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        triggerKind: t.Union([t.Literal('new_conversation'), t.Literal('keyword'), t.Literal('always')]),
        triggerKeywords: t.Optional(t.Array(t.String())),
        definition: BotDefinitionBody,
      }),
    },
  )

  // PATCH /inbox/bots/:id — superadmin edita nome, gatilho e definition.
  .patch(
    '/inbox/bots/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem editar fluxos de bot.' }
      }

      const [existing] = await db
        .select({ id: botFlows.id })
        .from(botFlows)
        .where(and(eq(botFlows.id, params.id), eq(botFlows.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Fluxo não encontrado.' }
      }

      if (body.definition) {
        const invalid = validateBotDefinition(body.definition)
        if (invalid) {
          set.status = 400
          return { message: invalid }
        }
      }

      const [bot] = await db
        .update(botFlows)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.triggerKind !== undefined ? { triggerKind: body.triggerKind } : {}),
          ...(body.triggerKeywords !== undefined ? { triggerKeywords: body.triggerKeywords } : {}),
          ...(body.definition !== undefined ? { definition: body.definition } : {}),
          updatedAt: new Date(),
        })
        .where(eq(botFlows.id, params.id))
        .returning()

      return { bot }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        triggerKind: t.Optional(
          t.Union([t.Literal('new_conversation'), t.Literal('keyword'), t.Literal('always')]),
        ),
        triggerKeywords: t.Optional(t.Array(t.String())),
        definition: t.Optional(BotDefinitionBody),
      }),
    },
  )

  // DELETE /inbox/bots/:id — superadmin; recusa se houver sessão viva do bot
  // (running ou waiting_input — ambas têm conversa em atendimento pelo bot).
  .delete('/inbox/bots/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem excluir fluxos de bot.' }
    }

    const [existing] = await db
      .select({ id: botFlows.id })
      .from(botFlows)
      .where(and(eq(botFlows.id, params.id), eq(botFlows.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!existing) {
      set.status = 404
      return { message: 'Fluxo não encontrado.' }
    }

    const [{ value: runningCount }] = await db
      .select({ value: count() })
      .from(botSessions)
      .where(and(eq(botSessions.flowId, params.id), inArray(botSessions.status, ['running', 'waiting_input'])))
    if (runningCount > 0) {
      set.status = 409
      return { message: `O fluxo tem ${runningCount} sessão(ões) em andamento. Pause o bot e aguarde finalizar antes de excluir.` }
    }

    await db.delete(botFlows).where(eq(botFlows.id, params.id))
    return { deleted: true as const }
  })

  // POST /inbox/bots/:id/publish — superadmin publica (draft/paused → active),
  // limitado pelo plano (canActivateBot conta flows active do workspace).
  .post('/inbox/bots/:id/publish', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem publicar fluxos de bot.' }
    }

    const [existing] = await db
      .select()
      .from(botFlows)
      .where(and(eq(botFlows.id, params.id), eq(botFlows.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!existing) {
      set.status = 404
      return { message: 'Fluxo não encontrado.' }
    }
    if (existing.status === 'active') {
      set.status = 409
      return { message: 'O fluxo já está publicado.' }
    }

    const entitlements = await getWorkspaceEntitlements(agent.workspaceId)
    const [{ value: activeCount }] = await db
      .select({ value: count() })
      .from(botFlows)
      .where(and(eq(botFlows.workspaceId, agent.workspaceId), eq(botFlows.status, 'active')))

    const check = canActivateBot(entitlements, activeCount)
    if (!check.allowed) {
      set.status = 403
      return { message: check.reason }
    }

    const [bot] = await db
      .update(botFlows)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(botFlows.id, params.id))
      .returning()

    return { bot }
  })

  // POST /inbox/bots/:id/pause — superadmin pausa (active → paused).
  .post('/inbox/bots/:id/pause', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem pausar fluxos de bot.' }
    }

    const [existing] = await db
      .select({ status: botFlows.status })
      .from(botFlows)
      .where(and(eq(botFlows.id, params.id), eq(botFlows.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!existing) {
      set.status = 404
      return { message: 'Fluxo não encontrado.' }
    }
    if (existing.status !== 'active') {
      set.status = 409
      return { message: 'Só é possível pausar um fluxo publicado.' }
    }

    const [bot] = await db
      .update(botFlows)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(botFlows.id, params.id))
      .returning()

    return { bot }
  })

  // GET /inbox/bots/:id/stats?days=30 — superadmin: agregado das sessões do
  // flow no período (padrão 30 dias, limitado a 1-90). Convenção de status:
  // completed = sessões 'finished'; running inclui 'waiting_input' (ambas têm
  // conversa em atendimento pelo bot). perDay é preenchido para todos os dias
  // do período (UTC), com started pelo createdAt e completed/failed pelo
  // updatedAt das sessões iniciadas no período.
  .get(
    '/inbox/bots/:id/stats',
    async ({ agent, params, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem ver as estatísticas do bot.' }
      }

      const [existing] = await db
        .select({ id: botFlows.id })
        .from(botFlows)
        .where(and(eq(botFlows.id, params.id), eq(botFlows.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Fluxo não encontrado.' }
      }

      const parsedDays = Number.parseInt(query.days ?? '30', 10)
      const days = Number.isFinite(parsedDays) ? Math.min(90, Math.max(1, parsedDays)) : 30
      const MS_PER_DAY = 24 * 60 * 60 * 1000
      // Começa no início do dia (UTC) para o perDay bater com as datas.
      const today = new Date()
      const startDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)))

      const sessions = await db
        .select({
          status: botSessions.status,
          createdAt: botSessions.createdAt,
          updatedAt: botSessions.updatedAt,
        })
        .from(botSessions)
        .where(
          and(
            eq(botSessions.flowId, params.id),
            eq(botSessions.workspaceId, agent.workspaceId),
            gte(botSessions.createdAt, startDay),
          ),
        )

      const byStatus = { running: 0, completed: 0, handed_off: 0, failed: 0, cancelled: 0 }
      const perDayMap = new Map<string, { date: string; started: number; completed: number; failed: number }>()
      for (let i = 0; i < days; i++) {
        const date = new Date(startDay.getTime() + i * MS_PER_DAY).toISOString().slice(0, 10)
        perDayMap.set(date, { date, started: 0, completed: 0, failed: 0 })
      }

      for (const session of sessions) {
        if (session.status === 'finished') byStatus.completed += 1
        else if (session.status === 'running' || session.status === 'waiting_input') byStatus.running += 1
        else byStatus[session.status] += 1

        const startedDay = perDayMap.get(session.createdAt.toISOString().slice(0, 10))
        if (startedDay) startedDay.started += 1

        if (session.status === 'finished' || session.status === 'failed') {
          const endDay = perDayMap.get(session.updatedAt.toISOString().slice(0, 10))
          if (endDay) {
            if (session.status === 'finished') endDay.completed += 1
            else endDay.failed += 1
          }
        }
      }

      const total = sessions.length
      return {
        total,
        byStatus,
        completionRate: total > 0 ? byStatus.completed / total : 0,
        perDay: [...perDayMap.values()],
      }
    },
    {
      query: t.Object({
        days: t.Optional(t.String()),
      }),
    },
  )
