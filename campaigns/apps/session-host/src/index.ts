import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import logixlysia from 'logixlysia'
import { db, connections, entitlements } from '@naia/db'
import { eq, inArray } from 'drizzle-orm'
import { sanitizeErrorMessage, MediaRefSchema } from '@naia/schemas'
import { getHostId, connectionBelongsToHost, type HostId } from './lib/host'
import { registerConnection, unregisterConnection } from './lib/redis-registry'
import {
  startWhatsAppSession,
  getQRCode,
  getSocketStatus,
  disconnectWhatsApp,
  fetchWhatsAppContacts,
  fetchWhatsAppGroups,
  getGroupParticipants,
  resolveWhatsAppContactName,
  enrichWhatsAppContactInfo,
  batchEnrichWhatsAppContacts,
  sendWhatsAppMessage,
} from './lib/whatsapp-manager'
import {
  startTelegramUserLogin,
  connectExistingTelegramUser,
  submitTelegramCode,
  submitTelegramPassword,
  getTelegramAuthState,
  getTelegramUserStatus,
  disconnectTelegramUser,
  fetchTelegramUserContacts,
  fetchTelegramUserGroups,
  importTelegramGroupMembers,
  sendTelegramUserMessage,
  isTelegramUserConfig,
} from './lib/telegram-user-manager'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[session-host] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

const INTERNAL_SECRET = requireEnv('NAIA_INTERNAL_SECRET')
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

function rateLimitKey(ip: string, path: string): string {
  return `${ip}:${path}`
}

