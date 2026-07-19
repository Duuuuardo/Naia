import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
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
import { triggerRoutes } from './routes/triggers'
import { webhookRoutes } from './routes/webhooks'
import { internalRoutes } from './routes/internal'
import { billingRoutes } from './routes/billing'
import { filesRoutes } from './routes/files'
import { notificationRoutes } from './routes/notifications'
import { loadProductConfig, getConfigValue } from './lib/config'

process.on('unhandledRejection', (reason: any) => {
  console.error('[naia-api] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err: any) => {
  console.error('[naia-api] Uncaught Exception:', err)
})

async function bootstrap() {
  await loadProductConfig()

  const corsOrigin =
    process.env.NODE_ENV !== 'production'
      ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
      : getConfigValue<string>('app.url', process.env.NAIA_WEB_URL ?? 'http://localhost:3001')

  const app = new Elysia()
    .use(errorSanitizerPlugin)
    .use(
      cors({
        origin: corsOrigin,
        credentials: true,
      }),
    )
    .use(
      swagger({
        documentation: {
          info: {
            title: 'Naia Campaigns API',
            version: '0.0.1',
            description: 'Workspace, contacts, connections and campaign dispatch for Naia Campaigns.',
          },
        },
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
    .use(triggerRoutes)
    .use(webhookRoutes)
    .use(internalRoutes)
    .use(billingRoutes)
    .use(filesRoutes)
    .use(notificationRoutes)
    .get('/health', () => ({ status: 'ok', service: 'naia-api' }))
    .get('/config', () => ({ config: getConfigValue<Record<string, unknown>>('config', {}) }))
    .listen(process.env.PORT ?? 4001)

  console.log(`naia-api rodando na porta ${app.server?.port}`)
  return app
}

const appPromise = bootstrap()

export type App = Awaited<typeof appPromise>
export default appPromise
