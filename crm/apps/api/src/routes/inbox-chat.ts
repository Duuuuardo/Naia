import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { agents, internalChatMembers, internalChatMessages, internalChats, queueMembers, queues, teamMembers, teams } from '@crm/db/schema'
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { wsHub } from '../services/ws-hub'

// Chat interno da equipe (dm, grupo ad-hoc, canal de fila) — separado das
// conversas de clientes. Qualquer agente ativado participa.
export const inboxChatRoutes = new Elysia({ name: 'inbox-chat' })
  .use(authInboxPlugin)

  // GET /inbox/chats — chats onde o agente é membro, com última mensagem,
  // contagem de não lidas (após lastReadAt) e membros (para título de dm).
  .get('/inbox/chats', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const memberships = await db
      .select({ chat: internalChats, lastReadAt: internalChatMembers.lastReadAt })
      .from(internalChatMembers)
      .innerJoin(internalChats, eq(internalChatMembers.chatId, internalChats.id))
      .where(and(eq(internalChatMembers.agentId, agent.id), eq(internalChats.workspaceId, agent.workspaceId)))

    const chats = await Promise.all(
      memberships.map(async ({ chat, lastReadAt }) => {
        const [lastMessage] = await db
          .select()
          .from(internalChatMessages)
          .where(eq(internalChatMessages.chatId, chat.id))
          .orderBy(desc(internalChatMessages.createdAt))
          .limit(1)

        const unreadWhere = lastReadAt
          ? and(eq(internalChatMessages.chatId, chat.id), gt(internalChatMessages.createdAt, lastReadAt))
          : eq(internalChatMessages.chatId, chat.id)
        const [unread] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(internalChatMessages)
          .where(unreadWhere)

        const members = await db
          .select({ agentId: internalChatMembers.agentId, name: agents.name })
          .from(internalChatMembers)
          .innerJoin(agents, eq(internalChatMembers.agentId, agents.id))
          .where(eq(internalChatMembers.chatId, chat.id))

        return { ...chat, lastMessage: lastMessage ?? null, unreadCount: unread?.count ?? 0, members }
      }),
    )

    // Mais recente primeiro (chats sem mensagem caem no createdAt).
    chats.sort(
      (a, b) =>
        (b.lastMessage?.createdAt ?? b.createdAt).getTime() - (a.lastMessage?.createdAt ?? a.createdAt).getTime(),
    )

    return { chats }
  })

  // POST /inbox/chats — cria dm (dedupe entre os dois agentes), grupo,
  // canal de fila (dedupe por fila; membros = queueMembers) ou canal de
  // equipe (dedupe por equipe; membros = teamMembers).
  .post(
    '/inbox/chats',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      let memberIds: string[] = []
      let chatName: string | null = null
      let chatQueueId: string | null = null
      let chatTeamId: string | null = null

      if (body.kind === 'dm') {
        const otherIds = (body.agentIds ?? []).filter((id) => id !== agent.id)
        if (otherIds.length !== 1) {
          set.status = 400
          return { message: 'DM exige exatamente 1 outro agente.' }
        }
        const otherId = otherIds[0]
        const [other] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, otherId), eq(agents.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!other) {
          set.status = 404
          return { message: 'Agente não encontrado.' }
        }

        // Dedupe: já existe dm entre os dois? Retorna o existente.
        const myDmChats = await db
          .select({ chatId: internalChatMembers.chatId })
          .from(internalChatMembers)
          .innerJoin(internalChats, eq(internalChatMembers.chatId, internalChats.id))
          .where(
            and(
              eq(internalChatMembers.agentId, agent.id),
              eq(internalChats.workspaceId, agent.workspaceId),
              eq(internalChats.kind, 'dm'),
            ),
          )
        if (myDmChats.length > 0) {
          const [existing] = await db
            .select({ chatId: internalChatMembers.chatId })
            .from(internalChatMembers)
            .where(
              and(
                inArray(internalChatMembers.chatId, myDmChats.map((m) => m.chatId)),
                eq(internalChatMembers.agentId, otherId),
              ),
            )
            .limit(1)
          if (existing) {
            const [chat] = await db.select().from(internalChats).where(eq(internalChats.id, existing.chatId)).limit(1)
            return { chat, existing: true }
          }
        }

        memberIds = [agent.id, otherId]
      } else if (body.kind === 'group') {
        const otherIds = [...new Set((body.agentIds ?? []).filter((id) => id !== agent.id))]
        if (otherIds.length === 0) {
          set.status = 400
          return { message: 'Grupo exige ao menos 1 outro agente.' }
        }
        if (!body.name) {
          set.status = 400
          return { message: 'Grupo exige um nome.' }
        }
        const found = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(inArray(agents.id, otherIds), eq(agents.workspaceId, agent.workspaceId)))
        if (found.length !== otherIds.length) {
          set.status = 404
          return { message: 'Um ou mais agentes não foram encontrados.' }
        }
        chatName = body.name
        memberIds = [agent.id, ...otherIds]
      } else if (body.kind === 'queue') {
        // kind === 'queue': canal da fila, membros = queueMembers.
        if (!body.queueId) {
          set.status = 400
          return { message: 'Chat de fila exige queueId.' }
        }
        const [queue] = await db
          .select()
          .from(queues)
          .where(and(eq(queues.id, body.queueId), eq(queues.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!queue) {
          set.status = 404
          return { message: 'Fila não encontrada.' }
        }

        // Dedupe: um canal por fila.
        const [existing] = await db
          .select()
          .from(internalChats)
          .where(
            and(
              eq(internalChats.workspaceId, agent.workspaceId),
              eq(internalChats.kind, 'queue'),
              eq(internalChats.queueId, queue.id),
            ),
          )
          .limit(1)
        if (existing) {
          return { chat: existing, existing: true }
        }

        const queueMemberRows = await db
          .select({ agentId: queueMembers.agentId })
          .from(queueMembers)
          .where(eq(queueMembers.queueId, queue.id))
        chatQueueId = queue.id
        chatName = queue.name
        memberIds = [...new Set([agent.id, ...queueMemberRows.map((m) => m.agentId)])]
      } else {
        // kind === 'team': canal da equipe, membros = teamMembers.
        if (!body.teamId) {
          set.status = 400
          return { message: 'Chat de equipe exige teamId.' }
        }
        const [team] = await db
          .select()
          .from(teams)
          .where(and(eq(teams.id, body.teamId), eq(teams.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!team) {
          set.status = 404
          return { message: 'Equipe não encontrada.' }
        }

        // Dedupe: um canal por equipe.
        const [existing] = await db
          .select()
          .from(internalChats)
          .where(
            and(
              eq(internalChats.workspaceId, agent.workspaceId),
              eq(internalChats.kind, 'team'),
              eq(internalChats.teamId, team.id),
            ),
          )
          .limit(1)
        if (existing) {
          return { chat: existing, existing: true }
        }

        const teamMemberRows = await db
          .select({ agentId: teamMembers.agentId })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, team.id))
        chatTeamId = team.id
        chatName = team.name
        memberIds = [...new Set([agent.id, ...teamMemberRows.map((m) => m.agentId)])]
      }

      const chatId = generateId()
      const [chat] = await db
        .insert(internalChats)
        .values({
          id: chatId,
          workspaceId: agent.workspaceId,
          kind: body.kind,
          name: chatName,
          queueId: chatQueueId,
          teamId: chatTeamId,
          createdByAgentId: agent.id,
        })
        .returning()
      await db.insert(internalChatMembers).values(memberIds.map((agentId) => ({ chatId, agentId })))

      return { chat, existing: false }
    },
    {
      body: t.Object({
        kind: t.Union([t.Literal('dm'), t.Literal('group'), t.Literal('queue'), t.Literal('team')]),
        agentIds: t.Optional(t.Array(t.String())),
        queueId: t.Optional(t.String()),
        teamId: t.Optional(t.String()),
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
      }),
    },
  )

  // GET /inbox/chats/:id/messages — paginação por cursor (?before=<messageId>),
  // 50 por página, retornadas em ordem cronológica.
  .get(
    '/inbox/chats/:id/messages',
    async ({ agent, params, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const membership = await getMembership(params.id, agent.id, agent.workspaceId)
      if (!membership) {
        set.status = 404
        return { message: 'Chat não encontrado.' }
      }

      const conditions = [eq(internalChatMessages.chatId, params.id)]
      if (query.before) {
        const [anchor] = await db
          .select({ createdAt: internalChatMessages.createdAt })
          .from(internalChatMessages)
          .where(and(eq(internalChatMessages.id, query.before), eq(internalChatMessages.chatId, params.id)))
          .limit(1)
        if (!anchor) {
          set.status = 400
          return { message: 'Cursor inválido.' }
        }
        conditions.push(lt(internalChatMessages.createdAt, anchor.createdAt))
      }

      const rows = await db
        .select()
        .from(internalChatMessages)
        .where(and(...conditions))
        .orderBy(desc(internalChatMessages.createdAt))
        .limit(50)

      return { messages: rows.reverse(), hasMore: rows.length === 50 }
    },
    {
      query: t.Object({ before: t.Optional(t.String()) }),
    },
  )

  // POST /inbox/chats/:id/messages — envia mensagem e notifica os membros via WS.
  .post(
    '/inbox/chats/:id/messages',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const membership = await getMembership(params.id, agent.id, agent.workspaceId)
      if (!membership) {
        set.status = 404
        return { message: 'Chat não encontrado.' }
      }

      const messageId = generateId()
      const [message] = await db
        .insert(internalChatMessages)
        .values({ id: messageId, chatId: params.id, senderAgentId: agent.id, content: body.content })
        .returning()

      // Remetente já "leu" até a própria mensagem.
      await db
        .update(internalChatMembers)
        .set({ lastReadAt: new Date() })
        .where(and(eq(internalChatMembers.chatId, params.id), eq(internalChatMembers.agentId, agent.id)))

      const members = await db
        .select({ agentId: internalChatMembers.agentId })
        .from(internalChatMembers)
        .where(eq(internalChatMembers.chatId, params.id))
      wsHub.broadcastToAgents(
        agent.workspaceId,
        members.map((m) => m.agentId),
        { type: 'internal:message:new', chatId: params.id, message },
      )

      return { message }
    },
    {
      body: t.Object({ content: t.String({ minLength: 1, maxLength: 4000 }) }),
    },
  )

  // POST /inbox/chats/:id/read — marca o chat como lido até agora.
  .post('/inbox/chats/:id/read', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const membership = await getMembership(params.id, agent.id, agent.workspaceId)
    if (!membership) {
      set.status = 404
      return { message: 'Chat não encontrado.' }
    }

    await db
      .update(internalChatMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(internalChatMembers.chatId, params.id), eq(internalChatMembers.agentId, agent.id)))

    return { ok: true }
  })

// Confere que o chat existe no workspace do agente e que ele é membro.
async function getMembership(chatId: string, agentId: string, workspaceId: string) {
  const [row] = await db
    .select({ chatId: internalChatMembers.chatId })
    .from(internalChatMembers)
    .innerJoin(internalChats, eq(internalChatMembers.chatId, internalChats.id))
    .where(
      and(
        eq(internalChatMembers.chatId, chatId),
        eq(internalChatMembers.agentId, agentId),
        eq(internalChats.workspaceId, workspaceId),
      ),
    )
    .limit(1)
  return row ?? null
}
