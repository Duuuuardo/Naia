// Identidade deste session-host. Hoje roda um único host ('base'); o registry
// no Redis já guarda hostId por conexão para suportar múltiplos hosts no futuro.
export type HostId = string

export function getHostId(): HostId {
  return process.env.CRM_SESSION_HOST_ID ?? 'base'
}
