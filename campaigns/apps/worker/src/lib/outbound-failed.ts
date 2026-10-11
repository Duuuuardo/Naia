
import type { SendMessageJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'
import { markFailed as markWhatsAppFailed } from '../handlers/whatsapp'
import { markFailed as markTelegramFailed } from '../handlers/telegram'

export type FailedJobLike = {
  id?: string
  data?: SendMessageJob
  attemptsMade: number
  opts: { attempts?: number }
}

export function createOutboundFailedHandler(queueName: string, channel: 'whatsapp' | 'telegram') {
  const markFailed = channel === 'whatsapp' ? markWhatsAppFailed : markTelegramFailed
  const label = channel === 'whatsapp' ? 'mensagem do WhatsApp' : 'mensagem do Telegram'

  return async (job: FailedJobLike | undefined, err: Error): Promise<void> => {
    const cleanMsg = sanitizeErrorMessage(err, `Job falhou ou excedeu limite de tempo ao processar ${label}`)
    const attempts = job?.opts.attempts ?? 1
    if (job && job.attemptsMade < attempts) {
      console.warn(`[${channel}:${queueName}] job ${job.id} falhou (tentativa ${job.attemptsMade}/${attempts}) — retentando:`, cleanMsg)
      return
    }
    console.error(`[${channel}:${queueName}] job ${job?.id} falhou definitivamente:`, cleanMsg)
    if (job?.data && job.data.kind !== 'followup') {
      try {
        await markFailed(job.data.campaignMessageId, job.data.campaignId, cleanMsg, job.data.runId)
      } catch (e) {
        console.error(`[${channel}:${queueName}] erro ao atualizar banco no failed state:`, e)
      }
    }
  }
}
