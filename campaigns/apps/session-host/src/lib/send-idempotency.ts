
import { getRedis } from '@naia/queue'

const PENDING = '__pending__'
const PERMANENT_ERROR_PREFIX = 'err:'
const PENDING_TTL_S = 120
const RESULT_TTL_S = 24 * 60 * 60

export type SendClaim =
  | { kind: 'claimed' }
  | { kind: 'hit'; externalMessageId: string }
  | { kind: 'inflight' }
  | { kind: 'failed'; error: string }

function keyFor(idempotencyKey: string): string {
  return `naia:send-idem:${idempotencyKey}`
}

export async function claimSend(idempotencyKey: string): Promise<SendClaim> {
  const redis = getRedis()
  const claimed = await redis.set(keyFor(idempotencyKey), PENDING, 'EX', PENDING_TTL_S, 'NX')
  if (claimed === 'OK') return { kind: 'claimed' }

  const stored = await redis.get(keyFor(idempotencyKey))
  if (stored === null || stored === PENDING) return { kind: 'inflight' }
  if (stored.startsWith(PERMANENT_ERROR_PREFIX)) {
    return { kind: 'failed', error: stored.slice(PERMANENT_ERROR_PREFIX.length) }
  }
  return { kind: 'hit', externalMessageId: stored }
}

export async function recordSendResult(idempotencyKey: string, externalMessageId: string): Promise<void> {
  await getRedis().set(keyFor(idempotencyKey), externalMessageId || 'sent', 'EX', RESULT_TTL_S)
}

export async function recordPermanentFailure(idempotencyKey: string, error: string): Promise<void> {
  await getRedis().set(keyFor(idempotencyKey), `${PERMANENT_ERROR_PREFIX}${error.slice(0, 200)}`, 'EX', RESULT_TTL_S)
}

export async function releaseSendClaim(idempotencyKey: string): Promise<void> {
  await getRedis().del(keyFor(idempotencyKey))
}
