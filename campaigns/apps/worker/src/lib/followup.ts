// Aviso de opt-out como mensagem separada, enviada alguns segundos depois da
// mensagem da campanha. Job próprio (attempts 1, erro engolido) para nunca
// interferir no job primário; sem linha em campaign_messages → fora da cota.

import type { Queue } from '@naia/queue'
import type { SendMessageJob } from '@naia/schemas'

export const OPTOUT_FOLLOWUP_WHATSAPP = '_Para não receber mais mensagens, responda *#SAIR*_'
export const OPTOUT_FOLLOWUP_TELEGRAM = '<i>Para não receber mais mensagens, responda <b>#SAIR</b></i>'

export async function enqueueOptOutFollowup(
  queue: Queue<SendMessageJob>,
  job: SendMessageJob,
  content: string,
): Promise<void> {
  await queue
    .add(
      `followup:${job.campaignMessageId}`,
      { ...job, kind: 'followup', content },
      {
        // BullMQ 5 não aceita ':' em jobId customizado
        jobId: `followup-${job.campaignMessageId}`,
        delay: 3000 + Math.floor(Math.random() * 3000),
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    )
    .catch((err) => {
      console.warn(`[followup] falha ao enfileirar aviso de opt-out (ignorado): ${err}`)
    })
}
