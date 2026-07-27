import {
  CRM_QUEUES,
  closeCrmRedis,
  createCrmWorker,
  getCrmRedis,
  type BotResumeJob,
  type InboundMessageJob,
  type OutboundMessageJob,
} from '@crm/queue'
import { handleInboundMessage } from './handlers/inbound'
import { handleOutboundMessage } from './handlers/outbound'
import { handleBotResume } from './handlers/bot-resume'

// Worker do CRM: consome as filas de mensageria (inbound/outbound) e roda o
// bot engine. Handlers de produto vivem NESTE processo, nunca na API nem no
// Campaigns.

function requireEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`[crm-worker] variável de ambiente ${name} é obrigatória.`)
  }
}

async function bootstrap(): Promise<void> {
  // CRM_DATABASE_URL é validada no import do @crm/db; aqui falhamos cedo para
  // as demais variáveis de infra do worker.
  requireEnv('CRM_DATABASE_URL')
  requireEnv('CRM_INTERNAL_SECRET')
  if (!process.env.CRM_REDIS_URL && !process.env.NAIA_REDIS_URL) {
    throw new Error('[crm-worker] CRM_REDIS_URL ou NAIA_REDIS_URL é obrigatória.')
  }

  const redis = getCrmRedis()
  await redis.ping()

  const inboundWorker = createCrmWorker<InboundMessageJob>(
    CRM_QUEUES.INBOUND_MESSAGES,
    async (job) => {
      await handleInboundMessage(job.data)
    },
    { concurrency: 10 },
  )
  inboundWorker.on('failed', (job, error) => {
    console.error(`[crm-worker] job inbound ${job?.id} falhou definitivamente:`, error)
  })

  const outboundWorker = createCrmWorker<OutboundMessageJob>(
    CRM_QUEUES.OUTBOUND_MESSAGES,
    async (job) => {
      await handleOutboundMessage(job.data)
    },
    { concurrency: 5 },
  )
  outboundWorker.on('failed', (job, error) => {
    console.error(`[crm-worker] job outbound ${job?.id} falhou definitivamente:`, error)
  })

  // Retomada de sessões de bot agendadas por nós 'delay' (jobs delayed).
  const botResumeWorker = createCrmWorker<BotResumeJob>(
    CRM_QUEUES.BOT_RESUME,
    async (job) => {
      await handleBotResume(job.data)
    },
    { concurrency: 5 },
  )
  botResumeWorker.on('failed', (job, error) => {
    console.error(`[crm-worker] job bot-resume ${job?.id} falhou definitivamente:`, error)
  })

  console.log('[crm-worker] pronto; filas ativas:')
  console.log(`  - ${CRM_QUEUES.INBOUND_MESSAGES} (concurrency 10)`)
  console.log(`  - ${CRM_QUEUES.OUTBOUND_MESSAGES} (concurrency 5)`)
  console.log(`  - ${CRM_QUEUES.BOT_RESUME} (concurrency 5)`)

  async function shutdown(): Promise<void> {
    console.log('[crm-worker] encerrando...')
    await Promise.all([inboundWorker.close(), outboundWorker.close(), botResumeWorker.close()])
    await closeCrmRedis()
    process.exit(0)
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

bootstrap().catch((error) => {
  console.error('[crm-worker] falha ao iniciar:', error)
  process.exit(1)
})
