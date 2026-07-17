import { Queue, Worker, type Processor, type WorkerOptions, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'

export const QUEUES = {
  TELEGRAM_OUTBOUND: 'telegram-outbound',
  WHATSAPP_OUTBOUND: 'whatsapp-outbound',
  STATUS_WEBHOOK: 'status-webhook',
  CAMPAIGN_PACER: 'campaign-pacer',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

let connection: IORedis | null = null

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.NAIA_REDIS_URL ?? 'redis://localhost:6381', {
      maxRetriesPerRequest: null,
    })
  }
  return connection
}

export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  return new Queue<T>(name, { connection: getRedis() })
}

export function createWorker<T = unknown>(
  name: QueueName,
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

export { Queue, Worker }
export type { Processor, WorkerOptions, JobsOptions }
