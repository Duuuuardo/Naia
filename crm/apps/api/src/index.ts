import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import logixlysia from 'logixlysia'
import { errorSanitizerPlugin } from './plugins/error-sanitizer'
import { loadProductConfig, getConfigValue } from './lib/config'

async function bootstrap() {
  await loadProductConfig()

  const corsOrigin =
    process.env.NODE_ENV !== 'production'
      ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
      : getConfigValue<string>('app.url', process.env.CRM_WEB_URL ?? 'http://localhost:3302')

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
            title: 'Naia CRM API',
            version: '0.0.1',
            description: 'Multi-channel inbox and conversations for Naia CRM (Milestone 3).',
          },
        },
      }),
    )
    .use(
      logixlysia({
        config: {
          service: 'crm-api',
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
    .get('/health', () => ({ status: 'ok', service: 'crm-api' }))
    .get('/config', () => ({ config: getConfigValue<Record<string, unknown>>('config', {}) }))
    .listen(process.env.PORT ?? 4002)

  console.log(`crm-api rodando na porta ${app.server?.port}`)
  return app
}

const appPromise = bootstrap()

export type App = Awaited<typeof appPromise>
export default appPromise
