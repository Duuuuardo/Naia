import { useEffect, useRef } from 'react'
import { getInboxToken } from './inbox-session'
import { API_URL } from './api'

export type InboxEvent =
  | { type: 'connected'; workspaceId: string }
  | { type: 'conversation:new'; conversation: unknown }
  | { type: 'message:new'; conversationId: string; message: unknown }
  | { type: 'conversation:assigned'; conversationId: string; agentId: string }
  | { type: 'conversation:resolved'; conversationId: string }
  | { type: 'conversation:reopened'; conversationId: string }
  | { type: 'conversation:pending'; conversationId: string }
  | { type: 'conversation:transferred'; conversationId: string; transfer: unknown }
  | { type: 'connection:status'; connectionId: string; status: string }
  | { type: 'deal:new'; deal: unknown }
  | { type: 'deal:moved'; deal: unknown }
  | { type: 'deal:updated'; deal: unknown }
  | { type: 'pipeline:updated'; pipelineId: string }
  | { type: 'quickreply:updated' }
  // Badge "Chatbot atendendo": active=true quando um flow assume a conversa.
  | { type: 'bot:status'; conversationId: string; active: boolean; flowName?: string }
  // Takeover: um agente interrompeu o bot que atendia a conversa.
  | { type: 'bot:stopped'; conversationId: string }
  | { type: 'message:status'; conversationId: string; messageId: string; status: string }
  | { type: 'internal:message:new'; chatId: string; message: unknown }
  // QR do WhatsApp em tempo real (tela de conexões do superadmin).
  | { type: 'session:qr'; connectionId: string; qr: string }

// Conecta ao WS do inbox e chama onEvent a cada evento. Reconecta em caso de
// queda (backoff simples). O token vem do cookie httpOnly via server fn.
export function useInboxSocket(onEvent: (event: InboxEvent) => void) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      const token = await getInboxToken()
      if (!token || closed) return

      const wsUrl = API_URL.replace(/^http/, 'ws') + `/inbox/ws?token=${encodeURIComponent(token)}`
      ws = new WebSocket(wsUrl)

      ws.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data) as InboxEvent)
        } catch {
          /* ignore malformed */
        }
      }
      ws.onopen = () => {
        retry = 0
      }
      ws.onclose = () => {
        if (closed) return
        // Backoff: 1s, 2s, 4s… até 15s.
        retry += 1
        const delay = Math.min(1000 * 2 ** (retry - 1), 15000)
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])
}
