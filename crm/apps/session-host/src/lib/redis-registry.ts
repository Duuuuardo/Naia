import { getCrmRedis } from '@crm/queue'
import type { HostId } from './host'

const REDIS_KEY_PREFIX = 'crm:session-host:'

export function getRegistryKey(connectionId: string): string {
  return `${REDIS_KEY_PREFIX}${connectionId}`
}

export async function registerConnection(connectionId: string, hostId: HostId): Promise<void> {
  await getCrmRedis().set(getRegistryKey(connectionId), hostId)
}

export async function unregisterConnection(connectionId: string): Promise<void> {
  await getCrmRedis().del(getRegistryKey(connectionId))
}

export async function resolveHostForConnection(connectionId: string): Promise<HostId | null> {
  return getCrmRedis().get(getRegistryKey(connectionId))
}
