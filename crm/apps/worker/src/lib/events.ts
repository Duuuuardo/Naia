import { createEventEnvelope } from '@naia/channel-core'
import { CRM_EVENT_CHANNELS, type CrmInboxEvent } from '@crm/events'
import { getCrmRedis } from '@crm/queue'

// Publica evento do inbox no canal Redis exclusivo do CRM. A API consome
// (bridge Redis → WS) para atualizar o inbox em tempo real.
export async function publishInboxEvent(event: CrmInboxEvent): Promise<void> {
  await getCrmRedis().publish(CRM_EVENT_CHANNELS.INBOX_EVENTS, JSON.stringify(event))
}

export function buildInboxEvent<TType extends CrmInboxEvent['type']>(
  type: TType,
  payload: Extract<CrmInboxEvent, { type: TType }>['payload'],
): CrmInboxEvent {
  return createEventEnvelope(type, payload) as CrmInboxEvent
}
