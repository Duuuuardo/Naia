import { presignDownload } from '@crm/storage'

// Avatar efetivo do contato exposto ao frontend: o avatarUrl definido
// manualmente pelo agente tem precedência; na ausência dele, servimos a foto
// puxada do canal (WhatsApp/Telegram) a partir do storageKey no MinIO via URL
// pré-assinada. presignDownload é uma assinatura local (HMAC), sem I/O — barato
// o suficiente para resolver a lista inteira de conversas/contatos.
export function resolveContactAvatarUrl(row: {
  avatarUrl: string | null
  avatarStorageKey: string | null
}): string | null {
  const manual = row.avatarUrl?.trim()
  if (manual) return manual
  return row.avatarStorageKey ? presignDownload(row.avatarStorageKey) : null
}
