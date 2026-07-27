import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import logixlysia from 'logixlysia'
import { errorSanitizerPlugin } from './plugins/error-sanitizer'
import { createRateLimitPlugin } from './plugins/rate-limit'
import { authManagementPlugin, internalEndpoints } from './plugins/auth-management'
import { authInboxPlugin } from './plugins/auth-inbox'
import { workspacesRoutes } from './routes/workspaces'
import { agentsRoutes } from './routes/agents'
import { connectionsRoutes } from './routes/connections'
import { labelsRoutes } from './routes/labels'
import { membersRoutes } from './routes/members'
import { invitesRoutes } from './routes/invites'
import { billingRoutes } from './routes/billing'
import { inboxAuthRoutes } from './routes/inbox-auth'
import { inboxConversationsRoutes } from './routes/inbox-conversations'
import { inboxAdminRoutes } from './routes/inbox-admin'
import { inboxFilesRoutes } from './routes/inbox-files'
import { inboxContactsRoutes } from './routes/inbox-contacts'
import { inboxPipelinesRoutes } from './routes/inbox-pipelines'
import { inboxBotsRoutes } from './routes/inbox-bots'
import { inboxQuickRepliesRoutes } from './routes/inbox-quick-replies'
import { inboxReportsRoutes } from './routes/inbox-reports'
import { inboxChatRoutes } from './routes/inbox-chat'
import { inboxTagsRoutes } from './routes/inbox-tags'
import { inboxContactsCsvRoutes } from './routes/inbox-contacts-csv'
import { inboxWsRoutes } from './routes/inbox-ws'
import { notificationRoutes } from './routes/notifications'
import { loadProductConfig } from './lib/config'
import { requireEnv } from './lib/env'
import { startRedisEventBridge } from './services/redis-events'

// O CRM atende dois hosts: o painel de gestão (apex crm.naia.website) e o
// inbox de cada workspace ([slug].crm.naia.website). Em dev, localhost e
// qualquer [slug].localhost. O plugin reflete a Origin da requisição quando
// o callback retorna true (necessário para credentials).
function isAllowedOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const { hostname } = url

  if (process.env.NODE_ENV !== 'production') {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
      return true
    }
  }

  if (url.protocol !== 'https:') return false
  return hostname === 'crm.naia.website' || hostname.endsWith('.crm.naia.website')
}

function buildCorsOrigin(): (request: Request) => boolean {
  return (request) => {
    const origin = request.headers.get('origin')
    return origin !== null && isAllowedOrigin(origin)
  }
}

async function bootstrap() {
  // Validate required secrets/config before starting.
  requireEnv('CRM_DATABASE_URL')
  requireEnv('CRM_JWT_SECRET')
  requireEnv('VIANOVA_INTERNAL_SECRET')
  requireEnv('CRM_OIDC_CLIENT_ID')
  requireEnv('CRM_OIDC_CLIENT_SECRET')
  requireEnv('VIANOVA_API_URL')
  requireEnv('VIANOVA_WEB_URL')
  requireEnv('CRM_WEB_URL')

  // O CRM tem client OIDC próprio (naia-crm). O pacote compartilhado
  // @naia/vianova-auth lê NAIA_OIDC_CLIENT_ID/SECRET em tempo de chamada
  // (verifyUserToken/verifyServiceToken usam como audience) — então mapeamos
  // os valores do CRM aqui, antes de qualquer request. Campaigns roda em outro
  // processo e mantém os seus.
  process.env.NAIA_OIDC_CLIENT_ID = process.env.CRM_OIDC_CLIENT_ID
  process.env.NAIA_OIDC_CLIENT_SECRET = process.env.CRM_OIDC_CLIENT_SECRET

  await loadProductConfig()
  const stopRedisEventBridge = await startRedisEventBridge()

  const isProduction = process.env.NODE_ENV === 'production'
  const corsOrigin = buildCorsOrigin()

  const app = new Elysia()
    .use(errorSanitizerPlugin)
    .use(
      createRateLimitPlugin({
        windowMs: 60_000,
        maxRequests: 120,
      }),
    )
    .use(
      cors({
        origin: corsOrigin,
        credentials: true,
      }),
    )
    .use(authManagementPlugin)
    .use(authInboxPlugin)
    .use(internalEndpoints)
    .use(
      logixlysia({
        config: {
          service: 'crm-api',
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
    .get('/health', () => ({ status: 'ok' }))
    .use(workspacesRoutes)
    .use(agentsRoutes)
    .use(connectionsRoutes)
    .use(labelsRoutes)
    .use(membersRoutes)
    .use(invitesRoutes)
    .use(billingRoutes)
    .use(inboxAuthRoutes)
    .use(inboxConversationsRoutes)
    .use(inboxAdminRoutes)
    .use(inboxFilesRoutes)
    .use(inboxContactsRoutes)
    .use(inboxPipelinesRoutes)
    .use(inboxBotsRoutes)
    .use(inboxQuickRepliesRoutes)
    .use(inboxReportsRoutes)
    .use(inboxChatRoutes)
    .use(inboxTagsRoutes)
    .use(inboxContactsCsvRoutes)
    .use(inboxWsRoutes)
    .use(notificationRoutes)
    .listen(process.env.PORT ?? 4002)

  console.log(`crm-api rodando na porta ${app.server?.port}`)

  async function shutdown() {
    app.stop()
    await stopRedisEventBridge()
    process.exit(0)
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  return app
}

const appPromise = bootstrap()

export type App = Awaited<typeof appPromise>
export default appPromise
