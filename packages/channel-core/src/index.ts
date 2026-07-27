export const CHANNELS = ['whatsapp', 'telegram'] as const

export type Channel = (typeof CHANNELS)[number]

export type ChannelAddress = {
  channel: Channel
  externalId: string
}

export type ChannelAttachment = {
  kind: 'image' | 'video' | 'audio' | 'document'
  url: string
  mimeType?: string
  filename?: string
}

export type ChannelMessage = {
  externalMessageId: string
  from: ChannelAddress
  to: ChannelAddress
  text: string | null
  attachments: ChannelAttachment[]
  occurredAt: string
}

export type EventEnvelope<TType extends string, TPayload> = {
  id: string
  type: TType
  version: 1
  occurredAt: string
  payload: TPayload
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && CHANNELS.includes(value as Channel)
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

export function createEventEnvelope<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  options: { id?: string; occurredAt?: string } = {},
): EventEnvelope<TType, TPayload> {
  return {
    id: options.id ?? crypto.randomUUID(),
    type,
    version: 1,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    payload,
  }
}
