import { Elysia } from 'elysia'
import { db, connections } from '@naia/db'
import { eq, and } from 'drizzle-orm'
import { getQueue, QUEUES } from '@naia/queue'
import type { StatusWebhookJob } from '@naia/schemas'

// Telegram por conta de usuário (MTProto) recebe eventos direto pelo cliente
// no processo da API — não usa webhook. O opt-in/out vive no
// telegram-user-manager. Só sobra o webhook de status do WhatsApp.
export const webhookRoutes = new Elysia()

  // POST /webhooks/whatsapp/:connectionId — status de mensagem (Baileys)
  .post(
    '/webhooks/whatsapp/:connectionId',
    async ({ params, body }) => {
      const [conn] = await db
        .select({ id: connections.id, workspaceId: connections.workspaceId })
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.channel, 'whatsapp')))
        .limit(1)

      if (!conn) return { ok: true }

      const payload = body as {
        externalMessageId?: string
        status?: string
        timestamp?: string
      }

      if (!payload.externalMessageId || !payload.status) return { ok: true }

      const queue = getQueue<StatusWebhookJob>(QUEUES.STATUS_WEBHOOK)
      await queue.add('status-update', {
        source: 'whatsapp',
        connectionId: conn.id,
        externalMessageId: payload.externalMessageId,
        status: payload.status as never,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      })

      return { ok: true }
    },
  )

  // GET /webhooks/whatsapp/:connectionId — verificação (Cloud API futura)
  .get(
    '/webhooks/whatsapp/:connectionId',
    ({ query }) => {
      if (query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
        return new Response(query['hub.challenge'] ?? 'ok')
      }
      return new Response('Forbidden', { status: 403 })
    },
  )
