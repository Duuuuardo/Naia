import { eq } from 'drizzle-orm'
import type { OutboundMessageJob } from '@crm/queue'
import { db, connections, messages } from '@crm/db'
import { sendTelegram, sendWhatsApp } from '../lib/session-host-client'
import { buildInboxEvent, publishInboxEvent } from '../lib/events'

// Consumer de outbound-messages-v1: entrega mensagens queued ao canal via
// session-host (HTTP interno). Falha é terminal aqui — a mensagem vira failed
// com motivo e o BullMQ não reprocessa (sem retry de envio duplicado).

export async function handleOutboundMessage(job: OutboundMessageJob): Promise<void> {
  const [message] = await db.select().from(messages).where(eq(messages.id, job.messageId)).limit(1)
  if (!message) {
    console.warn(`[crm-worker:outbound] mensagem ${job.messageId} não encontrada; job descartado`)
    return
  }
  if (message.status !== 'queued') {
    // Já processada (reentrega do BullMQ ou envio concorrente).
    return
  }

  const [connection] = await db.select().from(connections).where(eq(connections.id, job.connectionId)).limit(1)
  if (!connection) {
    await markFailed(job, 'Conexão não encontrada ou removida.')
    return
  }

  try {
    const result =
      connection.kind === 'whatsapp'
        ? await sendWhatsApp({ connectionId: connection.id, phone: job.target, content: job.content, media: job.media, buttons: job.buttons })
        : await sendTelegram({ connectionId: connection.id, chatId: job.target, content: job.content, media: job.media, buttons: job.buttons })

    await db
      .update(messages)
      .set({ status: 'sent', externalMessageId: result.externalMessageId, sentAt: new Date() })
      .where(eq(messages.id, message.id))

    await publishInboxEvent(
      buildInboxEvent('message:status-updated', {
        workspaceId: job.workspaceId,
        conversationId: job.conversationId,
        messageId: message.id,
        status: 'sent',
      }),
    )
  } catch (error) {
    await markFailed(job, error instanceof Error ? error.message : 'Falha desconhecida ao enviar.')
  }
}

async function markFailed(job: OutboundMessageJob, reason: string): Promise<void> {
  console.error(`[crm-worker:outbound] mensagem ${job.messageId} falhou: ${reason}`)
  await db
    .update(messages)
    .set({ status: 'failed', failureReason: reason.slice(0, 500) })
    .where(eq(messages.id, job.messageId))

  await publishInboxEvent(
    buildInboxEvent('message:status-updated', {
      workspaceId: job.workspaceId,
      conversationId: job.conversationId,
      messageId: job.messageId,
      status: 'failed',
    }),
  )
}
