import { db } from '@crm/db'
import {
  connections,
  contactIdentities,
  conversations,
  messages,
  workspaceSettings,
  CSAT_DEFAULT_MESSAGE,
  type Message,
} from '@crm/db/schema'
import { CRM_QUEUES, defaultCrmJobOptions, getCrmQueue, type OutboundMessageJob } from '@crm/queue'
import { and, eq } from 'drizzle-orm'
import { generateId } from '../lib/crypto'

// Fila de envio real (worker consome e chama o session-host via HTTP interno).
// Mesmo padrão do POST /:id/messages — instância lazy para não exigir Redis
// no import do módulo.
let outboundQueue: ReturnType<typeof getCrmQueue<OutboundMessageJob>> | null = null
function getOutboundQueue() {
  if (!outboundQueue) {
    outboundQueue = getCrmQueue<OutboundMessageJob>(CRM_QUEUES.OUTBOUND_MESSAGES)
  }
  return outboundQueue
}

// Dispara a pesquisa CSAT ao contato após a resolução da conversa. Envia só
// quando: workspace com csatEnabled, conversa sem pesquisa anterior
// (csatSentAt null — nunca duplica) e contato com identidade no canal da
// conexão. Retorna a mensagem persistida (para broadcast WS) ou null.
export const maybeSendCsatSurvey = async (conversationId: string): Promise<Message | null> => {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conversation || conversation.status !== 'resolved' || conversation.csatSentAt) return null

  const [settings] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, conversation.workspaceId))
    .limit(1)
  if (!settings?.csatEnabled) return null

  const [connection] = await db.select().from(connections).where(eq(connections.id, conversation.connectionId)).limit(1)
  if (!connection) return null

  // Destino no canal: identity primária do contato no canal da conexão
  // (mesmo fallback do envio manual).
  const identities = await db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, connection.kind)))
  const targetIdentity = identities.find((i) => i.isPrimary) ?? identities[0]
  if (!targetIdentity) return null

  const content = settings.csatMessage?.trim() || CSAT_DEFAULT_MESSAGE
  const messageId = generateId()
  const [message] = await db
    .insert(messages)
    .values({
      id: messageId,
      conversationId,
      direction: 'outbound',
      content,
      kind: 'text',
      status: 'queued',
      agentId: null,
      connectionId: connection.id,
    })
    .returning()

  // Marca o envio ANTES de enfileirar: se o job falhar, não reenviamos a
  // pesquisa em uma próxima resolução (a conversa continua sem nota).
  await db.update(conversations).set({ csatSentAt: new Date() }).where(eq(conversations.id, conversationId))

  await getOutboundQueue().add(
    `outbound:${messageId}`,
    {
      workspaceId: conversation.workspaceId,
      connectionId: connection.id,
      conversationId,
      messageId,
      target: targetIdentity.channelIdentifier,
      content,
    } satisfies OutboundMessageJob,
    defaultCrmJobOptions,
  )

  return message
}