function isRateLimited(ip: string, path: string): boolean {
  const now = Date.now()
  const key = rateLimitKey(ip, path)
  const window = rateLimitMap.get(key)
  if (!window || now >= window.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  window.count++
  return window.count > RATE_LIMIT_MAX
}

function cleanupRateLimitMap(): void {
  const now = Date.now()
  for (const [key, window] of rateLimitMap) {
    if (now >= window.resetAt) rateLimitMap.delete(key)
  }
}

setInterval(cleanupRateLimitMap, RATE_LIMIT_WINDOW_MS)

function parseAllowedOrigins(): string[] | null {
  const raw = process.env.NAIA_ALLOWED_ORIGINS
  if (!raw) return null
  return raw.split(',').map((o) => o.trim()).filter(Boolean)
}

function buildCorsOrigin(): string | string[] | RegExp | false {
  const isProd = process.env.NODE_ENV === 'production'
  const allowed = parseAllowedOrigins()

  if (isProd) {
    if (!allowed || allowed.length === 0) {
      throw new Error('[session-host] NAIA_ALLOWED_ORIGINS deve estar configurado em produção')
    }
    return allowed
  }

  // Em dev, se houver configuração explícita, respeita-a; senão permite localhost.
  if (allowed && allowed.length > 0) return allowed
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
}

function isBaileysCancelError(err: any): boolean {
  const msg = err?.message || String(err)
  const isCancelled = msg.includes('Cancelled') || msg.includes('Connection Closed') || err?.output?.statusCode === 500
  return isCancelled && (err?.isBoom || err?.stack?.includes('baileys') || err?.stack?.includes('generics.js'))
}

function isTeleprotoTimeout(err: any): boolean {
  const msg = err?.message || String(err)
  return msg === 'TIMEOUT' && Boolean(err?.stack?.includes('teleproto'))
}

process.on('unhandledRejection', (reason: any) => {
  if (isBaileysCancelError(reason) || isTeleprotoTimeout(reason)) return
  console.error('[session-host] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err: any) => {
  if (isBaileysCancelError(err) || isTeleprotoTimeout(err)) return
  console.error('[session-host] Uncaught Exception:', err)
})

const app = new Elysia()
  .onBeforeHandle(({ request, set }) => {
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
    if (isRateLimited(ip, new URL(request.url).pathname)) {
      set.status = 429
      return { message: 'Muitas requisições. Tente novamente mais tarde.' }
    }
  })
  .use(
    cors({
      origin: buildCorsOrigin(),
      credentials: true,
    }),
  )
  .use(
    logixlysia({
      config: {
        service: 'naia-session-host',
        showStartupMessage: true,
        startupMessageFormat: 'banner',
        showContextTree: true,
        contextDepth: 2,
        slowThreshold: 500,
        verySlowThreshold: 1000,
        timestamp: {
          translateTime: 'yyyy-mm-dd HH:MM:ss.SSS',
        },
        ip: true,
      },
    }),
  )

  .get('/health', () => ({ status: 'ok', service: 'naia-session-host', hostId }))

  .group('/internal', (app) =>
    app
      .post(
        '/whatsapp-send',
        async ({ body, headers, set }) => {
          if (!requireInternalSecret(headers, set)) return { success: false, error: 'Não autorizado.' }
          try {
            const result = await sendWhatsAppMessage(body.connectionId, body.phone, body.content, body.media)
            return { success: true, externalMessageId: result.externalMessageId }
          } catch (err) {
            return { success: false, error: sanitizeErrorMessage(err, 'Falha interna ao processar envio de mensagem via WhatsApp.') }
          }
        },
        {
          body: t.Object({
            connectionId: t.String(),
            phone: t.String(),
            content: t.String(),
            media: t.Optional(t.Array(MediaRefSchema)),
          }),
        },
      )
      .post(
        '/telegram-user-send',
        async ({ body, headers, set }) => {
          if (!requireInternalSecret(headers, set)) return { success: false, error: 'Não autorizado.' }
          try {
            const result = await sendTelegramUserMessage(body.connectionId, body.target, body.content, body.media)
            return { success: true, externalMessageId: result.externalMessageId }
          } catch (err) {
            return { success: false, error: sanitizeErrorMessage(err, 'Falha interna ao processar envio de mensagem via Telegram.') }
          }
        },
        {
          body: t.Object({
            connectionId: t.String(),
            target: t.String(),
            content: t.String(),
            media: t.Optional(t.Array(MediaRefSchema)),
          }),
        },
      ),
  )

  .group('/sessions', (app) =>
    app
      .onBeforeHandle(({ headers, set }) => {
        if (!requireInternalSecret(headers, set)) {
          return { message: 'Não autorizado.' }
        }
      })
      .post('/whatsapp/:connectionId/start', async ({ params }) => {
        await startWhatsAppSession(params.connectionId)
        await registerConnection(params.connectionId, hostId)
        return { connectionId: params.connectionId }
      })

      .post('/telegram/:connectionId/start', async ({ params }) => {
        await startTelegramUserLogin(params.connectionId)
        await registerConnection(params.connectionId, hostId)
        return { connectionId: params.connectionId }
      })

      .post(
        '/:connectionId/telegram-code',
        async ({ params, body, set }) => {
          const accepted = submitTelegramCode(params.connectionId, body.code)
          if (!accepted) { set.status = 400; return { message: 'Nenhum login aguardando código para esta conexão.' } }
          return { message: 'Código recebido — validando...' }
        },
        { body: t.Object({ code: t.String({ minLength: 1 }) }) },
      )

      .post(
        '/:connectionId/telegram-password',
        async ({ params, body, set }) => {
          const accepted = submitTelegramPassword(params.connectionId, body.password)
          if (!accepted) { set.status = 400; return { message: 'Nenhum login aguardando senha 2FA para esta conexão.' } }
          return { message: 'Senha recebida — validando...' }
        },
        { body: t.Object({ password: t.String({ minLength: 1 }) }) },
      )

      .post(
        '/:connectionId/reconnect',
        async ({ params, body, set }) => {
          const [conn] = await db
            .select({ channel: connections.channel, config: connections.config })
            .from(connections)
            .where(eq(connections.id, params.connectionId))
            .limit(1)
          if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

          if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
            await disconnectTelegramUser(params.connectionId)
            await db.update(connections).set({ status: 'disconnected', updatedAt: new Date() }).where(eq(connections.id, params.connectionId))
            connectExistingTelegramUser(params.connectionId)
              .then((ok) => { if (!ok) return startTelegramUserLogin(params.connectionId) })
              .catch(console.error)
            await registerConnection(params.connectionId, hostId)
            return { message: 'Reconexão iniciada.' }
          }

          if (conn.channel !== 'whatsapp') { set.status = 400; return { message: 'Canal não suportado para reconexão.' } }

          await disconnectWhatsApp(params.connectionId)
          await db
            .update(connections)
            .set({ status: 'disconnected', config: '{}', updatedAt: new Date() })
            .where(eq(connections.id, params.connectionId))
          startWhatsAppSession(params.connectionId).catch(console.error)
          await registerConnection(params.connectionId, hostId)
          return { message: 'Reconexão iniciada.' }
        },
        { body: t.Object({ channel: t.Union([t.Literal('whatsapp'), t.Literal('telegram')]) }) },
      )

      .post(
        '/:connectionId/disconnect',
        async ({ params, body, set }) => {
          const [conn] = await db
            .select({ channel: connections.channel, config: connections.config })
            .from(connections)
            .where(eq(connections.id, params.connectionId))
            .limit(1)
          if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

          if (conn.channel === 'whatsapp') {
            await disconnectWhatsApp(params.connectionId)
          } else if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
            await disconnectTelegramUser(params.connectionId, { logout: body.logout })
          }
          await unregisterConnection(params.connectionId)
          return { message: 'Conexão desconectada.' }
        },
        { body: t.Object({ channel: t.Union([t.Literal('whatsapp'), t.Literal('telegram')]), logout: t.Optional(t.Boolean()) }) },
      )

      .get('/:connectionId/status', async ({ params }) => {
        const [conn] = await db
          .select({ channel: connections.channel, config: connections.config, status: connections.status })
          .from(connections)
          .where(eq(connections.id, params.connectionId))
          .limit(1)

        if (!conn) {
          return { socketStatus: 'disconnected' as const, qr: null, telegramAuth: null }
        }

        const isTgUser = conn.channel === 'telegram' && isTelegramUserConfig(conn.config)
        const socketStatus = conn.channel === 'whatsapp'
          ? getSocketStatus(params.connectionId)
          : isTgUser
            ? getTelegramUserStatus(params.connectionId)
            : 'disconnected' as const

        return {
          socketStatus,
          qr: conn.channel === 'whatsapp' ? getQRCode(params.connectionId) : null,
          telegramAuth: isTgUser ? getTelegramAuthState(params.connectionId) : null,
        }
      })

      .get('/:connectionId/contacts', async ({ params, set }) => {
        const [conn] = await db
          .select({ channel: connections.channel, config: connections.config })
          .from(connections)
          .where(eq(connections.id, params.connectionId))
          .limit(1)
        if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

        if (conn.channel === 'whatsapp') {
          const contacts = await fetchWhatsAppContacts(params.connectionId)
          return { contacts }
        }
        if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
          const contacts = await fetchTelegramUserContacts(params.connectionId)
          return { contacts }
        }
        return { contacts: [] }
      })

      .get('/:connectionId/groups', async ({ params, set }) => {
        const [conn] = await db
          .select({ channel: connections.channel, config: connections.config })
          .from(connections)
          .where(eq(connections.id, params.connectionId))
          .limit(1)
        if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

        try {
          if (conn.channel === 'whatsapp') {
            const groups = await fetchWhatsAppGroups(params.connectionId)
            return { groups }
          }
          if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
            const groups = await fetchTelegramUserGroups(params.connectionId)
            return { groups }
          }
          return { groups: [] }
        } catch (err) {
          set.status = 400
          return { message: sanitizeErrorMessage(err, 'Falha ao buscar grupos.') }
        }
      })

      .post(
        '/:connectionId/group-participants',
        async ({ params, body, set }) => {
          try {
            const participants = await getGroupParticipants(params.connectionId, body.groupJid)
            return { participants }
          } catch (err) {
            set.status = 400
            return { message: sanitizeErrorMessage(err, 'Falha ao buscar participantes do grupo.') }
          }
        },
        { body: t.Object({ groupJid: t.String() }) },
      )

      .post(
        '/:connectionId/import-group-members',
        async ({ params, body, set }) => {
          const [conn] = await db
            .select({ channel: connections.channel, config: connections.config })
            .from(connections)
            .where(eq(connections.id, params.connectionId))
            .limit(1)
          if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

          try {
            if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
              return await importTelegramGroupMembers(params.connectionId, body.workspaceId, body.groupId, body.tags)
            }
            set.status = 400
            return { message: 'Importação de membros só é suportada para conta de usuário Telegram.' }
          } catch (err) {
            set.status = 400
            return { message: sanitizeErrorMessage(err, 'Falha ao importar membros do grupo.') }
          }
        },
        {
          body: t.Object({
            workspaceId: t.String(),
            groupId: t.String(),
            tags: t.Array(t.String()),
          }),
        },
      )

      .post(
        '/:connectionId/enrich-contact',
        async ({ params, body }) => {
          const enriched = await enrichWhatsAppContactInfo(params.connectionId, body.phoneOrJid, body.existingName, true)
          return enriched
        },
        {
          body: t.Object({
            phoneOrJid: t.String(),
            existingName: t.Optional(t.Nullable(t.String())),
          }),
        },
      )

      .post(
        '/:connectionId/resolve-contact-name',
        async ({ params, body }) => {
          const name = resolveWhatsAppContactName(params.connectionId, body.phoneOrJid, body.fallbackCandidate ?? null)
          return { name }
        },
        {
          body: t.Object({
            phoneOrJid: t.String(),
            fallbackCandidate: t.Optional(t.Nullable(t.String())),
          }),
        },
      )

      .post(
        '/:connectionId/enrich-contacts-batch',
        async ({ params, body }) => {
          const map = await batchEnrichWhatsAppContacts(
            params.connectionId,
            body.items.map((item: { id: string; name?: string | null; avatarUrl?: string | null }) => ({
              id: item.id,
              name: item.name,
              avatarUrl: item.avatarUrl,
            })),
          )
          return {
            entries: Array.from(map.entries()).map(([id, value]) => ({ id, ...value })),
          }
        },
        {
          body: t.Object({
            items: t.Array(
              t.Object({
                id: t.String(),
                name: t.Optional(t.Nullable(t.String())),
                avatarUrl: t.Optional(t.Nullable(t.String())),
              }),
            ),
          }),
        },
      ),
  )

  .listen(process.env.PORT ?? 4010)

