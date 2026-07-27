import { Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq'
import IORedis from 'ioredis'
import type { ChannelMessage } from '@naia/channel-core'
import type { MediaRef } from '@crm/schemas'

export const CRM_QUEUE_PREFIX = 'crm:bull'

// Comandos ao session-host NÃO passam por fila: são HTTP interno com
// x-internal-secret, mesmo desenho do session-host do Campaigns.
export const CRM_QUEUES = {
  INBOUND_MESSAGES: 'inbound-messages-v1',
  OUTBOUND_MESSAGES: 'outbound-messages-v1',
  // Retomada agendada de sessões de bot (nó 'delay' vira job delayed aqui).
  BOT_RESUME: 'bot-resume-v1',
} as const

export type CrmQueueName = (typeof CRM_QUEUES)[keyof typeof CRM_QUEUES]

// ─── Payloads dos jobs ───────────────────────────────────────────────────────

// Publicado pelo session-host. 'message' = mensagem recebida do canal (mídia
// já subida para o storage, attachments preenchidos); 'status' = atualização
// de entrega/leitura de uma mensagem enviada.
export type InboundMessageJob =
  | {
      kind: 'message'
      workspaceId: string
      connectionId: string
      message: ChannelMessage
    }
  | {
      kind: 'status'
      workspaceId: string
      connectionId: string
      externalMessageId: string
      status: 'delivered' | 'read' | 'failed'
      timestamp: string
    }

// Botão de resposta rápida (nó 'buttons' do bot): no Telegram vira inline
// keyboard (callback_data = id); no WhatsApp degrada para lista numerada.
export type OutboundButton = { id: string; label: string }

// Publicado pela API ao enviar mensagem numa conversa. `target` é o
// identificador no canal (telefone/JID do WhatsApp, chat id do Telegram).
export type OutboundMessageJob = {
  workspaceId: string
  connectionId: string
  conversationId: string
  messageId: string
  target: string
  content: string
  media?: MediaRef[]
  buttons?: OutboundButton[]
}

// Publicado pelo bot engine ao encontrar um nó 'delay': o BullMQ entrega o
// job após o delay e o consumer do worker retoma o grafo no próximo nó.
export type BotResumeJob = {
  botSessionId: string
}

function requireRedisUrl(): string {
  // Em dev os dois produtos podem usar a mesma instância física. O isolamento
  // continua garantido pelo prefixo BullMQ e pelos canais Redis exclusivos do CRM.
  // Produção pode fornecer CRM_REDIS_URL para mover o CRM sem alterar Campaigns.
  const value = process.env.CRM_REDIS_URL ?? process.env.NAIA_REDIS_URL
  if (!value) {
    throw new Error('[@crm/queue] CRM_REDIS_URL ou NAIA_REDIS_URL é obrigatória.')
  }
  return value
}

let connection: IORedis | null = null

export function createCrmRedisConnection(connectionName: string): IORedis {
  return new IORedis(requireRedisUrl(), {
    maxRetriesPerRequest: null,
    connectionName,
  })
}

export function getCrmRedis(): IORedis {
  if (!connection) {
    connection = createCrmRedisConnection('naia-crm')
  }
  return connection
}

export function getCrmQueue<T = unknown>(name: CrmQueueName): Queue<T> {
  return new Queue<T>(name, {
    connection: getCrmRedis(),
    prefix: CRM_QUEUE_PREFIX,
  })
}

export function createCrmWorker<T = unknown>(
  name: CrmQueueName,
  processor: Processor<T>,
  options: Partial<WorkerOptions> = {},
): Worker<T> {
  return new Worker<T>(name, processor, {
    connection: getCrmRedis(),
    prefix: CRM_QUEUE_PREFIX,
    concurrency: 10,
    ...options,
  })
}

export const defaultCrmJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
}

export async function closeCrmRedis(): Promise<void> {
  if (!connection) return
  const current = connection
  connection = null
  await current.quit()
}

export { Queue, Worker }
export type { JobsOptions, Processor, WorkerOptions }
