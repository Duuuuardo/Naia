import { Queue, Worker, type Processor, type WorkerOptions, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[@naia/queue] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

export const QUEUES = {
  TELEGRAM_OUTBOUND_BASE: 'telegram-outbound-base',
  WHATSAPP_OUTBOUND_BASE: 'whatsapp-outbound-base',
  STATUS_WEBHOOK: 'status-webhook',
  CAMPAIGN_PACER: 'campaign-pacer',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export function isScaleTier(tier: string | null | undefined): boolean {
  return tier === 'scale'
}

export function getOutboundQueueName(
  channel: 'whatsapp' | 'telegram',
  workspaceId: string,
  tier: string | null | undefined,
): string {
  if (isScaleTier(tier)) {
    return `${channel}-outbound-${workspaceId}`
  }
  return channel === 'whatsapp' ? QUEUES.WHATSAPP_OUTBOUND_BASE : QUEUES.TELEGRAM_OUTBOUND_BASE
}

let connection: IORedis | null = null

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(requireEnv('NAIA_REDIS_URL'), {
      maxRetriesPerRequest: null,
    })
  }
  return connection
}

export function getQueue<T = unknown>(name: QueueName | string): Queue<T> {
  return new Queue<T>(name, { connection: getRedis() })
}

export function createWorker<T = unknown>(
  name: QueueName | string,
  processor: Processor<T>,
  options?: Partial<WorkerOptions>,
): Worker<T> {
  return new Worker<T>(name, processor, {
    connection: getRedis(),
    concurrency: 10,
    ...options,
  })
}

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

export async function getActiveScaleOutboundQueues(): Promise<string[]> {
  const redis = getRedis()
  const keys = await redis.keys('bull:whatsapp-outbound-*:meta')
  const tgKeys = await redis.keys('bull:telegram-outbound-*:meta')
  const all = [...keys, ...tgKeys]
  return all
    .filter((k) => k.endsWith(':meta'))
    .map((k) => k.replace(/^bull:/, '').replace(/:meta$/, ''))
    .filter((name) => !name.includes(':') && name !== 'whatsapp-outbound-base' && name !== 'telegram-outbound-base')
}

export { Queue, Worker }
export type { Processor, WorkerOptions, JobsOptions }
