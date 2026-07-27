import type { MediaRef } from '@crm/schemas'
import type { OutboundButton } from '@crm/queue'

// Cliente HTTP do session-host do CRM. Comandos NÃO passam por fila: são HTTP
// interno autenticado com x-internal-secret, mesmo desenho do Campaigns.
// O session-host é o único processo que fala com WhatsApp/Telegram.

const DEFAULT_BASE_URL = 'http://localhost:4020'
const SEND_TIMEOUT_MS = 60_000

type SendSuccess = { success: true; externalMessageId: string }

type SendResponse =
  | { success: true; externalMessageId: string }
  | { success: false; error?: string }

function baseUrl(): string {
  return process.env.CRM_SESSION_HOST_URL ?? DEFAULT_BASE_URL
}

function internalSecret(): string {
  const secret = process.env.CRM_INTERNAL_SECRET
  if (!secret) {
    throw new Error('[crm-worker] CRM_INTERNAL_SECRET é obrigatória para falar com o session-host.')
  }
  return secret
}

async function postInternal(path: string, body: Record<string, unknown>): Promise<SendSuccess> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': internalSecret(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })

  const data = (await response.json().catch(() => null)) as SendResponse | null
  if (!response.ok || !data?.success) {
    const reason = data && !data.success && data.error ? data.error : `HTTP ${response.status}`
    throw new Error(`[crm-worker] session-host recusou o envio (${path}): ${reason}`)
  }

  return { success: true, externalMessageId: data.externalMessageId }
}

export function sendWhatsApp(params: {
  connectionId: string
  phone: string
  content: string
  media?: MediaRef[]
  buttons?: OutboundButton[]
}): Promise<SendSuccess> {
  return postInternal('/internal/whatsapp-send', {
    connectionId: params.connectionId,
    phone: params.phone,
    content: params.content,
    media: params.media,
    buttons: params.buttons,
  })
}

export function sendTelegram(params: {
  connectionId: string
  chatId: string
  content: string
  media?: MediaRef[]
  buttons?: OutboundButton[]
}): Promise<SendSuccess> {
  return postInternal('/internal/telegram-send', {
    connectionId: params.connectionId,
    chatId: params.chatId,
    content: params.content,
    media: params.media,
    buttons: params.buttons,
  })
}
