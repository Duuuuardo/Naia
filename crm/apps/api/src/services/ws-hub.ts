// Hub WebSocket do inbox: mantém as conexões abertas por workspace e faz
// broadcast de eventos de tempo real. No M3 é in-memory (single instance);
// quando o worker escalar para múltiplas instâncias, trocar o broadcast por
// Redis pub/sub (worker publica → cada api instance reenvia aos seus WS).

export type InboxEvent =
  | { type: 'conversation:new'; conversation: unknown }
  | { type: 'message:new'; conversationId: string; message: unknown }
  | { type: 'conversation:assigned'; conversationId: string; agentId: string }
  | { type: 'conversation:resolved'; conversationId: string }
  | { type: 'conversation:reopened'; conversationId: string }
  | { type: 'conversation:pending'; conversationId: string }
  | { type: 'conversation:transferred'; conversationId: string; transfer: unknown }
  // Avaliação CSAT do cliente (nota registrada) → nota aparece na thread.
  | { type: 'conversation:rated'; conversationId: string; rating: unknown }
  | { type: 'connection:status'; connectionId: string; status: string }
  | { type: 'deal:new'; deal: unknown }
  | { type: 'deal:moved'; deal: unknown }
  | { type: 'deal:updated'; deal: unknown }
  | { type: 'pipeline:updated'; pipelineId: string }
  | { type: 'quickreply:updated' }
  // Badge "Chatbot atendendo": active=true quando um flow assume a conversa.
  | { type: 'bot:status'; conversationId: string; active: boolean; flowName?: string }
  // Takeover manual: um agente interrompeu o bot na conversa
  // (POST /inbox/conversations/:id/bot/stop).
  | { type: 'bot:stopped'; conversationId: string; flowId: string }
  | { type: 'message:status'; conversationId: string; messageId: string; status: string }
  | { type: 'internal:message:new'; chatId: string; message: unknown }
  // QR do WhatsApp em tempo real (tela de conexões do superadmin).
  | { type: 'session:qr'; connectionId: string; qr: string }

interface WsClient {
  agentId: string
  workspaceId: string
  send: (data: string) => void
}

// workspaceId → set de clientes conectados
const rooms = new Map<string, Set<WsClient>>()

function sendToClient(client: WsClient, payload: string): void {
  try {
    client.send(payload)
  } catch {
    // conexão morta — será limpa no close
  }
}

export const wsHub = {
  join(client: WsClient): void {
    let room = rooms.get(client.workspaceId)
    if (!room) {
      room = new Set()
      rooms.set(client.workspaceId, room)
    }
    room.add(client)
  },

  leave(client: WsClient): void {
    const room = rooms.get(client.workspaceId)
    if (!room) return
    room.delete(client)
    if (room.size === 0) rooms.delete(client.workspaceId)
  },

  // Broadcast de um evento para todos os agentes conectados de um workspace.
  broadcast(workspaceId: string, event: InboxEvent): void {
    const room = rooms.get(workspaceId)
    if (!room) return
    const payload = JSON.stringify(event)
    for (const client of room) {
      sendToClient(client, payload)
    }
  },

  // Broadcast direcionado: só agentes específicos do workspace recebem
  // (ex.: mensagem de chat interno vai só para os membros do chat).
  broadcastToAgents(workspaceId: string, agentIds: string[], event: InboxEvent): void {
    const room = rooms.get(workspaceId)
    if (!room) return
    const targets = new Set(agentIds)
    const payload = JSON.stringify(event)
    for (const client of room) {
      if (targets.has(client.agentId)) sendToClient(client, payload)
    }
  },

  countConnected(workspaceId: string): number {
    return rooms.get(workspaceId)?.size ?? 0
  },
}

export type { WsClient }
