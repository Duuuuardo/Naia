import { createWorker, QUEUES } from '@naia/queue'
import type { PacerJob, SendMessageJob, StatusWebhookJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'
import { handleTelegramSend, markFailed as markTelegramFailed } from './handlers/telegram'
import { handleWhatsAppSend, markFailed as markWhatsAppFailed } from './handlers/whatsapp'
import { handleStatusWebhook } from './handlers/status-webhook'
import { handlePacerStep } from './handlers/pacer'
import { reconcileRunningCampaigns } from './recovery'
import { schedulerTick } from './scheduler'

const telegramWorker = createWorker<SendMessageJob>(
  QUEUES.TELEGRAM_OUTBOUND,
  async (job) => {
    console.log(`[telegram] job ${job.id} — campanha ${job.data.campaignId} → contato ${job.data.contactId}`)
    await handleTelegramSend(job.data)
  },
  { concurrency: 5 },
)

const whatsappWorker = createWorker<SendMessageJob>(
  QUEUES.WHATSAPP_OUTBOUND,
  async (job) => {
    console.log(`[whatsapp] job ${job.id} — campanha ${job.data.campaignId} → contato ${job.data.contactId}`)
    await handleWhatsAppSend(job.data)
  },
  { concurrency: 1 },
)

telegramWorker.on('failed', async (job, err) => {
  const cleanMsg = sanitizeErrorMessage(err, 'Job falhou ou excedeu limite de tempo ao processar mensagem do Telegram')
  console.error(`[telegram] job ${job?.id} falhou definitivamente:`, cleanMsg)
  // Follow-up de opt-out é melhor esforço — não marca mensagem como falha
  if (job?.data && job.data.kind !== 'followup') {
    try {
      await markTelegramFailed(job.data.campaignMessageId, job.data.campaignId, cleanMsg, job.data.runId)
    } catch (e) {
      console.error('[telegram] erro ao atualizar banco no failed state:', e)
    }
  }
})

whatsappWorker.on('failed', async (job, err) => {
  const cleanMsg = sanitizeErrorMessage(err, 'Job falhou ou excedeu limite de tempo ao processar mensagem do WhatsApp')
  console.error(`[whatsapp] job ${job?.id} falhou definitivamente:`, cleanMsg)
  // Follow-up de opt-out é melhor esforço — não marca mensagem como falha
  if (job?.data && job.data.kind !== 'followup') {
    try {
      await markWhatsAppFailed(job.data.campaignMessageId, job.data.campaignId, cleanMsg, job.data.runId)
    } catch (e) {
      console.error('[whatsapp] erro ao atualizar banco no failed state:', e)
    }
  }
})

const statusWebhookWorker = createWorker<StatusWebhookJob>(
  QUEUES.STATUS_WEBHOOK,
  async (job) => {
    console.log(`[status-webhook] message ${job.data.externalMessageId} → ${job.data.status}`)
    await handleStatusWebhook(job.data)
  },
  { concurrency: 20 },
)

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

console.log('naia-worker running')
console.log(`Queues: ${QUEUES.TELEGRAM_OUTBOUND}, ${QUEUES.WHATSAPP_OUTBOUND}, ${QUEUES.STATUS_WEBHOOK}, ${QUEUES.CAMPAIGN_PACER}`)

reconcileRunningCampaigns().catch((err) => console.error('[recovery] erro no startup recovery:', err))
const recoveryInterval = setInterval(() => {
  reconcileRunningCampaigns().catch((err) => console.error('[recovery] erro no recovery periodico:', err))
}, 60_000)

schedulerTick().catch((err) => console.error('[scheduler] erro no tick inicial:', err))
const schedulerInterval = setInterval(() => {
  schedulerTick().catch((err) => console.error('[scheduler] erro no tick periodico:', err))
}, 30_000)

process.on('SIGTERM', async () => {
  clearInterval(recoveryInterval)
  clearInterval(schedulerInterval)
  await Promise.all([
    telegramWorker.close(),
    whatsappWorker.close(),
    statusWebhookWorker.close(),
    pacerWorker.close(),
  ])
  process.exit(0)
})
