import { createWorker, QUEUES, getActiveScaleOutboundQueues, type Worker } from '@naia/queue'
import type { PacerJob, SendMessageJob, StatusWebhookJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'
import { handleTelegramSend } from './handlers/telegram'
import { handleWhatsAppSend } from './handlers/whatsapp'
import { handleStatusWebhook } from './handlers/status-webhook'
import { createOutboundFailedHandler } from './lib/outbound-failed'
import { handlePacerStep } from './handlers/pacer'
import { reconcileRunningCampaigns } from './recovery'
import { schedulerTick } from './scheduler'
import { loadProductConfig } from './lib/config'

function createTelegramWorker(name: string): Worker<SendMessageJob> {
  const worker = createWorker<SendMessageJob>(
    name,
    async (job) => {
      console.log(`[telegram:${name}] job ${job.id} — campanha ${job.data.campaignId} → contato ${job.data.contactId}`)
      await handleTelegramSend(job.data)
    },
    { concurrency: 5 },
  )
  worker.on('failed', createOutboundFailedHandler(name, 'telegram'))
  return worker
}

function createWhatsAppWorker(name: string): Worker<SendMessageJob> {
  const worker = createWorker<SendMessageJob>(
    name,
    async (job) => {
      console.log(`[whatsapp:${name}] job ${job.id} — campanha ${job.data.campaignId} → contato ${job.data.contactId}`)
      await handleWhatsAppSend(job.data)
    },
    { concurrency: 1 },
  )
  worker.on('failed', createOutboundFailedHandler(name, 'whatsapp'))
  return worker
}

async function bootstrap() {
  await loadProductConfig()

  const baseTelegramWorker = createTelegramWorker(QUEUES.TELEGRAM_OUTBOUND_BASE)
  const baseWhatsAppWorker = createWhatsAppWorker(QUEUES.WHATSAPP_OUTBOUND_BASE)

  const statusWebhookWorker = createWorker<StatusWebhookJob>(
    QUEUES.STATUS_WEBHOOK,
    async (job) => {
      console.log(`[status-webhook] message ${job.data.externalMessageId} → ${job.data.status}`)
      await handleStatusWebhook(job.data)
    },
    { concurrency: 20 },
  )
  statusWebhookWorker.on('failed', (job, err) => {
    console.error(`[status-webhook] job ${job?.id} falhou (tentativa ${job?.attemptsMade}/${job?.opts?.attempts ?? '?'}):`, sanitizeErrorMessage(err, 'erro no webhook de status'))
  })

  const pacerWorker = createWorker<PacerJob>(
    QUEUES.CAMPAIGN_PACER,
    async (job) => {
      await handlePacerStep(job.data)
    },
    { concurrency: 10 },
  )

  pacerWorker.on('failed', (job, err) => {
    console.error(`[pacer] passo do run ${job?.data?.runId} falhou:`, sanitizeErrorMessage(err, 'erro no pacer'))
  })

  const scaleWorkers = new Map<string, Worker<SendMessageJob>>()

  async function syncScaleWorkers(): Promise<void> {
    try {
      const activeQueues = await getActiveScaleOutboundQueues()
      const desired = new Set(activeQueues)

      for (const [name, worker] of scaleWorkers) {
        if (!desired.has(name)) {
          console.log(`[worker] removendo worker scale ${name}`)
          await worker.close()
          scaleWorkers.delete(name)
        }
      }

      for (const name of desired) {
        if (scaleWorkers.has(name)) continue
        console.log(`[worker] criando worker scale ${name}`)
        const worker = name.startsWith('telegram')
          ? createTelegramWorker(name)
          : createWhatsAppWorker(name)
        scaleWorkers.set(name, worker)
      }
    } catch (err) {
      console.error('[worker] erro ao sincronizar workers scale:', err)
    }
  }

  console.log('naia-worker running')
  console.log(`Base queues: ${QUEUES.TELEGRAM_OUTBOUND_BASE}, ${QUEUES.WHATSAPP_OUTBOUND_BASE}, ${QUEUES.STATUS_WEBHOOK}, ${QUEUES.CAMPAIGN_PACER}`)

  reconcileRunningCampaigns().catch((err) => console.error('[recovery] erro no startup recovery:', err))
  const recoveryInterval = setInterval(() => {
    reconcileRunningCampaigns().catch((err) => console.error('[recovery] erro no recovery periodico:', err))
  }, 60_000)

  schedulerTick().catch((err) => console.error('[scheduler] erro no tick inicial:', err))
  const schedulerInterval = setInterval(() => {
    schedulerTick().catch((err) => console.error('[scheduler] erro no tick periodico:', err))
  }, 30_000)

  syncScaleWorkers().catch((err) => console.error('[worker] erro na sincronização inicial de workers scale:', err))
  const scaleDiscoveryInterval = setInterval(() => {
    syncScaleWorkers().catch((err) => console.error('[worker] erro na sincronização de workers scale:', err))
  }, 30_000)

  process.on('SIGTERM', async () => {
    clearInterval(recoveryInterval)
    clearInterval(schedulerInterval)
    clearInterval(scaleDiscoveryInterval)
    await Promise.all([
      baseTelegramWorker.close(),
      baseWhatsAppWorker.close(),
      statusWebhookWorker.close(),
      pacerWorker.close(),
      ...Array.from(scaleWorkers.values()).map((w) => w.close()),
    ])
    process.exit(0)
  })
}

bootstrap().catch((err) => {
  console.error('[naia-worker] erro ao iniciar:', err)
  process.exit(1)
})
