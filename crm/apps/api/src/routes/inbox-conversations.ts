import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import {
  agents,
  botFlows,
  botSessions,
  connections,
  contactIdentities,
  contacts,
  conversations,
  conversationRatings,
  conversationReads,
  conversationTransfers,
  conversationTags,
  files,
  internalNotes,
  messages,
  queueMembers,
  queues,
  tags,
  workspaceSettings,
  type MessageAttachment,
} from '@crm/db/schema'
import { CRM_QUEUES, defaultCrmJobOptions, getCrmQueue, type OutboundMessageJob } from '@crm/queue'
import { eq, and, or, desc, inArray, isNull, gt, lt, count } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { assignConversation, resolveConversation, reopenConversation, markPending, canTransition, InvalidTransitionError } from '../services/conversation-state'
import { maybeSendCsatSurvey } from '../services/csat'
import { wsHub } from '../services/ws-hub'
import { resolveContactAvatarUrl } from '../lib/contact-avatar'

// Fila de envio real (worker consome e chama o session-host via HTTP interno).
// Instância única e lazy para não exigir Redis no import do módulo.
let outboundQueue: ReturnType<typeof getCrmQueue<OutboundMessageJob>> | null = null
function getOutboundQueue() {
  if (!outboundQueue) {
    outboundQueue = getCrmQueue<OutboundMessageJob>(CRM_QUEUES.OUTBOUND_MESSAGES)
  }
  return outboundQueue
}

// Takeover humano (Pegar/atribuir/transferir): cancela a sessão de bot viva e
// limpa o badge "Chatbot atendendo". Retorna o flowId cancelado (para broadcast)
// ou null se não havia bot ativo. O worker também respeita o dono humano na
// próxima mensagem; aqui garantimos que o badge some na hora do clique.
async function silenceBotOnTakeover(conversationId: string): Promise<string | null> {
  const [session] = await db
    .select({ id: botSessions.id, flowId: botSessions.flowId })
    .from(botSessions)
    .where(
      and(
        eq(botSessions.conversationId, conversationId),
        inArray(botSessions.status, ['running', 'waiting_input']),
      ),
    )
    .limit(1)
  if (!session) return null

  const now = new Date()
  await db.update(botSessions).set({ status: 'cancelled', updatedAt: now }).where(eq(botSessions.id, session.id))
  await db
    .update(conversations)
    .set({ activeBotFlowId: null, updatedAt: now })
    .where(eq(conversations.id, conversationId))
  return session.flowId
}

// Upsert de leitura: marca a conversa como lida pelo agente até agora.
// Idempotente — usado pelo POST /:id/read e ao agente enviar mensagem.
async function markConversationRead(conversationId: string, agentId: string) {
  await db
    .insert(conversationReads)
    .values({ conversationId, agentId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [conversationReads.conversationId, conversationReads.agentId],
      set: { lastReadAt: new Date() },
    })
}

