import { db } from '@crm/db'
import { agents, botFlows, connections, contactIdentities, conversationRatings, conversations, messages } from '@crm/db/schema'
import { CRM_EVENT_CHANNELS, type CrmInboxEvent, type CrmSessionEvent } from '@crm/events'
import { createCrmRedisConnection } from '@crm/queue'
import { and, desc, eq } from 'drizzle-orm'
import { wsHub } from './ws-hub'

function isSessionEvent(value: unknown): value is CrmSessionEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as { version?: unknown; type?: unknown; payload?: unknown }
  return (
    event.version === 1
    && (
      event.type === 'session:connected'
      || event.type === 'session:disconnected'
      || event.type === 'session:qr-updated'
    )
    && typeof event.payload === 'object'
    && event.payload !== null
  )
}

function isInboxEvent(value: unknown): value is CrmInboxEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as { version?: unknown; type?: unknown; payload?: unknown }
  return (
    event.version === 1
    && (
      event.type === 'message:received'
      || event.type === 'message:status-updated'
      || event.type === 'bot:started'
      || event.type === 'bot:handoff'
      || event.type === 'bot:finished'
      || event.type === 'conversation:rated'
      || event.type === 'message:sent'
    )
    && typeof event.payload === 'object'
    && event.payload !== null
  )
}

export async function startRedisEventBridge(): Promise<() => Promise<void>> {
  const subscriber = createCrmRedisConnection('crm-api-session-events')

  subscriber.on('message', (channel, raw) => {
    const handler = channel === CRM_EVENT_CHANNELS.INBOX_EVENTS ? handleInboxEvent : handleSessionEvent
    void handler(raw).catch((error) => {
      console.error('[crm-api:redis-events] falha ao processar evento:', error)
    })
  })

  await subscriber.subscribe(CRM_EVENT_CHANNELS.SESSION_EVENTS, CRM_EVENT_CHANNELS.INBOX_EVENTS)
  console.log(`[crm-api:redis-events] inscrito em ${CRM_EVENT_CHANNELS.SESSION_EVENTS} e ${CRM_EVENT_CHANNELS.INBOX_EVENTS}`)

  return async () => {
    await subscriber.unsubscribe(CRM_EVENT_CHANNELS.SESSION_EVENTS, CRM_EVENT_CHANNELS.INBOX_EVENTS)
    await subscriber.quit()
  }
}

function parseEvent(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    console.warn('[crm-api:redis-events] evento ignorado: JSON inválido')
    return null
  }
}

async function handleSessionEvent(raw: string): Promise<void> {
  const parsed = parseEvent(raw)
  if (parsed === null) return

  if (!isSessionEvent(parsed)) {
    console.warn('[crm-api:redis-events] evento ignorado: contrato desconhecido')
    return
  }

  if (parsed.type === 'session:connected' || parsed.type === 'session:disconnected') {
    const { workspaceId, connectionId } = parsed.payload
    const status = parsed.type === 'session:connected' ? 'active' : 'disconnected'
    await db
      .update(connections)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.workspaceId, workspaceId),
        ),
      )

    wsHub.broadcast(workspaceId, {
      type: 'connection:status',
      connectionId,
      status,
    })
    return
  }

  // session:qr-updated → push do QR para a tela de conexões em tempo real.
  if (parsed.type === 'session:qr-updated') {
    wsHub.broadcast(parsed.payload.workspaceId, {
      type: 'session:qr',
      connectionId: parsed.payload.connectionId,
      qr: parsed.payload.qrCode,
    })
  }
}

