// Client HTTP do session-host do CRM (processo stateful que hospeda as sessões
// WhatsApp/Telegram). Comandos via HTTP interno autenticado por x-internal-secret;
// eventos (QR, connected/disconnected) voltam por Redis pub/sub → WS.
// Rotas espelham o session-host do Campaigns: /sessions/*.

const SESSION_HOST_URL = process.env.CRM_SESSION_HOST_URL ?? 'http://localhost:4020'
const INTERNAL_SECRET = process.env.CRM_INTERNAL_SECRET ?? ''

export type ConnectionChannel = 'whatsapp' | 'telegram'

export type SessionStatus = {
  socketStatus: 'connecting' | 'connected' | 'disconnected'
  qr: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SESSION_HOST_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`[session-host-client] ${init?.method ?? 'GET'} ${path} → ${response.status}`)
  }
  return (await response.json()) as T
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) })

// Inicia a sessão WhatsApp da conexão (gera QR — chega ao inbox via WS).
export const startWhatsApp = (connectionId: string): Promise<{ connectionId: string }> =>
  post(`/sessions/whatsapp/${connectionId}/start`)

// Inicia o polling do bot Telegram da conexão (token vem de connections.config).
export const startTelegram = (connectionId: string): Promise<{ connectionId: string }> =>
  post(`/sessions/telegram/${connectionId}/start`)

// Derruba a sessão atual e sobe de novo (WhatsApp: novo QR; Telegram: revalida token).
export const reconnect = (connectionId: string, channel: ConnectionChannel): Promise<{ message: string }> =>
  post(`/sessions/${connectionId}/reconnect`, { channel })

// Encerra a sessão da conexão. logout=true desvincula o aparelho (WhatsApp) —
// a próxima conexão exige QR novo.
export const disconnect = (
  connectionId: string,
  channel: ConnectionChannel,
  logout?: boolean,
): Promise<{ message: string }> => post(`/sessions/${connectionId}/disconnect`, { channel, logout })

// Status em tempo real da sessão (fallback de polling quando o WS não cobre).
export const getStatus = (connectionId: string): Promise<SessionStatus> =>
  request(`/sessions/${connectionId}/status`)
