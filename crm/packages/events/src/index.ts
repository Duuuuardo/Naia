import type { Channel, ChannelMessage, EventEnvelope } from '@naia/channel-core'

export const CRM_EVENT_CHANNELS = {
  SESSION_EVENTS: 'crm:session-events:v1',
  INBOX_EVENTS: 'crm:inbox-events:v1',
} as const

export type SessionConnected = EventEnvelope<
  'session:connected',
  { workspaceId: string; connectionId: string; channel: Channel }
>

export type SessionDisconnected = EventEnvelope<
  'session:disconnected',
  { workspaceId: string; connectionId: string; channel: Channel; reason: string | null }
>

export type SessionQrUpdated = EventEnvelope<
  'session:qr-updated',
  { workspaceId: string; connectionId: string; qrCode: string }
>

export type InboundMessageReceived = EventEnvelope<
  'message:received',
  { workspaceId: string; connectionId: string; message: ChannelMessage }
>

// Status de entrega/leitura de uma mensagem da conversa (eco do job
// kind: 'status' de inbound-messages-v1, já resolvido para ids internos).
export type MessageStatusUpdated = EventEnvelope<
  'message:status-updated',
  {
    workspaceId: string
    conversationId: string
    messageId: string
    status: 'sent' | 'delivered' | 'read' | 'failed'
  }
>

// ─── Bot ─────────────────────────────────────────────────────────────────────
// Ciclo de vida do atendimento por bot numa conversa — alimenta o badge
// "Chatbot atendendo" no inbox (via bridge Redis → WS).

export type BotStarted = EventEnvelope<
  'bot:started',
  { workspaceId: string; conversationId: string; flowId: string }
>

export type BotHandoff = EventEnvelope<
  'bot:handoff',
  {
    workspaceId: string
    conversationId: string
    flowId: string
    agentId?: string
    queueId?: string
  }
>

export type BotFinished = EventEnvelope<
  'bot:finished',
  { workspaceId: string; conversationId: string; flowId: string }
>

export type CrmSessionEvent = SessionConnected | SessionDisconnected | SessionQrUpdated
export type CrmInboxEvent = InboundMessageReceived | MessageStatusUpdated | BotStarted | BotHandoff | BotFinished