async function handleInboxEvent(raw: string): Promise<void> {
  const parsed = parseEvent(raw)
  if (parsed === null) return

  if (!isInboxEvent(parsed)) {
    console.warn('[crm-api:redis-events] evento de inbox ignorado: contrato desconhecido')
    return
  }

  if (parsed.type === 'message:received') {
    await handleMessageReceived(parsed.payload)
    return
  }

  if (parsed.type === 'message:status-updated') {
    wsHub.broadcast(parsed.payload.workspaceId, {
      type: 'message:status',
      conversationId: parsed.payload.conversationId,
      messageId: parsed.payload.messageId,
      status: parsed.payload.status,
    })
    return
  }

  // Avaliação CSAT do cliente → mostra a nota na thread em tempo real.
  if (parsed.type === 'conversation:rated') {
    await handleConversationRated(parsed.payload)
    return
  }

  // Mensagem outbound gerada no worker (bot/sistema) → message:new no inbox.
  if (parsed.type === 'message:sent') {
    await handleMessageSent(parsed.payload)
    return
  }

  // Ciclo de vida do bot → badge "Chatbot atendendo" no inbox.
  if (parsed.type === 'bot:started') {
    const [flow] = await db
      .select({ name: botFlows.name })
      .from(botFlows)
      .where(eq(botFlows.id, parsed.payload.flowId))
      .limit(1)
    wsHub.broadcast(parsed.payload.workspaceId, {
      type: 'bot:status',
      conversationId: parsed.payload.conversationId,
      active: true,
      flowName: flow?.name,
    })
    return
  }

  // bot:handoff | bot:finished → bot soltou a conversa.
  wsHub.broadcast(parsed.payload.workspaceId, {
    type: 'bot:status',
    conversationId: parsed.payload.conversationId,
    active: false,
  })
}

// message:received carrega a ChannelMessage crua do canal; aqui resolvemos a
// conversa (identity primária do remetente + conexão) e a mensagem persistida
// pelo worker para o WS entregar o mesmo shape das rotas REST.
async function handleMessageReceived(payload: {
  workspaceId: string
  connectionId: string
  message: { externalMessageId: string; from: { channel: 'whatsapp' | 'telegram'; externalId: string } }
}): Promise<void> {
  const { message } = payload

  const [identity] = await db
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.workspaceId, payload.workspaceId),
        eq(contactIdentities.channelType, message.from.channel),
        eq(contactIdentities.channelIdentifier, message.from.externalId),
      ),
    )
    .limit(1)
  if (!identity) return

  // Conversa mais recente do contato nesta conexão (o worker abre/reabre antes
  // de publicar o evento, então ela já existe aqui).
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, identity.contactId),
        eq(conversations.connectionId, payload.connectionId),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1)
  if (!conversation) return

  const [stored] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.externalMessageId, message.externalMessageId),
      ),
    )
    .limit(1)

  // Conversa recém-aberta (thread nova) também dispara conversation:new.
  if (Date.now() - conversation.createdAt.getTime() < 30_000) {
    wsHub.broadcast(payload.workspaceId, { type: 'conversation:new', conversation })
  }

  wsHub.broadcast(payload.workspaceId, {
    type: 'message:new',
    conversationId: conversation.id,
    message: stored ?? message,
  })
}

// conversation:rated → resolve o rating persistido (com nome do agente
// atribuído na resolução) no mesmo shape das rotas REST e faz broadcast para
// a thread anexar a nota sem reload.
async function handleConversationRated(payload: {
  workspaceId: string
  conversationId: string
  ratingId: string
}): Promise<void> {
  const [row] = await db
    .select({ rating: conversationRatings, agentName: agents.name })
    .from(conversationRatings)
    .leftJoin(agents, eq(conversationRatings.agentId, agents.id))
    .where(eq(conversationRatings.id, payload.ratingId))
    .limit(1)
  if (!row) return

  wsHub.broadcast(payload.workspaceId, {
    type: 'conversation:rated',
    conversationId: payload.conversationId,
    rating: { ...row.rating, agentName: row.agentName },
  })
}

// message:sent → carrega a mensagem persistida pelo worker e faz o mesmo
// broadcast message:new das mensagens do agente/inbound (a thread refaz o
// fetch da página; a lista invalida — o payload só precisa disparar o evento).
async function handleMessageSent(payload: {
  workspaceId: string
  conversationId: string
  messageId: string
}): Promise<void> {
  const [stored] = await db.select().from(messages).where(eq(messages.id, payload.messageId)).limit(1)
  if (!stored) return

  wsHub.broadcast(payload.workspaceId, {
    type: 'message:new',
    conversationId: payload.conversationId,
    message: stored,
  })
}
