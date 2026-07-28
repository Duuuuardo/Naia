import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import {
  agents,
  botFlows,
  connections,
  entitlements,
  queues,
  queueMembers,
  teamMembers,
  teams,
  workspaces,
  workspaceSettings,
  type BusinessHoursEntry,
} from '@crm/db/schema'
import { eq, and, count, asc } from 'drizzle-orm'
import { canAddConnection, canAddQueue } from '@crm/entitlements'
import {
  effectiveAgentPermissions,
  type WorkspaceAgentPermissions,
  type WorkspaceRolePermissions,
} from '@crm/schemas'
import { authInboxPlugin, requireSuperadmin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { sendAgentActivation } from '../lib/agent-activation'
import { startWhatsApp, startTelegram, reconnect, disconnect, getStatus } from '../lib/session-host-client'
import { wsHub } from '../services/ws-hub'

// Overrides de permissão de agente são persistidos na mesma coluna jsonb
// workspaces.role_permissions, sob a chave separada `agentOverrides` — a
// coluna guarda a matriz de managers E a de agentes, evitando migração.
type RolePermissionsColumn = WorkspaceRolePermissions & { agentOverrides?: WorkspaceAgentPermissions }

const AgentPermissionMapSchema = t.Partial(
  t.Object({
    conversations_assign: t.Boolean(),
    labels: t.Boolean(),
    quick_replies_manage: t.Boolean(),
    reports: t.Boolean(),
  }),
)

// Rotas administrativas do inbox (contexto do agente). TODAS exigem
// superadmin — o apex (management) não gerencia mais estas áreas.
export const inboxAdminRoutes = new Elysia({ name: 'inbox-admin' })
  .use(authInboxPlugin)

  // ─── Agentes ──────────────────────────────────────────────────────────────

  // GET /inbox/admin/agents — lista com papel e status de ativação.
  .get('/inbox/admin/agents', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        email: agents.email,
        role: agents.role,
        activatedAt: agents.activatedAt,
        lastLoginAt: agents.lastLoginAt,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.workspaceId, agent.workspaceId))
      .orderBy(asc(agents.createdAt))

    return { agents: rows }
  })

  // PATCH /inbox/admin/agents/:id/role — altera o papel de um agente.
  .patch(
    '/inbox/admin/agents/:id/role',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      // O superadmin não pode rebaixar a si mesmo — senão o workspace fica
      // sem ninguém capaz de administrar o inbox.
      if (params.id === agent.id) {
        set.status = 400
        return { message: 'Você não pode alterar o próprio papel.' }
      }

      const [target] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, params.id), eq(agents.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!target) {
        set.status = 404
        return { message: 'Agente não encontrado.' }
      }

      await db.update(agents).set({ role: body.role }).where(eq(agents.id, params.id))
      return { agent: { id: params.id, role: body.role } }
    },
    {
      body: t.Object({
        role: t.Union([t.Literal('superadmin'), t.Literal('admin'), t.Literal('agent')]),
      }),
    },
  )

  // POST /inbox/admin/agents/:id/resend-activation — reenvia o email de
  // ativação (agente ainda não definiu senha).
  .post('/inbox/admin/agents/:id/resend-activation', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [target] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, params.id), eq(agents.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!target) {
      set.status = 404
      return { message: 'Agente não encontrado.' }
    }
    if (target.activatedAt) {
      set.status = 400
      return { message: 'Este agente já ativou a conta.' }
    }

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, agent.workspaceId)).limit(1)
    if (!workspace) {
      set.status = 500
      return { message: 'Workspace não encontrado.' }
    }

    try {
      await sendAgentActivation({
        agentId: target.id,
        agentName: target.name,
        agentEmail: target.email,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
      })
    } catch (error) {
      console.error('[inbox-admin] falha ao reenviar ativação:', error)
      set.status = 502
      return { message: 'Não foi possível reenviar o email. Tente novamente.' }
    }

    return { activationEmailSent: true as const }
  })

  // ─── Conexões ─────────────────────────────────────────────────────────────

  // GET /inbox/admin/connections — lista com status e fila padrão.
  .get('/inbox/admin/connections', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const rows = await db
      .select({
        id: connections.id,
        name: connections.name,
        kind: connections.kind,
        status: connections.status,
        defaultQueueId: connections.defaultQueueId,
        welcomeMessage: connections.welcomeMessage,
        createdAt: connections.createdAt,
      })
      .from(connections)
      .where(eq(connections.workspaceId, agent.workspaceId))
      .orderBy(asc(connections.createdAt))

    return { connections: rows }
  })

  // POST /inbox/admin/connections — cria a conexão (nasce 'disconnected') e
  // dispara a sessão no session-host em background (QR chega via WS).
  .post(
    '/inbox/admin/connections',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      if (body.kind === 'telegram' && !body.token) {
        set.status = 400
        return { message: 'Informe o token do bot do Telegram (BotFather).' }
      }

      if (body.defaultQueueId) {
        const [queue] = await db
          .select({ id: queues.id })
          .from(queues)
          .where(and(eq(queues.id, body.defaultQueueId), eq(queues.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!queue) {
          set.status = 400
          return { message: 'Fila padrão não encontrada neste workspace.' }
        }
      }

      // Mesma validação de entitlement do management: limite de conexões.
      const [ent] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.workspaceId, agent.workspaceId))
        .limit(1)
      if (!ent) {
        set.status = 403
        return { message: 'Assinatura do workspace não sincronizada. Tente novamente em instantes.' }
      }

      const [{ count: connCount }] = await db
        .select({ count: count() })
        .from(connections)
        .where(eq(connections.workspaceId, agent.workspaceId))

      const check = canAddConnection(ent, connCount)
      if (!check.allowed) {
        set.status = 403
        return { message: check.reason, upgradeUrl: '/billing' }
      }

      const connectionId = generateId()
      await db.insert(connections).values({
        id: connectionId,
        workspaceId: agent.workspaceId,
        name: body.name,
        kind: body.kind,
        status: 'disconnected',
        // Token do bot Telegram fica na config — o session-host lê de lá no start.
        config: body.kind === 'telegram' ? { botToken: body.token } : {},
        defaultQueueId: body.defaultQueueId ?? null,
        welcomeMessage: body.welcomeMessage ?? null,
      })

      // Sessão sobe em background: falha aqui não desfaz a conexão — o
      // superadmin pode tentar de novo pelo /reconnect.
      const start = body.kind === 'whatsapp' ? startWhatsApp : startTelegram
      start(connectionId).catch((error) => console.error('[inbox-admin] falha ao iniciar sessão:', error))

      wsHub.broadcast(agent.workspaceId, {
        type: 'connection:status',
        connectionId,
        status: 'disconnected',
      })

      return {
        connection: {
          id: connectionId,
          name: body.name,
          kind: body.kind,
          status: 'disconnected' as const,
          welcomeMessage: body.welcomeMessage ?? null,
        },
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        kind: t.Union([t.Literal('whatsapp'), t.Literal('telegram')]),
        token: t.Optional(t.String({ minLength: 1 })),
        defaultQueueId: t.Optional(t.String()),
        welcomeMessage: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )

  // PATCH /inbox/admin/connections/:id — atualiza nome, fila padrão e a
  // mensagem de boas-vindas (enviada pelo worker quando uma conversa NOVA
  // nasce na conexão sem bot; null/string vazia desliga).
  .patch(
    '/inbox/admin/connections/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [connection] = await db
        .select({ id: connections.id })
        .from(connections)
        .where(and(eq(connections.id, params.id), eq(connections.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!connection) {
        set.status = 404
        return { message: 'Conexão não encontrada.' }
      }

      if (body.defaultQueueId) {
        const [queue] = await db
          .select({ id: queues.id })
          .from(queues)
          .where(and(eq(queues.id, body.defaultQueueId), eq(queues.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!queue) {
          set.status = 400
          return { message: 'Fila padrão não encontrada neste workspace.' }
        }
      }

      const welcomeMessage =
        body.welcomeMessage !== undefined
          ? body.welcomeMessage === null || body.welcomeMessage.trim().length === 0
            ? null
            : body.welcomeMessage
          : undefined

      const [updated] = await db
        .update(connections)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.defaultQueueId !== undefined ? { defaultQueueId: body.defaultQueueId } : {}),
          ...(welcomeMessage !== undefined ? { welcomeMessage } : {}),
          updatedAt: new Date(),
        })
        .where(eq(connections.id, params.id))
        .returning({
          id: connections.id,
          name: connections.name,
          kind: connections.kind,
          status: connections.status,
          defaultQueueId: connections.defaultQueueId,
          welcomeMessage: connections.welcomeMessage,
        })

      return { connection: updated }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        defaultQueueId: t.Optional(t.String()),
        welcomeMessage: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
      }),
    },
  )

  // DELETE /inbox/admin/connections/:id — encerra a sessão no host e remove.
  .delete('/inbox/admin/connections/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [connection] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, params.id), eq(connections.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!connection) {
      set.status = 404
      return { message: 'Conexão não encontrada.' }
    }

    // Desconecta no session-host (best effort — a remoção não pode falhar
    // se o host estiver fora do ar).
    await disconnect(connection.id, connection.kind).catch((error) =>
      console.error('[inbox-admin] falha ao desconectar sessão:', error),
    )

    await db.delete(connections).where(eq(connections.id, connection.id))

    wsHub.broadcast(agent.workspaceId, {
      type: 'connection:status',
      connectionId: connection.id,
      status: 'disconnected',
    })

    return { message: 'Conexão removida.' }
  })

  // POST /inbox/admin/connections/:id/reconnect — derruba e sobe a sessão.
  .post('/inbox/admin/connections/:id/reconnect', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [connection] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, params.id), eq(connections.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!connection) {
      set.status = 404
      return { message: 'Conexão não encontrada.' }
    }

    try {
      await reconnect(connection.id, connection.kind)
    } catch (error) {
      console.error('[inbox-admin] falha ao reconectar:', error)
      set.status = 502
      return { message: 'Session-host indisponível. Tente novamente.' }
    }

    return { message: 'Reconexão iniciada.' }
  })

  // GET /inbox/admin/connections/:id/status — proxy do status em tempo real
  // do session-host (fallback de polling quando o WS não cobre). Se o host
  // estiver fora, cai no status persistido no banco.
  .get('/inbox/admin/connections/:id/status', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [connection] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, params.id), eq(connections.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!connection) {
      set.status = 404
      return { message: 'Conexão não encontrada.' }
    }

    try {
      const status = await getStatus(connection.id)
      return { connectionId: connection.id, ...status }
    } catch {
      return { connectionId: connection.id, socketStatus: 'disconnected' as const, qr: null }
    }
  })

  // ─── Filas ────────────────────────────────────────────────────────────────

  // GET /inbox/admin/queues — filas com seus membros.
  .get('/inbox/admin/queues', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const rows = await db
      .select()
      .from(queues)
      .where(eq(queues.workspaceId, agent.workspaceId))
      .orderBy(asc(queues.createdAt))

    const members = await db
      .select({
        queueId: queueMembers.queueId,
        agentId: queueMembers.agentId,
        agentName: agents.name,
      })
      .from(queueMembers)
      .innerJoin(agents, eq(queueMembers.agentId, agents.id))
      .where(eq(agents.workspaceId, agent.workspaceId))

    return {
      queues: rows.map((queue) => ({
        ...queue,
        members: members.filter((m) => m.queueId === queue.id),
      })),
    }
  })

  // POST /inbox/admin/queues — cria fila (gating por plano via canAddQueue).
  .post(
    '/inbox/admin/queues',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [ent] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.workspaceId, agent.workspaceId))
        .limit(1)
      if (!ent) {
        set.status = 403
        return { message: 'Assinatura do workspace não sincronizada. Tente novamente em instantes.' }
      }

      const [{ count: queueCount }] = await db
        .select({ count: count() })
        .from(queues)
        .where(eq(queues.workspaceId, agent.workspaceId))

      const check = canAddQueue(ent, queueCount)
      if (!check.allowed) {
        set.status = 403
        return { message: check.reason, upgradeUrl: '/billing' }
      }

      const queueId = generateId()
      const [queue] = await db
        .insert(queues)
        .values({
          id: queueId,
          workspaceId: agent.workspaceId,
          name: body.name,
          color: body.color,
          description: body.description ?? null,
        })
        .returning()

      return { queue: { ...queue, members: [] as { queueId: string; agentId: string; agentName: string }[] } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        color: t.String({ minLength: 1, maxLength: 20 }),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )

  // PATCH /inbox/admin/queues/:id — atualiza nome/cor/descrição.
  .patch(
    '/inbox/admin/queues/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [queue] = await db
        .select({ id: queues.id })
        .from(queues)
        .where(and(eq(queues.id, params.id), eq(queues.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!queue) {
        set.status = 404
        return { message: 'Fila não encontrada.' }
      }

      const [updated] = await db
        .update(queues)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        })
        .where(eq(queues.id, params.id))
        .returning()

      return { queue: updated }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        color: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )

  // DELETE /inbox/admin/queues/:id — conversas da fila ficam sem fila
  // (conversations.queueId tem onDelete: set null).
  .delete('/inbox/admin/queues/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [queue] = await db
      .select({ id: queues.id })
      .from(queues)
      .where(and(eq(queues.id, params.id), eq(queues.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!queue) {
      set.status = 404
      return { message: 'Fila não encontrada.' }
    }

    await db.delete(queues).where(eq(queues.id, params.id))
    return { message: 'Fila removida.' }
  })

  // PUT /inbox/admin/queues/:id/members — substitui os membros da fila.
  .put(
    '/inbox/admin/queues/:id/members',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [queue] = await db
        .select({ id: queues.id })
        .from(queues)
        .where(and(eq(queues.id, params.id), eq(queues.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!queue) {
        set.status = 404
        return { message: 'Fila não encontrada.' }
      }

      // Só aceita agentes do próprio workspace.
      const validAgents = await db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.workspaceId, agent.workspaceId))
      const validIds = new Set(validAgents.map((a) => a.id))
      const agentIds = [...new Set(body.agentIds)].filter((id) => validIds.has(id))

      await db.delete(queueMembers).where(eq(queueMembers.queueId, params.id))
      if (agentIds.length > 0) {
        await db.insert(queueMembers).values(agentIds.map((agentId) => ({ queueId: params.id, agentId })))
      }

      return { queueId: params.id, agentIds }
    },
    {
      body: t.Object({
        agentIds: t.Array(t.String(), { maxItems: 200 }),
      }),
    },
  )

  // ─── Equipes ──────────────────────────────────────────────────────────────

  // GET /inbox/admin/teams — equipes com membros e filas vinculadas.
  .get('/inbox/admin/teams', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const rows = await db
      .select()
      .from(teams)
      .where(eq(teams.workspaceId, agent.workspaceId))
      .orderBy(asc(teams.createdAt))

    const members = await db
      .select({
        teamId: teamMembers.teamId,
        agentId: teamMembers.agentId,
        agentName: agents.name,
      })
      .from(teamMembers)
      .innerJoin(agents, eq(teamMembers.agentId, agents.id))
      .where(eq(agents.workspaceId, agent.workspaceId))

    const linkedQueues = await db
      .select({ id: queues.id, name: queues.name, teamId: queues.teamId })
      .from(queues)
      .where(eq(queues.workspaceId, agent.workspaceId))

    return {
      teams: rows.map((team) => ({
        ...team,
        members: members.filter((m) => m.teamId === team.id),
        queues: linkedQueues
          .filter((q) => q.teamId === team.id)
          .map((q) => ({ id: q.id, name: q.name })),
      })),
    }
  })

  // POST /inbox/admin/teams — cria equipe (nasce sem membros e sem filas).
  .post(
    '/inbox/admin/teams',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [team] = await db
        .insert(teams)
        .values({
          id: generateId(),
          workspaceId: agent.workspaceId,
          name: body.name,
          color: body.color,
          description: body.description ?? null,
        })
        .returning()

      return {
        team: {
          ...team,
          members: [] as { teamId: string; agentId: string; agentName: string }[],
          queues: [] as { id: string; name: string }[],
        },
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        color: t.String({ minLength: 1, maxLength: 20 }),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )

  // PATCH /inbox/admin/teams/:id — atualiza nome/cor/descrição.
  .patch(
    '/inbox/admin/teams/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, params.id), eq(teams.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!team) {
        set.status = 404
        return { message: 'Equipe não encontrada.' }
      }

      const [updated] = await db
        .update(teams)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        })
        .where(eq(teams.id, params.id))
        .returning()

      return { team: updated }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        color: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )

  // DELETE /inbox/admin/teams/:id — filas da equipe ficam sem equipe
  // (queues.teamId tem onDelete: set null); membros caem em cascade.
  .delete('/inbox/admin/teams/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, params.id), eq(teams.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!team) {
      set.status = 404
      return { message: 'Equipe não encontrada.' }
    }

    await db.delete(teams).where(eq(teams.id, params.id))
    return { message: 'Equipe removida.' }
  })

  // PUT /inbox/admin/teams/:id/members — substitui os membros da equipe.
  .put(
    '/inbox/admin/teams/:id/members',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, params.id), eq(teams.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!team) {
        set.status = 404
        return { message: 'Equipe não encontrada.' }
      }

      // Só aceita agentes do próprio workspace.
      const validAgents = await db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.workspaceId, agent.workspaceId))
      const validIds = new Set(validAgents.map((a) => a.id))
      const agentIds = [...new Set(body.agentIds)].filter((id) => validIds.has(id))

      await db.delete(teamMembers).where(eq(teamMembers.teamId, params.id))
      if (agentIds.length > 0) {
        await db.insert(teamMembers).values(agentIds.map((agentId) => ({ teamId: params.id, agentId })))
      }

      return { teamId: params.id, agentIds }
    },
    {
      body: t.Object({
        agentIds: t.Array(t.String(), { maxItems: 200 }),
      }),
    },
  )

  // PATCH /inbox/admin/queues/:id/team — atribui (ou remove, com null) a
  // equipe responsável pela fila.
  .patch(
    '/inbox/admin/queues/:id/team',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [queue] = await db
        .select({ id: queues.id })
        .from(queues)
        .where(and(eq(queues.id, params.id), eq(queues.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!queue) {
        set.status = 404
        return { message: 'Fila não encontrada.' }
      }

      if (body.teamId !== null) {
        const [team] = await db
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.id, body.teamId), eq(teams.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!team) {
          set.status = 404
          return { message: 'Equipe não encontrada.' }
        }
      }

      const [updated] = await db
        .update(queues)
        .set({ teamId: body.teamId })
        .where(eq(queues.id, params.id))
        .returning()

      return { queue: updated }
    },
    {
      body: t.Object({
        teamId: t.Union([t.String(), t.Null()]),
      }),
    },
  )

  // ─── Configurações do workspace (horários de atendimento) ─────────────────

  // GET /inbox/admin/settings — horários, comportamento fora de horário e CSAT.
  // Cria a linha default em workspace_settings na primeira leitura.
  .get('/inbox/admin/settings', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [settings] = await db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, agent.workspaceId))
      .limit(1)

    if (!settings) {
      const [created] = await db
        .insert(workspaceSettings)
        .values({ workspaceId: agent.workspaceId })
        .returning()
      return {
        businessHours: created.businessHours,
        outOfHoursMode: created.outOfHoursMode,
        outOfHoursMessage: created.outOfHoursMessage,
        outOfHoursBotFlowId: created.outOfHoursBotFlowId,
        csatEnabled: created.csatEnabled,
        csatMessage: created.csatMessage,
        csatThankYouMessage: created.csatThankYouMessage,
        identifyAgent: created.identifyAgent,
      }
    }

    return {
      businessHours: settings.businessHours,
      outOfHoursMode: settings.outOfHoursMode,
      outOfHoursMessage: settings.outOfHoursMessage,
      outOfHoursBotFlowId: settings.outOfHoursBotFlowId,
      csatEnabled: settings.csatEnabled,
      csatMessage: settings.csatMessage,
      csatThankYouMessage: settings.csatThankYouMessage,
      identifyAgent: settings.identifyAgent,
    }
  })

  // PATCH /inbox/admin/settings — atualização parcial dos campos.
  // businessHours null = sem restrição (24h); outOfHoursBotFlowId precisa
  // apontar para um bot flow do próprio workspace (ou null).
  .patch(
    '/inbox/admin/settings',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      if (body.outOfHoursBotFlowId !== undefined && body.outOfHoursBotFlowId !== null) {
        const [flow] = await db
          .select({ id: botFlows.id })
          .from(botFlows)
          .where(and(eq(botFlows.id, body.outOfHoursBotFlowId), eq(botFlows.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!flow) {
          set.status = 400
          return { message: 'Fluxo de bot não encontrado neste workspace.' }
        }
      }

      // Garante a linha antes do update (workspace_settings é 1:1, criada sob demanda).
      await db
        .insert(workspaceSettings)
        .values({ workspaceId: agent.workspaceId })
        .onConflictDoNothing()

      const [updated] = await db
        .update(workspaceSettings)
        .set({
          ...(body.businessHours !== undefined
            ? { businessHours: body.businessHours as BusinessHoursEntry[] | null }
            : {}),
          ...(body.outOfHoursMode !== undefined ? { outOfHoursMode: body.outOfHoursMode } : {}),
          ...(body.outOfHoursMessage !== undefined ? { outOfHoursMessage: body.outOfHoursMessage } : {}),
          ...(body.outOfHoursBotFlowId !== undefined ? { outOfHoursBotFlowId: body.outOfHoursBotFlowId } : {}),
          ...(body.csatEnabled !== undefined ? { csatEnabled: body.csatEnabled } : {}),
          ...(body.csatMessage !== undefined ? { csatMessage: body.csatMessage } : {}),
          ...(body.csatThankYouMessage !== undefined ? { csatThankYouMessage: body.csatThankYouMessage } : {}),
          ...(body.identifyAgent !== undefined ? { identifyAgent: body.identifyAgent } : {}),
          updatedAt: new Date(),
        })
        .where(eq(workspaceSettings.workspaceId, agent.workspaceId))
        .returning()

      return {
        businessHours: updated.businessHours,
        outOfHoursMode: updated.outOfHoursMode,
        outOfHoursMessage: updated.outOfHoursMessage,
        outOfHoursBotFlowId: updated.outOfHoursBotFlowId,
        csatEnabled: updated.csatEnabled,
        csatMessage: updated.csatMessage,
        csatThankYouMessage: updated.csatThankYouMessage,
        identifyAgent: updated.identifyAgent,
      }
    },
    {
      body: t.Object({
        businessHours: t.Optional(
          t.Union([
            t.Array(
              t.Object({
                day: t.Integer({ minimum: 0, maximum: 6 }),
                start: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
                end: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
              }),
              { maxItems: 7 },
            ),
            t.Null(),
          ]),
        ),
        outOfHoursMode: t.Optional(
          t.Union([t.Literal('none'), t.Literal('auto_reply'), t.Literal('bot'), t.Literal('both')]),
        ),
        outOfHoursMessage: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
        outOfHoursBotFlowId: t.Optional(t.Union([t.String(), t.Null()])),
        csatEnabled: t.Optional(t.Boolean()),
        csatMessage: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
        csatThankYouMessage: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
        identifyAgent: t.Optional(t.Boolean()),
      }),
    },
  )

  // ─── Permissões de agente ─────────────────────────────────────────────────

  // GET /inbox/admin/agent-permissions — matriz efetiva (defaults + overrides).
  .get('/inbox/admin/agent-permissions', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!requireSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem acessar esta área.' }
    }

    const [workspace] = await db
      .select({ rolePermissions: workspaces.rolePermissions })
      .from(workspaces)
      .where(eq(workspaces.id, agent.workspaceId))
      .limit(1)

    const overrides = (workspace?.rolePermissions as RolePermissionsColumn | null)?.agentOverrides ?? {}

    return {
      overrides,
      effective: {
        admin: effectiveAgentPermissions('admin', overrides),
        agent: effectiveAgentPermissions('agent', overrides),
      },
    }
  })

  // PATCH /inbox/admin/agent-permissions — salva os overrides por papel.
  // Substitui a matriz de overrides inteira (o painel sempre envia o estado
  // completo do formulário).
  .patch(
    '/inbox/admin/agent-permissions',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!requireSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem acessar esta área.' }
      }

      const [workspace] = await db
        .select({ rolePermissions: workspaces.rolePermissions })
        .from(workspaces)
        .where(eq(workspaces.id, agent.workspaceId))
        .limit(1)
      if (!workspace) {
        set.status = 404
        return { message: 'Workspace não encontrado.' }
      }

      const current = (workspace.rolePermissions ?? {}) as RolePermissionsColumn
      const next: RolePermissionsColumn = {
        ...current,
        agentOverrides: {
          ...(body.admin !== undefined ? { admin: body.admin } : {}),
          ...(body.agent !== undefined ? { agent: body.agent } : {}),
        },
      }

      await db
        .update(workspaces)
        .set({ rolePermissions: next as WorkspaceRolePermissions })
        .where(eq(workspaces.id, agent.workspaceId))

      const overrides = next.agentOverrides ?? {}
      return {
        overrides,
        effective: {
          admin: effectiveAgentPermissions('admin', overrides),
          agent: effectiveAgentPermissions('agent', overrides),
        },
      }
    },
    {
      body: t.Object({
        admin: t.Optional(AgentPermissionMapSchema),
        agent: t.Optional(AgentPermissionMapSchema),
      }),
    },
  )