export const inboxConversationsRoutes = new Elysia({ name: 'inbox-conversations' })
  .use(authInboxPlugin)

  // GET /inbox/conversations — lista com filtros.
  // filter: mine | unassigned | all (default all); status: open|assigned|pending|resolved
  // queue: mine_queues (filas do agente) | no_queue | id de fila específico
  .get(
    '/inbox/conversations',
    async ({ agent, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const conditions = [eq(conversations.workspaceId, agent.workspaceId)]
      if (query.status) {
        conditions.push(eq(conversations.status, query.status as any))
      }
      if (query.filter === 'mine') {
        conditions.push(eq(conversations.assignedAgentId, agent.id))
      }
      if (query.queue === 'mine_queues') {
        conditions.push(
          inArray(
            conversations.queueId,
            db.select({ queueId: queueMembers.queueId }).from(queueMembers).where(eq(queueMembers.agentId, agent.id)),
          ),
        )
      } else if (query.queue === 'no_queue') {
        conditions.push(isNull(conversations.queueId))
      } else if (query.queue) {
        conditions.push(eq(conversations.queueId, query.queue))
      }

      let rows = await db
        .select({
          id: conversations.id,
          protocol: conversations.protocol,
          status: conversations.status,
          // Título manual (renomear conversa); null = usa o nome do contato.
          title: conversations.title,
          assignedAgentId: conversations.assignedAgentId,
          queueId: conversations.queueId,
          queueName: queues.name,
          // Bot atendendo agora → badge "Chatbot atendendo" na lista.
          activeBotFlowId: conversations.activeBotFlowId,
          activeBotFlowName: botFlows.name,
          updatedAt: conversations.updatedAt,
          contactId: contacts.id,
          contactName: contacts.name,
          contactAvatarUrl: contacts.avatarUrl,
          contactAvatarStorageKey: contacts.avatarStorageKey,
          // Canal de origem sai da identity primária do contato.
          originChannel: contactIdentities.channelType,
        })
        .from(conversations)
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .leftJoin(
          contactIdentities,
          and(eq(contactIdentities.contactId, contacts.id), eq(contactIdentities.isPrimary, true)),
        )
        .leftJoin(queues, eq(conversations.queueId, queues.id))
        .leftJoin(botFlows, eq(conversations.activeBotFlowId, botFlows.id))
        .where(and(...conditions))
        .orderBy(desc(conversations.updatedAt))
        .limit(100)

      // Filtro 'unassigned' aplicado após query (assignedAgentId IS NULL).
      if (query.filter === 'unassigned') {
        rows = rows.filter((r) => r.assignedAgentId === null)
      }

      // Labels da conversa agora são tags (nomes) vindas de conversation_tags.
      const conversationIds = rows.map((r) => r.id)
      const tagRows = conversationIds.length
        ? await db
            .select({ conversationId: conversationTags.conversationId, name: tags.name })
            .from(conversationTags)
            .innerJoin(tags, eq(conversationTags.tagId, tags.id))
            .where(inArray(conversationTags.conversationId, conversationIds))
        : []
      const labelsByConversation = new Map<string, string[]>()
      for (const tr of tagRows) {
        const list = labelsByConversation.get(tr.conversationId) ?? []
        list.push(tr.name)
        labelsByConversation.set(tr.conversationId, list)
      }

      // Preview da última mensagem: um DISTINCT ON em batch para a página
      // (não N+1). Conteúdo truncado em ~80 chars no retorno.
      const lastMessageRows = conversationIds.length
        ? await db
            .selectDistinctOn([messages.conversationId], {
              conversationId: messages.conversationId,
              content: messages.content,
              kind: messages.kind,
              direction: messages.direction,
              sentAt: messages.sentAt,
            })
            .from(messages)
            .where(inArray(messages.conversationId, conversationIds))
            .orderBy(messages.conversationId, desc(messages.sentAt), desc(messages.id))
        : []
      const lastMessageByConversation = new Map(lastMessageRows.map((m) => [m.conversationId, m]))

      // Não lidas por conversa (para o agente autenticado): mensagens inbound
      // após o lastReadAt; sem registro de leitura = todas as inbound contam.
      // Três queries em batch para a página, sem query por conversa.
      const readRows = conversationIds.length
        ? await db
            .select({ conversationId: conversationReads.conversationId })
            .from(conversationReads)
            .where(and(inArray(conversationReads.conversationId, conversationIds), eq(conversationReads.agentId, agent.id)))
        : []
      const readConversationIds = new Set(readRows.map((r) => r.conversationId))

      const inboundTotalRows = conversationIds.length
        ? await db
            .select({ conversationId: messages.conversationId, total: count() })
            .from(messages)
            .where(and(inArray(messages.conversationId, conversationIds), eq(messages.direction, 'inbound')))
            .groupBy(messages.conversationId)
        : []
      const inboundTotalByConversation = new Map(inboundTotalRows.map((r) => [r.conversationId, r.total]))

      const inboundUnreadRows = conversationIds.length
        ? await db
            .select({ conversationId: messages.conversationId, total: count() })
            .from(messages)
            .innerJoin(
              conversationReads,
              and(eq(conversationReads.conversationId, messages.conversationId), eq(conversationReads.agentId, agent.id)),
            )
            .where(
              and(
                inArray(messages.conversationId, conversationIds),
                eq(messages.direction, 'inbound'),
                gt(messages.sentAt, conversationReads.lastReadAt),
              ),
            )
            .groupBy(messages.conversationId)
        : []
      const inboundUnreadByConversation = new Map(inboundUnreadRows.map((r) => [r.conversationId, r.total]))

      return {
        conversations: rows.map((r) => {
          const { contactAvatarStorageKey, contactAvatarUrl, ...rest } = r
          const last = lastMessageByConversation.get(r.id)
          return {
            ...rest,
            // Avatar efetivo (manual OU foto do canal via presigned URL).
            contactAvatarUrl: resolveContactAvatarUrl({
              avatarUrl: contactAvatarUrl,
              avatarStorageKey: contactAvatarStorageKey,
            }),
            labels: labelsByConversation.get(r.id) ?? [],
            lastMessage: last
              ? {
                  content: last.content.length > 80 ? `${last.content.slice(0, 80)}…` : last.content,
                  kind: last.kind,
                  direction: last.direction,
                  sentAt: last.sentAt,
                }
              : null,
            unreadCount: readConversationIds.has(r.id)
              ? (inboundUnreadByConversation.get(r.id) ?? 0)
              : (inboundTotalByConversation.get(r.id) ?? 0),
          }
        }),
      }
    },
    {
      query: t.Object({
        filter: t.Optional(t.Union([t.Literal('mine'), t.Literal('unassigned'), t.Literal('all')])),
        status: t.Optional(t.Union([t.Literal('open'), t.Literal('assigned'), t.Literal('pending'), t.Literal('resolved')])),
        queue: t.Optional(t.String()),
      }),
    },
  )

  // GET /inbox/conversations/:id — histórico + notas + contato +
  // transferências (com nomes de agentes/filas) + bot ativo + avaliação CSAT.
  // Paginação da thread: ?limit=1..200&before=<messageId> retorna as
  // mensagens mais recentes ANTES do cursor (createdAt+id composto), sempre
  // em ordem cronológica, com hasMore/nextCursor. Sem limit, retorna tudo
  // (comportamento anterior), com hasMore=false.
  .get(
    '/inbox/conversations/:id',
    async ({ agent, params, query, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    const [contactRow] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId)).limit(1)
    // Avatar efetivo (manual OU foto do canal via presigned URL).
    const contact = contactRow
      ? { ...contactRow, avatarUrl: resolveContactAvatarUrl(contactRow) }
      : contactRow

    // agentName: nome do agente autor de mensagens outbound (null em inbound/bot).
    // Com limit: página das mais recentes (desc) virada para ordem cronológica;
    // busca limit+1 para calcular hasMore. Cursor `before` = id de mensagem;
    // desempate por id porque ids são hex aleatório (não ordenáveis).
    let msgs: Array<typeof messages.$inferSelect & { agentName: string | null }>
    let hasMore = false
    let nextCursor: string | null = null
    if (query.limit) {
      const conditions = [eq(messages.conversationId, params.id)]
      if (query.before) {
        const [cursor] = await db
          .select({ id: messages.id, sentAt: messages.sentAt })
          .from(messages)
          .where(and(eq(messages.id, query.before), eq(messages.conversationId, params.id)))
          .limit(1)
        if (!cursor) {
          set.status = 400
          return { message: 'Cursor inválido: mensagem não encontrada nesta conversa.' }
        }
        conditions.push(
          or(lt(messages.sentAt, cursor.sentAt), and(eq(messages.sentAt, cursor.sentAt), lt(messages.id, cursor.id)))!,
        )
      }
      const msgRows = await db
        .select({ message: messages, agentName: agents.name })
        .from(messages)
        .leftJoin(agents, eq(messages.agentId, agents.id))
        .where(and(...conditions))
        .orderBy(desc(messages.sentAt), desc(messages.id))
        .limit(query.limit + 1)
      hasMore = msgRows.length > query.limit
      const page = msgRows.slice(0, query.limit).reverse()
      nextCursor = hasMore ? (page[0]?.message.id ?? null) : null
      msgs = page.map((row) => ({ ...row.message, agentName: row.agentName }))
    } else {
      const msgRows = await db
        .select({ message: messages, agentName: agents.name })
        .from(messages)
        .leftJoin(agents, eq(messages.agentId, agents.id))
        .where(eq(messages.conversationId, params.id))
        .orderBy(messages.sentAt)
      msgs = msgRows.map((row) => ({ ...row.message, agentName: row.agentName }))
    }
    const notes = await db
      .select()
      .from(internalNotes)
      .where(eq(internalNotes.conversationId, params.id))
      .orderBy(internalNotes.createdAt)

    // Aliases para resolver nomes de origem/destino/autor das transferências.
    const fromAgents = alias(agents, 'from_agents')
    const toAgents = alias(agents, 'to_agents')
    const byAgents = alias(agents, 'by_agents')
    const fromQueues = alias(queues, 'from_queues')
    const toQueues = alias(queues, 'to_queues')
    const transfers = await db
      .select({
        id: conversationTransfers.id,
        note: conversationTransfers.note,
        createdAt: conversationTransfers.createdAt,
        fromAgentId: conversationTransfers.fromAgentId,
        fromAgentName: fromAgents.name,
        fromQueueId: conversationTransfers.fromQueueId,
        fromQueueName: fromQueues.name,
        toAgentId: conversationTransfers.toAgentId,
        toAgentName: toAgents.name,
        toQueueId: conversationTransfers.toQueueId,
        toQueueName: toQueues.name,
        transferredByAgentId: conversationTransfers.transferredByAgentId,
        transferredByAgentName: byAgents.name,
      })
      .from(conversationTransfers)
      .leftJoin(fromAgents, eq(conversationTransfers.fromAgentId, fromAgents.id))
      .leftJoin(toAgents, eq(conversationTransfers.toAgentId, toAgents.id))
      .leftJoin(byAgents, eq(conversationTransfers.transferredByAgentId, byAgents.id))
      .leftJoin(fromQueues, eq(conversationTransfers.fromQueueId, fromQueues.id))
      .leftJoin(toQueues, eq(conversationTransfers.toQueueId, toQueues.id))
      .where(eq(conversationTransfers.conversationId, params.id))
      .orderBy(conversationTransfers.createdAt)

    let activeBotFlow: { id: string; name: string } | null = null
    if (conversation.activeBotFlowId) {
      const [flow] = await db
        .select({ id: botFlows.id, name: botFlows.name })
        .from(botFlows)
        .where(eq(botFlows.id, conversation.activeBotFlowId))
        .limit(1)
      activeBotFlow = flow ?? null
    }

    // Avaliações CSAT (uma por ATENDIMENTO), com o nome do agente atribuído na
    // resolução de cada uma. Cada nota é colocada no seu atendimento na thread.
    const ratingRows = await db
      .select({ rating: conversationRatings, agentName: agents.name })
      .from(conversationRatings)
      .leftJoin(agents, eq(conversationRatings.agentId, agents.id))
      .where(eq(conversationRatings.conversationId, params.id))
      .orderBy(conversationRatings.createdAt)
    const ratings = ratingRows.map((row) => ({ ...row.rating, agentName: row.agentName }))

    return { conversation, contact, messages: msgs, hasMore, nextCursor, notes, transfers, activeBotFlow, ratings }
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        before: t.Optional(t.String()),
      }),
    },
  )

  // POST /inbox/conversations/:id/assign — auto-atribui (ou admin atribui a outro).
  .post(
    '/inbox/conversations/:id/assign',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      // Agente comum só pode se auto-atribuir; admin pode atribuir a qualquer um.
      const targetAgentId = body.agentId ?? agent.id
      if (targetAgentId !== agent.id && agent.role !== 'admin') {
        set.status = 403
        return { message: 'Apenas admins podem atribuir conversas a outros agentes.' }
      }

      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!conversation) {
        set.status = 404
        return { message: 'Conversa não encontrada.' }
      }

      try {
        const updated = await assignConversation(params.id, targetAgentId)
        // Humano assumiu: o bot sai de cena imediatamente.
        const stoppedFlowId = await silenceBotOnTakeover(params.id)
        wsHub.broadcast(agent.workspaceId, {
          type: 'conversation:assigned',
          conversationId: params.id,
          agentId: targetAgentId,
        })
        if (stoppedFlowId) {
          wsHub.broadcast(agent.workspaceId, {
            type: 'bot:stopped',
            conversationId: params.id,
            flowId: stoppedFlowId,
          })
        }
        return { conversation: updated }
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          set.status = 409
          return { message: error.message }
        }
        throw error
      }
    },
    {
      body: t.Object({ agentId: t.Optional(t.String()) }),
    },
  )

  // POST /inbox/conversations/:id/transfer — transfere para outro agente OU
  // outra fila (exatamente um destino), registrando o histórico.
  .post(
    '/inbox/conversations/:id/transfer',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      // Exatamente um destino: agente ou fila.
      if (!body.toAgentId === !body.toQueueId) {
        set.status = 400
        return { message: 'Informe exatamente um destino: toAgentId ou toQueueId.' }
      }

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!conversation) {
        set.status = 404
        return { message: 'Conversa não encontrada.' }
      }

      if (body.toAgentId) {
        const [target] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, body.toAgentId), eq(agents.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!target) {
          set.status = 404
          return { message: 'Agente de destino não encontrado.' }
        }
      }
      if (body.toQueueId) {
        const [target] = await db
          .select({ id: queues.id })
          .from(queues)
          .where(and(eq(queues.id, body.toQueueId), eq(queues.workspaceId, agent.workspaceId)))
          .limit(1)
        if (!target) {
          set.status = 404
          return { message: 'Fila de destino não encontrada.' }
        }
      }

      // Status seguinte respeita a state machine de conversas:
      // para agente → 'assigned'; para fila → 'open' se estava assigned/pending
      // (conversa volta a aguardar alguém puxar da fila), senão mantém.
      let nextStatus = conversation.status
      let nextAssignedAgentId: string | null = conversation.assignedAgentId
      if (body.toAgentId) {
        if (!canTransition(conversation.status, 'assigned')) {
          set.status = 409
          return { message: `Transição de conversa inválida: ${conversation.status} → assigned` }
        }
        nextStatus = 'assigned'
        nextAssignedAgentId = body.toAgentId
      } else {
        nextAssignedAgentId = null
        if (conversation.status === 'assigned' || conversation.status === 'pending') {
          if (!canTransition(conversation.status, 'open')) {
            set.status = 409
            return { message: `Transição de conversa inválida: ${conversation.status} → open` }
          }
          nextStatus = 'open'
        }
      }

      const transferId = generateId()
      const [transfer] = await db
        .insert(conversationTransfers)
        .values({
          id: transferId,
          workspaceId: agent.workspaceId,
          conversationId: params.id,
          fromAgentId: conversation.assignedAgentId,
          fromQueueId: conversation.queueId,
          toAgentId: body.toAgentId ?? null,
          toQueueId: body.toQueueId ?? null,
          note: body.note ?? null,
          transferredByAgentId: agent.id,
        })
        .returning()

      const [updated] = await db
        .update(conversations)
        .set({
          assignedAgentId: nextAssignedAgentId,
          queueId: body.toQueueId ?? conversation.queueId,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, params.id))
        .returning()

      // Transferência é ação humana: o bot (se ainda ativo) sai de cena.
      const stoppedFlowId = await silenceBotOnTakeover(params.id)

      wsHub.broadcast(agent.workspaceId, {
        type: 'conversation:transferred',
        conversationId: params.id,
        transfer,
      })
      if (stoppedFlowId) {
        wsHub.broadcast(agent.workspaceId, {
          type: 'bot:stopped',
          conversationId: params.id,
          flowId: stoppedFlowId,
        })
      }

      return { transfer, conversation: updated }
    },
    {
      body: t.Object({
        toAgentId: t.Optional(t.String()),
        toQueueId: t.Optional(t.String()),
        note: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )

  // PATCH /inbox/conversations/:id/title — renomeia a conversa. Null volta
  // a exibir o nome do contato. Não toca em updatedAt (não reordena a lista).
  .patch(
    '/inbox/conversations/:id/title',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!conversation) {
        set.status = 404
        return { message: 'Conversa não encontrada.' }
      }

      const [updated] = await db
        .update(conversations)
        .set({ title: body.title })
        .where(eq(conversations.id, params.id))
        .returning()

      return { conversation: updated }
    },
    {
      body: t.Object({
        title: t.Union([t.String({ minLength: 1, maxLength: 120 }), t.Null()]),
      }),
    },
  )

  // POST /inbox/conversations/:id/read — marca a conversa como lida pelo
  // agente autenticado (upsert lastReadAt=now). Idempotente; o frontend
  // chama ao abrir a conversa. Sem broadcast WS.
  .post('/inbox/conversations/:id/read', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    await markConversationRead(params.id, agent.id)
    return { ok: true }
  })

  // POST /inbox/conversations/:id/resolve
  .post('/inbox/conversations/:id/resolve', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    try {
      const updated = await resolveConversation(params.id)
      wsHub.broadcast(agent.workspaceId, { type: 'conversation:resolved', conversationId: params.id })
      // Pesquisa CSAT: vai ao contato quando o workspace habilitou e a
      // conversa ainda não recebeu pesquisa (csatSentAt). Falha aqui não
      // desfaz a resolução — só registra no log.
      try {
        const csatMessage = await maybeSendCsatSurvey(params.id)
        if (csatMessage) {
          wsHub.broadcast(agent.workspaceId, { type: 'message:new', conversationId: params.id, message: csatMessage })
        }
      } catch (csatError) {
        console.error('[crm-api:csat] falha ao enviar pesquisa de satisfação:', csatError)
      }
      return { conversation: updated }
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        set.status = 409
        return { message: error.message }
      }
      throw error
    }
  })

  // POST /inbox/conversations/:id/reopen — reabre manualmente (resolved → open).
  .post('/inbox/conversations/:id/reopen', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    try {
      const updated = await reopenConversation(params.id)
      wsHub.broadcast(agent.workspaceId, { type: 'conversation:reopened', conversationId: params.id })
      return { conversation: updated }
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        set.status = 409
        return { message: error.message }
      }
      throw error
    }
  })

  // POST /inbox/conversations/:id/pending — marca pendente manualmente.
  .post('/inbox/conversations/:id/pending', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    try {
      const updated = await markPending(params.id)
      wsHub.broadcast(agent.workspaceId, { type: 'conversation:pending', conversationId: params.id })
      return { conversation: updated }
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        set.status = 409
        return { message: error.message }
      }
      throw error
    }
  })

  // POST /inbox/conversations/:id/bot/stop — takeover manual: qualquer agente
  // interrompe o bot que está atendendo a conversa. A sessão viva (running ou
  // waiting_input) vira 'cancelled', o badge é limpo e a conversa volta para
  // o atendimento humano: assigned se já tinha agente, senão open. A engine
  // aborta em silêncio se um job ainda estiver no meio do fluxo.
  .post('/inbox/conversations/:id/bot/stop', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    const [session] = await db
      .select()
      .from(botSessions)
      .where(
        and(
          eq(botSessions.conversationId, params.id),
          inArray(botSessions.status, ['running', 'waiting_input']),
        ),
      )
      .limit(1)
    if (!session) {
      set.status = 409
      return { message: 'Não há bot ativo nesta conversa.' }
    }

    const now = new Date()
    await db
      .update(botSessions)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(botSessions.id, session.id))
    await db
      .update(conversations)
      .set({
        activeBotFlowId: null,
        // Respeita a máquina de estados: com agente atribuído a conversa
        // permanece assigned; sem agente, volta para open.
        status: conversation.assignedAgentId ? 'assigned' : 'open',
        updatedAt: now,
      })
      .where(eq(conversations.id, params.id))

    wsHub.broadcast(agent.workspaceId, {
      type: 'bot:stopped',
      conversationId: params.id,
      flowId: session.flowId,
    })
    return { stopped: true as const, flowId: session.flowId }
  })

  // POST /inbox/conversations/:id/send-protocol — envia o número do protocolo
  // ao contato pelo canal (mensagem automática, agentId null). Não é takeover:
  // pode ser usado no início do atendimento, inclusive com o bot ativo.
  .post('/inbox/conversations/:id/send-protocol', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }

    const [contact] = await db
      .select({ blocked: contacts.blocked })
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId))
      .limit(1)
    if (contact?.blocked) {
      set.status = 409
      return { message: 'Contato bloqueado: desbloqueie para enviar mensagens.' }
    }

    const [connection] = await db
      .select()
      .from(connections)
      .where(eq(connections.id, conversation.connectionId))
      .limit(1)
    if (!connection) {
      set.status = 500
      return { message: 'Conexão da conversa não encontrada.' }
    }

    const identities = await db
      .select()
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.contactId, conversation.contactId),
          eq(contactIdentities.channelType, connection.kind),
        ),
      )
    const targetIdentity = identities.find((i) => i.isPrimary) ?? identities[0]
    if (!targetIdentity) {
      set.status = 400
      return { message: 'Contato não possui identidade no canal da conexão.' }
    }

    const protocolLabel = `#${String(conversation.protocol).padStart(5, '0')}`
    const content = `Seu protocolo de atendimento é ${protocolLabel}. Guarde este número para acompanhar o seu atendimento.`

    const messageId = generateId()
    const [message] = await db
      .insert(messages)
      .values({
        id: messageId,
        conversationId: params.id,
        direction: 'outbound',
        content,
        kind: 'text',
        status: 'queued',
        agentId: null,
        connectionId: connection.id,
      })
      .returning()

    await getOutboundQueue().add(
      `outbound:${messageId}`,
      {
        workspaceId: agent.workspaceId,
        connectionId: connection.id,
        conversationId: params.id,
        messageId,
        target: targetIdentity.channelIdentifier,
        content,
      } satisfies OutboundMessageJob,
      defaultCrmJobOptions,
    )

    wsHub.broadcast(agent.workspaceId, { type: 'message:new', conversationId: params.id, message })
    return { message }
  })

  // POST /inbox/conversations/:id/csat/send — reenvia a pesquisa CSAT ao contato.
  // Só faz sentido em conversa resolvida, com CSAT habilitado e ainda sem nota
  // (o envio automático já ocorre ao resolver; este é o botão de reenvio).
  .post('/inbox/conversations/:id/csat/send', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const [conversation] = await db
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!conversation) {
      set.status = 404
      return { message: 'Conversa não encontrada.' }
    }
    if (conversation.status !== 'resolved') {
      set.status = 409
      return { message: 'A pesquisa de avaliação só pode ser enviada após resolver a conversa.' }
    }

    const message = await maybeSendCsatSurvey(params.id, { force: true })
    if (!message) {
      set.status = 409
      return {
        message:
          'Não foi possível enviar a pesquisa: verifique se o CSAT está habilitado nas configurações e se a conversa ainda não foi avaliada.',
      }
    }

    wsHub.broadcast(agent.workspaceId, { type: 'message:new', conversationId: params.id, message })
    return { sent: true as const }
  })

  // POST /inbox/conversations/:id/messages — agente envia mensagem (com
  // anexos opcionais da biblioteca de arquivos) e enfileira o envio real.
  .post(
    '/inbox/conversations/:id/messages',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!conversation) {
        set.status = 404
        return { message: 'Conversa não encontrada.' }
      }

      // Contato bloqueado não pode receber mensagens da equipe.
      const [contact] = await db
        .select({ blocked: contacts.blocked })
        .from(contacts)
        .where(eq(contacts.id, conversation.contactId))
        .limit(1)
      if (contact?.blocked) {
        set.status = 409
        return { message: 'Contato bloqueado: desbloqueie para enviar mensagens.' }
      }

      const [connection] = await db
        .select()
        .from(connections)
        .where(eq(connections.id, conversation.connectionId))
        .limit(1)
      if (!connection) {
        set.status = 500
        return { message: 'Conexão da conversa não encontrada.' }
      }

      // Destino no canal: identity primária do contato no canal da conexão
      // (fallback para qualquer identity do mesmo canal).
      const identities = await db
        .select()
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.contactId, conversation.contactId),
            eq(contactIdentities.channelType, connection.kind),
          ),
        )
      const targetIdentity = identities.find((i) => i.isPrimary) ?? identities[0]
      if (!targetIdentity) {
        set.status = 400
        return { message: 'Contato não possui identidade no canal da conexão.' }
      }

      // Anexos: só arquivos prontos (upload confirmado) do mesmo workspace.
      let attachments: MessageAttachment[] = []
      const fileIds = body.attachmentFileIds ?? []
      if (fileIds.length > 0) {
        const found = await db
          .select()
          .from(files)
          .where(and(inArray(files.id, fileIds), eq(files.workspaceId, agent.workspaceId)))
        if (found.length !== fileIds.length || found.some((f) => f.status !== 'ready')) {
          set.status = 400
          return { message: 'Anexo inválido: arquivo não encontrado ou upload não confirmado.' }
        }
        attachments = found.map((f) => ({
          storageKey: f.storageKey,
          mimeType: f.mimeType,
          kind: f.kind,
          filename: f.filename,
        }))
      }

      const messageId = generateId()
      const [message] = await db
        .insert(messages)
        .values({
          id: messageId,
          conversationId: params.id,
          direction: 'outbound',
          content: body.content,
          kind: attachments[0]?.kind ?? 'text',
          status: 'queued',
          agentId: agent.id,
          connectionId: connection.id,
          attachments,
        })
        .returning()

      // Agente respondeu → marca pending (aguardando cliente), se aplicável.
      if (conversation.status === 'assigned' || conversation.status === 'open') {
        try {
          await markPending(params.id)
        } catch {
          // se a transição não for válida, mantém o status atual
        }
      }

      // Agente respondeu direto: takeover implícito — o bot sai de cena para não
      // reassumir o fluxo na próxima mensagem do cliente.
      const stoppedFlowId = await silenceBotOnTakeover(params.id)
      if (stoppedFlowId) {
        wsHub.broadcast(agent.workspaceId, {
          type: 'bot:stopped',
          conversationId: params.id,
          flowId: stoppedFlowId,
        })
      }

      // Agente enviou mensagem → conversa lida até agora para ele (zera não lidas).
      await markConversationRead(params.id, agent.id)

      // Identificação do atendente: quando o workspace liga a opção, o texto
      // enviado ao canal leva o primeiro nome do agente em negrito (*João*:\n…).
      // O registro no banco (message.content) fica limpo — o inbox já mostra o
      // autor via agentName. Em mídia sem legenda, envia só a identificação.
      const [settings] = await db
        .select({ identifyAgent: workspaceSettings.identifyAgent })
        .from(workspaceSettings)
        .where(eq(workspaceSettings.workspaceId, agent.workspaceId))
        .limit(1)
      let channelContent = body.content
      if (settings?.identifyAgent) {
        const firstName = agent.name.trim().split(/\s+/)[0] || agent.name
        const trimmed = body.content.trim()
        channelContent = trimmed ? `*${firstName}*:\n${trimmed}` : `*${firstName}*:`
      }

      // Envio real: o worker consome e chama o session-host (WhatsApp/Telegram).
      await getOutboundQueue().add(
        `outbound:${messageId}`,
        {
          workspaceId: agent.workspaceId,
          connectionId: connection.id,
          conversationId: params.id,
          messageId,
          target: targetIdentity.channelIdentifier,
          content: channelContent,
          media: attachments.length > 0 ? attachments : undefined,
        } satisfies OutboundMessageJob,
        defaultCrmJobOptions,
      )

      wsHub.broadcast(agent.workspaceId, { type: 'message:new', conversationId: params.id, message })

      return { message }
    },
    {
      body: t.Object({
        content: t.String({ minLength: 1, maxLength: 4096 }),
        attachmentFileIds: t.Optional(t.Array(t.String(), { maxItems: 10 })),
      }),
    },
  )

  // POST /inbox/conversations/:id/notes — nota interna (não vai ao cliente).
  .post(
    '/inbox/conversations/:id/notes',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!conversation) {
        set.status = 404
        return { message: 'Conversa não encontrada.' }
      }

      const noteId = generateId()
      const [note] = await db
        .insert(internalNotes)
        .values({ id: noteId, conversationId: params.id, agentId: agent.id, content: body.content })
        .returning()

      return { note }
    },
    {
      body: t.Object({ content: t.String({ minLength: 1, maxLength: 2000 }) }),
    },
  )
