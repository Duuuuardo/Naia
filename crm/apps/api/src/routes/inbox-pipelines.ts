import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import {
  pipelines,
  pipelineStages,
  deals,
  contacts,
  conversations,
  agents,
  queues,
} from '@crm/db/schema'
import { eq, and, asc, desc, count, max, inArray } from 'drizzle-orm'
import { canAddPipeline } from '@crm/entitlements'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { isSuperadmin } from '../lib/superadmin'
import { getWorkspaceEntitlements } from '../lib/workspace-entitlements'

// Estágio pertence ao workspace? (stage → pipeline → workspaceId)
async function stageInWorkspace(stageId: string, workspaceId: string) {
  const [row] = await db
    .select({ stage: pipelineStages, pipelineId: pipelines.id })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelineStages.pipelineId, pipelines.id))
    .where(and(eq(pipelineStages.id, stageId), eq(pipelines.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

export const inboxPipelinesRoutes = new Elysia({ name: 'inbox-pipelines' })
  .use(authInboxPlugin)

  // GET /inbox/pipelines — funis com estágios ordenados e contagem de deals
  // abertos por estágio (visão do kanban).
  .get('/inbox/pipelines', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const rows = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.workspaceId, agent.workspaceId))
      .orderBy(asc(pipelines.position), asc(pipelines.createdAt))

    if (rows.length === 0) {
      return { pipelines: [] }
    }

    const pipelineIds = rows.map((p) => p.id)
    const stages = await db
      .select()
      .from(pipelineStages)
      .where(inArray(pipelineStages.pipelineId, pipelineIds))
      .orderBy(asc(pipelineStages.position))

    const openCounts = await db
      .select({ stageId: deals.stageId, value: count() })
      .from(deals)
      .where(and(eq(deals.workspaceId, agent.workspaceId), eq(deals.status, 'open')))
      .groupBy(deals.stageId)
    const countByStage = new Map(openCounts.map((r) => [r.stageId, r.value]))

    return {
      pipelines: rows.map((pipeline) => ({
        ...pipeline,
        stages: stages
          .filter((s) => s.pipelineId === pipeline.id)
          .map((s) => ({ ...s, openDeals: countByStage.get(s.id) ?? 0 })),
      })),
    }
  })

  // POST /inbox/pipelines — superadmin, limitado pelo plano (canAddPipeline).
  .post(
    '/inbox/pipelines',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem criar funis.' }
      }

      const entitlements = await getWorkspaceEntitlements(agent.workspaceId)
      const [{ value: currentCount }] = await db
        .select({ value: count() })
        .from(pipelines)
        .where(eq(pipelines.workspaceId, agent.workspaceId))

      const check = canAddPipeline(entitlements, currentCount)
      if (!check.allowed) {
        set.status = 403
        return { message: check.reason }
      }

      const [pipeline] = await db
        .insert(pipelines)
        .values({ id: generateId(), workspaceId: agent.workspaceId, name: body.name, position: currentCount })
        .returning()

      set.status = 201
      return { pipeline }
    },
    {
      body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
    },
  )

  // PATCH /inbox/pipelines/:id — superadmin renomeia.
  .patch(
    '/inbox/pipelines/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem editar funis.' }
      }

      const [pipeline] = await db
        .update(pipelines)
        .set({ ...(body.name !== undefined ? { name: body.name } : {}) })
        .where(and(eq(pipelines.id, params.id), eq(pipelines.workspaceId, agent.workspaceId)))
        .returning()
      if (!pipeline) {
        set.status = 404
        return { message: 'Funil não encontrado.' }
      }

      return { pipeline }
    },
    {
      body: t.Object({ name: t.Optional(t.String({ minLength: 1, maxLength: 100 })) }),
    },
  )

  // DELETE /inbox/pipelines/:id — superadmin; recusa se houver deals.
  .delete('/inbox/pipelines/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem excluir funis.' }
    }

    const [pipeline] = await db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(and(eq(pipelines.id, params.id), eq(pipelines.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!pipeline) {
      set.status = 404
      return { message: 'Funil não encontrado.' }
    }

    const [{ value: dealCount }] = await db
      .select({ value: count() })
      .from(deals)
      .where(eq(deals.pipelineId, pipeline.id))
    if (dealCount > 0) {
      set.status = 409
      return { message: `O funil tem ${dealCount} deal(s). Mova ou exclua os deals antes de excluir o funil.` }
    }

    // Estágios caem em cascade (pipeline_stages → pipelines).
    await db.delete(pipelines).where(eq(pipelines.id, pipeline.id))
    return { deleted: true as const }
  })

  // POST /inbox/pipelines/:id/stages — superadmin cria estágio ao final.
  .post(
    '/inbox/pipelines/:id/stages',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem criar estágios.' }
      }

      const [pipeline] = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.id, params.id), eq(pipelines.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!pipeline) {
        set.status = 404
        return { message: 'Funil não encontrado.' }
      }

      const [{ value: maxPosition }] = await db
        .select({ value: max(pipelineStages.position) })
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, pipeline.id))

      const [stage] = await db
        .insert(pipelineStages)
        .values({
          id: generateId(),
          pipelineId: pipeline.id,
          name: body.name,
          color: body.color,
          kind: body.kind ?? 'open',
          position: (maxPosition ?? -1) + 1,
        })
        .returning()

      set.status = 201
      return { stage }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        color: t.String({ minLength: 1, maxLength: 30 }),
        kind: t.Optional(t.Union([t.Literal('open'), t.Literal('won'), t.Literal('lost')])),
      }),
    },
  )

  // PATCH /inbox/stages/:id — superadmin edita nome/cor/kind.
  .patch(
    '/inbox/stages/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem editar estágios.' }
      }

      const found = await stageInWorkspace(params.id, agent.workspaceId)
      if (!found) {
        set.status = 404
        return { message: 'Estágio não encontrado.' }
      }

      const [stage] = await db
        .update(pipelineStages)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
        })
        .where(eq(pipelineStages.id, params.id))
        .returning()

      return { stage }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        color: t.Optional(t.String({ minLength: 1, maxLength: 30 })),
        kind: t.Optional(t.Union([t.Literal('open'), t.Literal('won'), t.Literal('lost')])),
      }),
    },
  )

  // DELETE /inbox/stages/:id — superadmin; recusa se houver deals no estágio.
  .delete('/inbox/stages/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem excluir estágios.' }
    }

    const found = await stageInWorkspace(params.id, agent.workspaceId)
    if (!found) {
      set.status = 404
      return { message: 'Estágio não encontrado.' }
    }

    const [{ value: dealCount }] = await db
      .select({ value: count() })
      .from(deals)
      .where(eq(deals.stageId, params.id))
    if (dealCount > 0) {
      set.status = 409
      return { message: `O estágio tem ${dealCount} deal(s). Mova ou exclua os deals antes de excluir o estágio.` }
    }

    await db.delete(pipelineStages).where(eq(pipelineStages.id, params.id))
    return { deleted: true as const }
  })

  // POST /inbox/stages/:id/move — superadmin troca a position com o vizinho
  // (up = sobe uma posição, down = desce).
  .post(
    '/inbox/stages/:id/move',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem reordenar estágios.' }
      }

      const found = await stageInWorkspace(params.id, agent.workspaceId)
      if (!found) {
        set.status = 404
        return { message: 'Estágio não encontrado.' }
      }

      const stages = await db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, found.stage.pipelineId))
        .orderBy(asc(pipelineStages.position))

      const index = stages.findIndex((s) => s.id === params.id)
      const neighborIndex = body.direction === 'up' ? index - 1 : index + 1
      if (neighborIndex < 0 || neighborIndex >= stages.length) {
        set.status = 400
        return { message: 'O estágio já está na extremidade.' }
      }

      const current = stages[index]
      const neighbor = stages[neighborIndex]
      await db.transaction(async (tx) => {
        await tx
          .update(pipelineStages)
          .set({ position: neighbor.position })
          .where(eq(pipelineStages.id, current.id))
        await tx
          .update(pipelineStages)
          .set({ position: current.position })
          .where(eq(pipelineStages.id, neighbor.id))
      })

      return { moved: true as const }
    },
    {
      body: t.Object({ direction: t.Union([t.Literal('up'), t.Literal('down')]) }),
    },
  )

  // GET /inbox/pipelines/:id/deals — deals abertos agrupados por estágio
  // (kanban), com nome do contato, agente responsável e fila.
  .get('/inbox/pipelines/:id/deals', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [pipeline] = await db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, params.id), eq(pipelines.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!pipeline) {
      set.status = 404
      return { message: 'Funil não encontrado.' }
    }

    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipeline.id))
      .orderBy(asc(pipelineStages.position))

    const rows = await db
      .select({
        deal: deals,
        contactName: contacts.name,
        agentName: agents.name,
        queueName: queues.name,
      })
      .from(deals)
      .innerJoin(contacts, eq(deals.contactId, contacts.id))
      .leftJoin(agents, eq(deals.assignedAgentId, agents.id))
      .leftJoin(queues, eq(deals.queueId, queues.id))
      .where(and(eq(deals.pipelineId, pipeline.id), eq(deals.status, 'open')))
      .orderBy(asc(deals.position), desc(deals.createdAt))

    const dealsByStage = new Map<string, typeof rows>()
    for (const row of rows) {
      const list = dealsByStage.get(row.deal.stageId) ?? []
      list.push(row)
      dealsByStage.set(row.deal.stageId, list)
    }

    return {
      pipeline,
      stages: stages.map((stage) => ({
        ...stage,
        deals: (dealsByStage.get(stage.id) ?? []).map((row) => ({
          ...row.deal,
          contactName: row.contactName,
          agentName: row.agentName,
          queueName: row.queueName,
        })),
      })),
    }
  })

  // POST /inbox/pipelines/:id/deals — qualquer agente cria. Sem stageId, cai
  // no primeiro estágio kind 'open'. Criar direto em estágio won/lost já fecha
  // o deal com o status correspondente.
  .post(
    '/inbox/pipelines/:id/deals',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [pipeline] = await db
        .select()
        .from(pipelines)
        .where(and(eq(pipelines.id, params.id), eq(pipelines.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!pipeline) {
        set.status = 404
        return { message: 'Funil não encontrado.' }
      }

      const [contact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, body.contactId), eq(contacts.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!contact) {
        set.status = 404
        return { message: 'Contato não encontrado.' }
      }

      // Resolve o estágio: explícito (validado contra o funil) ou default.
      let stage: typeof pipelineStages.$inferSelect | undefined
      if (body.stageId) {
        const [row] = await db
          .select()
          .from(pipelineStages)
          .where(and(eq(pipelineStages.id, body.stageId), eq(pipelineStages.pipelineId, pipeline.id)))
          .limit(1)
        stage = row
        if (!stage) {
          set.status = 400
          return { message: 'Estágio não pertence a este funil.' }
        }
      } else {
        const [row] = await db
          .select()
          .from(pipelineStages)
          .where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.kind, 'open')))
          .orderBy(asc(pipelineStages.position))
          .limit(1)
        stage = row
        if (!stage) {
          set.status = 400
          return { message: 'O funil não tem estágio aberto para receber o deal.' }
        }
      }

      // Valida vínculos opcionais no workspace.
      if (body.assignedAgentId) {
        const [row] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, body.assignedAgentId), eq(agents.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!row) {
          set.status = 400
          return { message: 'Agente responsável inválido.' }
        }
      }
      if (body.queueId) {
        const [row] = await db
          .select({ id: queues.id })
          .from(queues)
          .where(and(eq(queues.id, body.queueId), eq(queues.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!row) {
          set.status = 400
          return { message: 'Fila inválida.' }
        }
      }
      if (body.conversationId) {
        const [row] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, body.conversationId), eq(conversations.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!row) {
          set.status = 400
          return { message: 'Conversa inválida.' }
        }
      }

      const [{ value: maxPosition }] = await db
        .select({ value: max(deals.position) })
        .from(deals)
        .where(and(eq(deals.stageId, stage.id), eq(deals.status, 'open')))

      const closed = stage.kind === 'won' || stage.kind === 'lost'
      const [deal] = await db
        .insert(deals)
        .values({
          id: generateId(),
          workspaceId: agent.workspaceId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          contactId: contact.id,
          conversationId: body.conversationId,
          title: body.title,
          valueCents: body.valueCents ?? 0,
          assignedAgentId: body.assignedAgentId,
          queueId: body.queueId,
          status: closed ? stage.kind : 'open',
          closedAt: closed ? new Date() : null,
          position: (maxPosition ?? -1) + 1,
        })
        .returning()

      set.status = 201
      return { deal }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        contactId: t.String({ minLength: 1 }),
        stageId: t.Optional(t.String()),
        valueCents: t.Optional(t.Integer({ minimum: 0 })),
        assignedAgentId: t.Optional(t.String()),
        queueId: t.Optional(t.String()),
        conversationId: t.Optional(t.String()),
      }),
    },
  )

  // PATCH /inbox/deals/:id — qualquer agente edita campos do deal.
  .patch(
    '/inbox/deals/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [existing] = await db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.id, params.id), eq(deals.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Deal não encontrado.' }
      }

      // Valida vínculos opcionais no workspace quando informados.
      if (body.assignedAgentId) {
        const [row] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, body.assignedAgentId), eq(agents.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!row) {
          set.status = 400
          return { message: 'Agente responsável inválido.' }
        }
      }
      if (body.queueId) {
        const [row] = await db
          .select({ id: queues.id })
          .from(queues)
          .where(and(eq(queues.id, body.queueId), eq(queues.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!row) {
          set.status = 400
          return { message: 'Fila inválida.' }
        }
      }
      if (body.conversationId) {
        const [row] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, body.conversationId), eq(conversations.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!row) {
          set.status = 400
          return { message: 'Conversa inválida.' }
        }
      }

      const [deal] = await db
        .update(deals)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.valueCents !== undefined ? { valueCents: body.valueCents } : {}),
          ...(body.assignedAgentId !== undefined ? { assignedAgentId: body.assignedAgentId } : {}),
          ...(body.queueId !== undefined ? { queueId: body.queueId } : {}),
          ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
          ...(body.lostReason !== undefined ? { lostReason: body.lostReason } : {}),
          updatedAt: new Date(),
        })
        .where(eq(deals.id, params.id))
        .returning()

      return { deal }
    },
    {
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        valueCents: t.Optional(t.Integer({ minimum: 0 })),
        assignedAgentId: t.Optional(t.Nullable(t.String())),
        queueId: t.Optional(t.Nullable(t.String())),
        conversationId: t.Optional(t.Nullable(t.String())),
        lostReason: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    },
  )

  // POST /inbox/deals/:id/move — move o deal de estágio/posição (kanban dnd).
  // Estágio kind won/lost fecha o deal (status + closedAt); voltar para open
  // reabre (limpa closedAt e lostReason).
  .post(
    '/inbox/deals/:id/move',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [existing] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, params.id), eq(deals.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Deal não encontrado.' }
      }

      const [stage] = await db
        .select({ stage: pipelineStages, pipelineId: pipelines.id })
        .from(pipelineStages)
        .innerJoin(pipelines, eq(pipelineStages.pipelineId, pipelines.id))
        .where(and(eq(pipelineStages.id, body.stageId), eq(pipelines.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!stage) {
        set.status = 400
        return { message: 'Estágio de destino inválido.' }
      }

      const closed = stage.stage.kind === 'won' || stage.stage.kind === 'lost'
      const [deal] = await db
        .update(deals)
        .set({
          stageId: stage.stage.id,
          // Mover para estágio de outro funil troca o pipelineId junto.
          pipelineId: stage.pipelineId,
          position: body.position,
          status: closed ? stage.stage.kind : 'open',
          closedAt: closed ? new Date() : null,
          ...(closed ? {} : { lostReason: null }),
          updatedAt: new Date(),
        })
        .where(eq(deals.id, params.id))
        .returning()

      return { deal }
    },
    {
      body: t.Object({
        stageId: t.String({ minLength: 1 }),
        position: t.Integer({ minimum: 0 }),
      }),
    },
  )

  // DELETE /inbox/deals/:id — qualquer agente exclui.
  .delete('/inbox/deals/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [deleted] = await db
      .delete(deals)
      .where(and(eq(deals.id, params.id), eq(deals.workspaceId, agent.workspaceId)))
      .returning({ id: deals.id })
    if (!deleted) {
      set.status = 404
      return { message: 'Deal não encontrado.' }
    }

    return { deleted: true as const }
  })