console.log(`naia-session-host (${hostId}) rodando na porta ${app.server?.port}`)

async function boot(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: connections.id,
        channel: connections.channel,
        status: connections.status,
        config: connections.config,
        tier: entitlements.tier,
      })
      .from(connections)
      .innerJoin(entitlements, eq(entitlements.workspaceId, connections.workspaceId))
      .where(inArray(connections.channel, ['whatsapp', 'telegram']))

    const ownRows = rows.filter((r) => connectionBelongsToHost(r.tier, hostId))
    console.log(`[session-host] ${ownRows.length} conexões atribuídas a este host (${hostId})`)

    for (const row of ownRows) {
      if (row.channel === 'whatsapp') {
        if (row.status === 'active' || row.status === 'disconnected' || row.status === 'error') {
          startWhatsAppSession(row.id)
            .then(() => registerConnection(row.id, hostId))
            .catch((err) => console.error(`[session-host] falha ao iniciar WhatsApp ${row.id}:`, err))
        }
      } else if (row.channel === 'telegram' && isTelegramUserConfig(row.config)) {
        if (row.status === 'active' || row.status === 'error') {
          connectExistingTelegramUser(row.id)
            .then((ok) => {
              if (ok) return registerConnection(row.id, hostId)
              return startTelegramUserLogin(row.id).then(() => registerConnection(row.id, hostId))
            })
            .catch((err) => console.error(`[session-host] falha ao iniciar Telegram ${row.id}:`, err))
        }
      }
    }
  } catch (err) {
    console.error('[session-host] erro no boot:', err)
  }
}

boot().catch(console.error)

export type App = typeof app
export default app
