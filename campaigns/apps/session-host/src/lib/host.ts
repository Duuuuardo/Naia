export type HostId = 'base' | 'scale'

export function getHostId(): HostId {
  const id = process.env.HOST_ID
  if (id === 'scale') return 'scale'
  return 'base'
}

export function connectionBelongsToHost(tier: string | null | undefined, hostId: HostId): boolean {
  if (hostId === 'scale') return tier === 'scale'
  return tier !== 'scale'
}
