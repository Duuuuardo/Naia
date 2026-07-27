// Publicação dos eventos de sessão do CRM (crm:session-events:v1). A API se
// inscreve nesse canal e faz a ponte Redis → WebSocket do inbox (QR em tempo
// real, status da conexão).
import { createEventEnvelope, type Channel } from '@naia/channel-core'
import { CRM_EVENT_CHANNELS, type CrmSessionEvent } from '@crm/events'
import { getCrmRedis } from '@crm/queue'

async function publish(event: CrmSessionEvent): Promise<void> {
  await getCrmRedis().publish(CRM_EVENT_CHANNELS.SESSION_EVENTS, JSON.stringify(event))
}

export async function publishSessionConnected(input: {
  workspaceId: string
  connectionId: string
  channel: Channel
}): Promise<void> {
  await publish(createEventEnvelope('session:connected', input))
}

export async function publishSessionDisconnected(input: {
  workspaceId: string
  connectionId: string
  channel: Channel
  reason: string | null
}): Promise<void> {
  await publish(createEventEnvelope('session:disconnected', input))
}

export async function publishSessionQrUpdated(input: {
  workspaceId: string
  connectionId: string
  qrCode: string
}): Promise<void> {
  await publish(createEventEnvelope('session:qr-updated', input))
}
