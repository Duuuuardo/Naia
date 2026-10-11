import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import logixlysia from 'logixlysia'
import { errorSanitizerPlugin } from './plugins/error-sanitizer'
import { rateLimitPlugin } from './plugins/rate-limit'
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
import { triggerRoutes } from './routes/triggers'
import { webhookRoutes } from './routes/webhooks'
import { internalRoutes } from './routes/internal'
import { billingRoutes } from './routes/billing'
import { filesRoutes } from './routes/files'
import { notificationRoutes } from './routes/notifications'
import { loadProductConfig, getConfigValue } from './lib/config'
import { getRequiredEnv, requireInProd } from './lib/env'

function conditionalSwagger(isProduction: boolean) {
  if (isProduction) return new Elysia()
  return swagger({
    documentation: {
      info: {
        title: 'Naia Campaigns API',
        version: '0.0.1',
        description: 'Workspace, contacts, connections and campaign dispatch for Naia Campaigns.',
      },
    },
  })
}

process.on('unhandledRejection', (reason: any) => {
  console.error('[naia-api] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err: any) => {
  console.error('[naia-api] Uncaught Exception:', err)
})

function validateRequiredEnv() {
  getRequiredEnv('NAIA_INTERNAL_SECRET')
  getRequiredEnv('VIANOVA_INTERNAL_SECRET')
  getRequiredEnv('WHATSAPP_VERIFY_TOKEN')

  getRequiredEnv('VIANOVA_API_URL')

  requireInProd('NAIA_WEB_URL')
}

async function bootstrap() {
  await loadProductConfig()
  validateRequiredEnv()

  const isProduction = process.env.NODE_ENV === 'production'

  const corsOrigin = isProduction
    ? getConfigValue<string>('app.url', process.env.NAIA_WEB_URL!)
    : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 2_000)
  const port = Number(process.env.PORT ?? 4001)

  const app = new Elysia()
    .onAfterHandle(({ set }) => {
      set.headers['x-content-type-options'] = 'nosniff'
      set.headers['x-frame-options'] = 'DENY'
      set.headers['referrer-policy'] = 'no-referrer'
    })
    .use(errorSanitizerPlugin)
    .use(rateLimitPlugin({ windowMs: rateLimitWindowMs, max: rateLimitMax, exclude: ['/auth/me', '/health'] }))
    .use(
      cors({
        origin: corsOrigin,
        credentials: true,
      }),
    )
    .use(conditionalSwagger(isProduction))
    .use(
      logixlysia({
        config: {
          service: 'naia-api',
          showStartupMessage: true,
          startupMessageFormat: 'banner',
          showContextTree: !isProduction,
          contextDepth: isProduction ? 0 : 2,
          slowThreshold: 500,
          verySlowThreshold: 1000,
          timestamp: {
            translateTime: 'yyyy-mm-dd HH:MM:ss.SSS',
          },
          ip: !isProduction,
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
    .use(triggerRoutes)
    .use(webhookRoutes)
    .use(internalRoutes)
    .use(billingRoutes)
    .use(filesRoutes)
    .use(notificationRoutes)
    .get('/health', () => ({ status: 'ok' }))
    .listen(port)

  console.log(`naia-api rodando na porta ${app.server?.port}`)
  return app
}

const appPromise = bootstrap()

export type App = Awaited<typeof appPromise>
export default appPromise
