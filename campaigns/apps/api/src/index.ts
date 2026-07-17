import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import logixlysia from 'logixlysia'
import { errorSanitizerPlugin } from './plugins/error-sanitizer'
import { authPlugin } from './plugins/auth'
import { authRoutes } from './routes/auth'
import { workspaceRoutes } from './routes/workspaces'
import { memberRoutes } from './routes/members'
import { inviteRoutes } from './routes/invites'
import { contactRoutes } from './routes/contacts'
import { connectionRoutes } from './routes/connections'
import { campaignRoutes } from './routes/campaigns'
import { mediaRoutes } from './routes/media'
import { automationRoutes } from './routes/automations'
import { webhookRoutes } from './routes/webhooks'
import { internalRoutes } from './routes/internal'
import { billingRoutes } from './routes/billing'

import { initAllWhatsAppSessions } from './lib/whatsapp-manager'
import { initAllTelegramUserSessions } from './lib/telegram-user-manager'

function isBaileysCancelError(err: any): boolean {
  const msg = err?.message || String(err)
  const isCancelled = msg.includes('Cancelled') || msg.includes('Connection Closed') || err?.output?.statusCode === 500
  return isCancelled && (err?.isBoom || err?.stack?.includes('baileys') || err?.stack?.includes('generics.js'))
}

// gramjs/teleproto dispara rejections 'TIMEOUT' internos no keepalive — são
// esperados e o cliente se recupera sozinho, não podem poluir o log.
function isTeleprotoTimeout(err: any): boolean {
  const msg = err?.message || String(err)
  return msg === 'TIMEOUT' && Boolean(err?.stack?.includes('teleproto'))
}

process.on('unhandledRejection', (reason: any) => {
  if (isBaileysCancelError(reason) || isTeleprotoTimeout(reason)) return
  console.error('[naia-api] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err: any) => {
  if (isBaileysCancelError(err) || isTeleprotoTimeout(err)) return
  console.error('[naia-api] Uncaught Exception:', err)
})

const app = new Elysia()
  .use(errorSanitizerPlugin)
  .use(
    cors({
      origin:
        process.env.NODE_ENV !== 'production'
          ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
          : (process.env.NAIA_WEB_URL ?? 'http://localhost:3001'),
      credentials: true,
    }),
  )
  .use(
    logixlysia({
      config: {
        service: 'naia-api',
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
  .use(authPlugin)
  .use(authRoutes)
  .use(workspaceRoutes)
  .use(memberRoutes)
  .use(inviteRoutes)
  .use(contactRoutes)
  .use(connectionRoutes)
  .use(campaignRoutes)
  .use(mediaRoutes)
  .use(automationRoutes)
  .use(webhookRoutes)
  .use(internalRoutes)
  .use(billingRoutes)
  .get('/health', () => ({ status: 'ok', service: 'naia-api' }))
  .listen(process.env.PORT ?? 4001)

console.log(`naia-api rodando na porta ${app.server?.port}`)

initAllWhatsAppSessions().catch(console.error)
initAllTelegramUserSessions().catch(console.error)

export type App = typeof app
export default app
