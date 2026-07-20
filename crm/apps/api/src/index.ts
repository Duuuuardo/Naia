import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import logixlysia from 'logixlysia'
import { errorSanitizerPlugin } from './plugins/error-sanitizer'
import { createRateLimitPlugin } from './plugins/rate-limit'
import { loadProductConfig } from './lib/config'
import { requireEnv } from './lib/env'

function buildCorsOrigin(): string | RegExp {
  const isProduction = process.env.NODE_ENV === 'production'

  if (!isProduction) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
  }

  const configuredOrigin = requireEnv('CRM_WEB_URL')
  return configuredOrigin
}

async function bootstrap() {
  // Validate required secrets/config before starting.
  requireEnv('CRM_DATABASE_URL')
  requireEnv('VIANOVA_INTERNAL_SECRET')
  requireEnv('NAIA_OIDC_CLIENT_ID')
  requireEnv('NAIA_OIDC_CLIENT_SECRET')
  requireEnv('VIANOVA_API_URL')
  requireEnv('VIANOVA_WEB_URL')

  await loadProductConfig()

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
    .listen(process.env.PORT ?? 4002)

  console.log(`crm-api rodando na porta ${app.server?.port}`)
  return app
}

const appPromise = bootstrap()

export type App = Awaited<typeof appPromise>
export default appPromise
