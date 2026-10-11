import { Elysia, t } from 'elysia'
import { db, connections } from '@naia/db'
import { eq, and } from 'drizzle-orm'
import { getQueue, QUEUES } from '@naia/queue'
import type { StatusWebhookJob } from '@naia/schemas'
import { getRequiredEnv, verifySecret } from '../lib/env'

const WEBHOOK_SECRET = getRequiredEnv('WHATSAPP_VERIFY_TOKEN')

export const webhookRoutes = new Elysia()

  .post(
    '/webhooks/whatsapp/:connectionId',
    async ({ params, body, headers, set }) => {
      const providedSecret = headers['x-webhook-secret']
      if (!verifySecret(providedSecret, WEBHOOK_SECRET)) {
        set.status = 401
        return { ok: false, message: 'Não autorizado.' }
      }

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
    {
      body: t.Object({
        externalMessageId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        timestamp: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/webhooks/whatsapp/:connectionId',
    ({ query }) => {
      if (!WEBHOOK_SECRET || !verifySecret(query['hub.verify_token'], WEBHOOK_SECRET)) {
        return new Response('Forbidden', { status: 403 })
      }
      return new Response(query['hub.challenge'] ?? 'ok')
    },
  )
