import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import logixlysia from 'logixlysia'
import { errorSanitizerPlugin } from './plugins/error-sanitizer'

// Scaffold do Naia CRM (Milestone 3). Setup de estrutura apenas — nenhuma
// feature de produto foi iniciada. Regras em docs/crm-business-rules.md;
// padrões de código em docs/crm-stack.md (skill crm-stack).
const app = new Elysia()
  .use(errorSanitizerPlugin)
  .use(
    cors({
      origin:
        process.env.NODE_ENV !== 'production'
          ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
          : (process.env.CRM_WEB_URL ?? 'http://localhost:3302'),
      credentials: true,
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
  .listen(process.env.PORT ?? 4002)

console.log(`crm-api rodando na porta ${app.server?.port}`)

export type App = typeof app
export default app
