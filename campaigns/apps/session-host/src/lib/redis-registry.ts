import { getRedis } from '@naia/queue'
import type { HostId } from './host'

const REDIS_KEY_PREFIX = 'naia:session-host:'

export function getRegistryKey(connectionId: string): string {
  return `${REDIS_KEY_PREFIX}${connectionId}`
}

export async function registerConnection(connectionId: string, hostId: HostId): Promise<void> {
  const redis = getRedis()
  await redis.set(getRegistryKey(connectionId), hostId)
}

export async function unregisterConnection(connectionId: string): Promise<void> {
  const redis = getRedis()
  await redis.del(getRegistryKey(connectionId))
}

export async function resolveHostForConnection(connectionId: string): Promise<HostId | null> {
  const redis = getRedis()
  const value = await redis.get(getRegistryKey(connectionId))
  if (value === 'base' || value === 'scale') return value
  return null
}
