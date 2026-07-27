import { Elysia, t } from 'elysia'
import logixlysia from 'logixlysia'
import { db, connections } from '@crm/db'
import { eq, inArray } from 'drizzle-orm'
import { closeCrmRedis } from '@crm/queue'
import { getHostId } from './lib/host'
import { registerConnection, unregisterConnection } from './lib/redis-registry'
import {
  startWhatsAppSession,
  getQRCode,
  getSocketStatus,
  disconnectWhatsApp,
  sendWhatsAppMessage,
} from './lib/whatsapp-manager'
import {
  startTelegramBot,
  getTelegramBotStatus,
  stopTelegramBot,
  sendTelegramMessage,
} from './lib/telegram-bot-manager'
import { publishSessionDisconnected } from './lib/session-events'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[session-host] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

const INTERNAL_SECRET = requireEnv('CRM_INTERNAL_SECRET')
const port = Number(process.env.CRM_SESSION_HOST_PORT ?? 4020)
const hostId = getHostId()

function requireInternalSecret(headers: Record<string, string | undefined>, set: { status?: number | string | undefined }): boolean {
  const header = headers['x-internal-secret']
  if (!header || header !== INTERNAL_SECRET) {
    set.status = 401
    return false
  }
  return true
}

// Rate limiting em memória por IP + rota. Em produção com múltiplas réplicas
// deve-se trocar por store compartilhado (Redis), mas este é o mínimo seguro
// para o session-host single-instance.
type RateWindow = { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateWindow>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120

function isRateLimited(ip: string, path: string): boolean {
  const now = Date.now()
  const key = `${ip}:${path}`
  const window = rateLimitMap.get(key)
  if (!window || now >= window.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  window.count++
  return window.count > RATE_LIMIT_MAX
}

setInterval(() => {
  const now = Date.now()
  for (const [key, window] of rateLimitMap) {
    if (now >= window.resetAt) rateLimitMap.delete(key)
  }
}, RATE_LIMIT_WINDOW_MS)

// Rejections esperadas do Baileys quando o socket reinicia no meio de uma
// chamada — não são bugs, não devem sujar o log nem derrubar o processo.
function isBaileysCancelError(err: any): boolean {
  const msg = err?.message || String(err)
  const isCancelled = msg.includes('Cancelled') || msg.includes('Connection Closed') || err?.output?.statusCode === 500
  return isCancelled && (err?.isBoom || err?.stack?.includes('baileys') || err?.stack?.includes('generics.js'))
}

process.on('unhandledRejection', (reason: any) => {
  if (isBaileysCancelError(reason)) return
  console.error('[session-host] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err: any) => {
  if (isBaileysCancelError(err)) return
  console.error('[session-host] Uncaught Exception:', err)
})

// MediaRef (@crm/schemas) como TypeBox inline — @crm/schemas exporta só tipos.
const MediaRefSchema = t.Object({
  storageKey: t.String(),
  mimeType: t.String(),
  kind: t.Union([t.Literal('image'), t.Literal('video'), t.Literal('audio'), t.Literal('document')]),
  filename: t.String(),
})

const channelBody = t.Object({ channel: t.Union([t.Literal('whatsapp'), t.Literal('telegram')]) })

// OutboundButton (@crm/queue) como TypeBox inline — @crm/queue exporta só tipos.
const ButtonSchema = t.Object({ id: t.String(), label: t.String() })

// WhatsApp (Baileys) não tem botões confiáveis: degrada para lista numerada
// anexada ao final do texto. O contato responde com o número ou o label.
function withNumberedOptions(content: string, buttons?: { id: string; label: string }[]): string {
  if (!buttons || buttons.length === 0) return content
  const lines = buttons.map((button, index) => `${index + 1}. ${button.label}`)
  return [content, ...lines].filter((line) => line.length > 0).join('\n')
}

function sanitizeError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : ''
  // Mensagens de infra (DB, Redis, rede) podem vazar detalhes sensíveis.
  if (!msg || msg.length > 200) return fallback
  return msg
}

const app = new Elysia()
  .onBeforeHandle(({ request, set }) => {
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
    if (isRateLimited(ip, new URL(request.url).pathname)) {
      set.status = 429
      return { message: 'Muitas requisições. Tente novamente mais tarde.' }
    }
  })
  .use(
    logixlysia({
      config: {
        service: 'crm-session-host',
        showStartupMessage: true,
        startupMessageFormat: 'banner',
        showContextTree: process.env.NODE_ENV !== 'production',
        contextDepth: process.env.NODE_ENV === 'production' ? 0 : 2,
      },
    }),
  )

  .get('/health', () => ({ status: 'ok', service: 'crm-session-host', hostId }))

  .guard(
    {
      beforeHandle({ headers, set }) {
        if (!requireInternalSecret(headers, set)) {
          return { message: 'Não autorizado.' }
        }
      },
    },
    (app) =>
      app
        .post('/sessions/whatsapp/:connectionId/start', async ({ params, set }) => {
          try {
            await startWhatsAppSession(params.connectionId)
            await registerConnection(params.connectionId, hostId)
            return { connectionId: params.connectionId }
          } catch (err) {
            set.status = 400
            return { message: sanitizeError(err, 'Falha ao iniciar sessão WhatsApp.') }
          }
        })

        .post('/sessions/telegram/:connectionId/start', async ({ params, set }) => {
          try {
            await startTelegramBot(params.connectionId)
            await registerConnection(params.connectionId, hostId)
            return { connectionId: params.connectionId }
          } catch (err) {
            set.status = 400
            return { message: sanitizeError(err, 'Falha ao iniciar bot Telegram.') }
          }
        })

        .post(
          '/sessions/:connectionId/reconnect',
          async ({ params, body, set }) => {
            const [conn] = await db
              .select({ kind: connections.kind })
              .from(connections)
              .where(eq(connections.id, params.connectionId))
              .limit(1)
            if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

            try {
              if (body.channel === 'whatsapp') {
                // Logout limpa sessão + config → sobe de novo pedindo QR novo.
                await disconnectWhatsApp(params.connectionId, { logout: true })
                await startWhatsAppSession(params.connectionId)
              } else {
                await stopTelegramBot(params.connectionId)
                await startTelegramBot(params.connectionId)
              }
              await registerConnection(params.connectionId, hostId)
              return { message: 'Reconexão iniciada.' }
            } catch (err) {
              set.status = 400
              return { message: sanitizeError(err, 'Falha ao reconectar.') }
            }
          },
          { body: channelBody },
        )

        .post(
          '/sessions/:connectionId/disconnect',
          async ({ params, body, set }) => {
            const [conn] = await db
              .select({ workspaceId: connections.workspaceId, kind: connections.kind })
              .from(connections)
              .where(eq(connections.id, params.connectionId))
              .limit(1)
            if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

            if (body.channel === 'whatsapp') {
              await disconnectWhatsApp(params.connectionId, { logout: body.logout ?? false })
              if (!body.logout) {
                await db
                  .update(connections)
                  .set({ status: 'disconnected', updatedAt: new Date() })
                  .where(eq(connections.id, params.connectionId))
              }
              publishSessionDisconnected({
                workspaceId: conn.workspaceId,
                connectionId: params.connectionId,
                channel: 'whatsapp',
                reason: body.logout ? 'Logout solicitado pelo workspace.' : 'Desconexão solicitada pelo workspace.',
              }).catch(console.error)
            } else {
              await stopTelegramBot(params.connectionId, 'Desconexão solicitada pelo workspace.')
            }
            await unregisterConnection(params.connectionId)
            return { message: 'Conexão desconectada.' }
          },
          { body: t.Object({ channel: channelBody.properties.channel, logout: t.Optional(t.Boolean()) }) },
        )

        .get('/sessions/:connectionId/status', async ({ params, set }) => {
          const [conn] = await db
            .select({ kind: connections.kind })
            .from(connections)
            .where(eq(connections.id, params.connectionId))
            .limit(1)
          if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

          const telegramStatus = conn.kind === 'telegram' ? getTelegramBotStatus(params.connectionId) : null
          const socketStatus = conn.kind === 'whatsapp'
            ? getSocketStatus(params.connectionId)
            : (telegramStatus ?? 'disconnected')

          return {
            socketStatus,
            qr: conn.kind === 'whatsapp' ? getQRCode(params.connectionId) : null,
            telegramStatus,
          }
        })

        .post(
          '/internal/whatsapp-send',
          async ({ body, set }) => {
            try {
              const result = await sendWhatsAppMessage(
                body.connectionId,
                body.phone,
                withNumberedOptions(body.content, body.buttons),
                body.media,
              )
              return { success: true as const, externalMessageId: result.externalMessageId }
            } catch (err) {
              set.status = 400
              return { success: false as const, error: sanitizeError(err, 'Falha interna ao enviar mensagem via WhatsApp.') }
            }
          },
          {
            body: t.Object({
              connectionId: t.String(),
              phone: t.String(),
              content: t.String(),
              media: t.Optional(t.Array(MediaRefSchema)),
              buttons: t.Optional(t.Array(ButtonSchema)),
            }),
          },
        )

        .post(
          '/internal/telegram-send',
          async ({ body, set }) => {
            try {
              const result = await sendTelegramMessage(body.connectionId, body.chatId, body.content, body.media, body.buttons)
              return { success: true as const, externalMessageId: result.externalMessageId }
            } catch (err) {
              set.status = 400
              return { success: false as const, error: sanitizeError(err, 'Falha interna ao enviar mensagem via Telegram.') }
            }
          },
          {
            body: t.Object({
              connectionId: t.String(),
              chatId: t.String(),
              content: t.String(),
              media: t.Optional(t.Array(MediaRefSchema)),
              buttons: t.Optional(t.Array(ButtonSchema)),
            }),
          },
        ),
  )
  .listen(port)

console.log(`[crm-session-host] ${hostId} ouvindo na porta ${port}`)

// Restaura as sessões de todas as conexões deste host (hoje: todas — 1 host só).
async function boot(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: connections.id,
        kind: connections.kind,
        status: connections.status,
        config: connections.config,
      })
      .from(connections)
      .where(inArray(connections.status, ['active', 'disconnected', 'error']))

    console.log(`[session-host] restaurando ${rows.length} conexões no boot (${hostId})`)

    for (const row of rows) {
      if (row.kind === 'whatsapp') {
        startWhatsAppSession(row.id)
          .then(() => registerConnection(row.id, hostId))
          .catch((err) => console.error(`[session-host] falha ao iniciar WhatsApp ${row.id}:`, err))
      } else if (row.kind === 'telegram' && typeof row.config?.token === 'string') {
        startTelegramBot(row.id)
          .then(() => registerConnection(row.id, hostId))
          .catch((err) => console.error(`[session-host] falha ao iniciar Telegram ${row.id}:`, err))
      }
    }
  } catch (err) {
    console.error('[session-host] erro no boot:', err)
  }
}

boot().catch(console.error)

async function shutdown(): Promise<void> {
  app.stop()
  await closeCrmRedis()
  process.exit(0)
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

export type CrmSessionHost = typeof app
