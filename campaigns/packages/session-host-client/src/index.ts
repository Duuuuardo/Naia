import { getRedis } from '@naia/queue'
import type { MediaRef } from '@naia/schemas'

const REDIS_KEY_PREFIX = 'naia:session-host:'

type HostId = 'base' | 'scale'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[@naia/session-host-client] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

export async function resolveHostForConnection(connectionId: string): Promise<HostId | null> {
  const redis = getRedis()
  const value = await redis.get(`${REDIS_KEY_PREFIX}${connectionId}`)
  if (value === 'base' || value === 'scale') return value
  return null
}

export function getSessionHostUrl(hostId: HostId): string {
  if (hostId === 'scale') {
    return requireEnv('SESSION_HOST_SCALE_URL')
  }
  return requireEnv('SESSION_HOST_BASE_URL')
}

export async function resolveSessionHostUrl(connectionId: string): Promise<string> {
  const hostId = await resolveHostForConnection(connectionId)
  return getSessionHostUrl(hostId ?? 'base')
}

function getSecret(): string {
  return requireEnv('NAIA_INTERNAL_SECRET')
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': getSecret(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Session host retornou ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-internal-secret': getSecret(),
    },
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Session host retornou ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

export async function startWhatsAppSession(connectionId: string, hostId?: HostId): Promise<void> {
  const url = getSessionHostUrl(hostId ?? 'base')
  await post(`${url}/sessions/whatsapp/${connectionId}/start`, {})
}

export async function startTelegramUserLogin(connectionId: string, hostId?: HostId): Promise<void> {
  const url = getSessionHostUrl(hostId ?? 'base')
  await post(`${url}/sessions/telegram/${connectionId}/start`, {})
}

export async function submitTelegramCode(connectionId: string, code: string): Promise<void> {
  const url = await resolveSessionHostUrl(connectionId)
  await post(`${url}/sessions/${connectionId}/telegram-code`, { code })
}

export async function submitTelegramPassword(connectionId: string, password: string): Promise<void> {
  const url = await resolveSessionHostUrl(connectionId)
  await post(`${url}/sessions/${connectionId}/telegram-password`, { password })
}

export async function reconnectSession(
  connectionId: string,
  body: { channel: 'whatsapp' | 'telegram' },
): Promise<void> {
  const url = await resolveSessionHostUrl(connectionId)
  await post(`${url}/sessions/${connectionId}/reconnect`, body)
}

export async function disconnectSession(
  connectionId: string,
  body: { channel: 'whatsapp' | 'telegram'; logout?: boolean },
): Promise<void> {
  const url = await resolveSessionHostUrl(connectionId)
  await post(`${url}/sessions/${connectionId}/disconnect`, body)
}

export type SessionStatus = {
  socketStatus: 'connecting' | 'connected' | 'disconnected'
  qr: string | null
  telegramAuth: { phase: string; error: string | null } | null
}

export async function getSessionStatus(connectionId: string): Promise<SessionStatus> {
  const url = await resolveSessionHostUrl(connectionId)
  return get<SessionStatus>(`${url}/sessions/${connectionId}/status`)
}

export type WhatsAppContact = { id: string; name: string; phone: string; avatarUrl?: string | null }
export type TelegramContact = { id: string; name: string; phone: string; avatarUrl?: string | null }

export async function fetchWhatsAppContacts(connectionId: string): Promise<WhatsAppContact[]> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await get<{ contacts: WhatsAppContact[] }>(`${url}/sessions/${connectionId}/contacts`)
  return res.contacts
}

export async function fetchTelegramUserContacts(connectionId: string): Promise<TelegramContact[]> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await get<{ contacts: TelegramContact[] }>(`${url}/sessions/${connectionId}/contacts`)
  return res.contacts
}

export type WhatsAppGroup = {
  id: string
  subject: string
  size: number
  desc?: string
  participants: Array<{ id: string; admin?: string | null; phoneNumber?: string | null }>
}
export type TelegramGroup = { id: string; subject: string; size: number; desc?: string; participants: Array<{ id: string; admin?: string | null }> }

export async function fetchWhatsAppGroups(connectionId: string): Promise<WhatsAppGroup[]> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await get<{ groups: WhatsAppGroup[] }>(`${url}/sessions/${connectionId}/groups`)
  return res.groups
}

export async function fetchTelegramUserGroups(connectionId: string): Promise<TelegramGroup[]> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await get<{ groups: TelegramGroup[] }>(`${url}/sessions/${connectionId}/groups`)
  return res.groups
}

export type GroupParticipant = {
  id: string
  admin?: string | null
  phoneNumber?: string | null
  name?: string | null
  avatarUrl?: string | null
}

export async function getGroupParticipants(connectionId: string, groupJid: string): Promise<GroupParticipant[]> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await post<{ participants: GroupParticipant[] }>(`${url}/sessions/${connectionId}/group-participants`, {
    groupJid,
  })
  return res.participants
}

export async function importTelegramGroupMembers(
  connectionId: string,
  workspaceId: string,
  groupId: string,
  tags: string[],
): Promise<{ importedMembersCount: number }> {
  const url = await resolveSessionHostUrl(connectionId)
  return post<{ importedMembersCount: number }>(`${url}/sessions/${connectionId}/import-group-members`, {
    workspaceId,
    groupId,
    tags,
  })
}



export async function enrichWhatsAppContact(
  connectionId: string,
  phoneOrJid: string,
  existingName?: string | null,
): Promise<{ name: string; avatarUrl: string | null; phone: string }> {
  const url = await resolveSessionHostUrl(connectionId)
  return post<{ name: string; avatarUrl: string | null; phone: string }>(
    `${url}/sessions/${connectionId}/enrich-contact`,
    { phoneOrJid, existingName },
  )
}

export async function resolveWhatsAppContactName(
  connectionId: string,
  phoneOrJid: string,
  fallbackCandidate?: string | null,
): Promise<string> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await post<{ name: string }>(`${url}/sessions/${connectionId}/resolve-contact-name`, {
    phoneOrJid,
    fallbackCandidate,
  })
  return res.name
}

export async function batchEnrichWhatsAppContacts(
  connectionId: string,
  items: Array<{ id: string; name?: string | null; avatarUrl?: string | null }>,
): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await post<{ entries: Array<{ id: string; name: string; avatarUrl: string | null }> }>(
    `${url}/sessions/${connectionId}/enrich-contacts-batch`,
    { items },
  )
  return new Map(res.entries.map((e) => [e.id, { name: e.name, avatarUrl: e.avatarUrl }]))
}

export async function sendWhatsAppMessage(
  connectionId: string,
  phone: string,
  content: string,
  media?: MediaRef[],
): Promise<{ externalMessageId: string }> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await post<{ success: boolean; externalMessageId?: string; error?: string }>(
    `${url}/internal/whatsapp-send`,
    { connectionId, phone, content, media },
  )
  if (!res.success) throw new Error(res.error ?? 'Falha ao enviar mensagem via WhatsApp.')
  return { externalMessageId: res.externalMessageId ?? '' }
}

export async function sendTelegramUserMessage(
  connectionId: string,
  target: string,
  content: string,
  media?: MediaRef[],
): Promise<{ externalMessageId: string }> {
  const url = await resolveSessionHostUrl(connectionId)
  const res = await post<{ success: boolean; externalMessageId?: string; error?: string }>(
    `${url}/internal/telegram-user-send`,
    { connectionId, target, content, media },
  )
  if (!res.success) throw new Error(res.error ?? 'Falha ao enviar mensagem via Telegram.')
  return { externalMessageId: res.externalMessageId ?? '' }
}
