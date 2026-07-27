import { db } from '@crm/db'
import { conversations } from '@crm/db/schema'
import { eq } from 'drizzle-orm'
import type { Conversation } from '@crm/db/schema'

export type ConversationStatus = 'open' | 'assigned' | 'pending' | 'resolved'

// Transições permitidas (invariante 4 do crm-rules):
// open → assigned → pending → resolved; resolved → open (novo inbound).
// Também: assigned → open (desatribuir), pending → assigned/resolved.
const ALLOWED_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  open: ['assigned', 'resolved'],
  assigned: ['pending', 'resolved', 'open'],
  pending: ['assigned', 'resolved', 'open'],
  resolved: ['open'],
}

export class InvalidTransitionError extends Error {
  constructor(from: ConversationStatus, to: ConversationStatus) {
    super(`Transição de conversa inválida: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export const canTransition = (from: ConversationStatus, to: ConversationStatus): boolean => {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

// Atribui uma conversa a um agente: open/pending → assigned.
export const assignConversation = async (
  conversationId: string,
  agentId: string,
): Promise<Conversation> => {
  const [current] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  if (!current) throw new Error('Conversa não encontrada.')

  const next: ConversationStatus = 'assigned'
  if (!canTransition(current.status as ConversationStatus, next)) {
    throw new InvalidTransitionError(current.status as ConversationStatus, next)
  }

  const [updated] = await db
    .update(conversations)
    .set({ status: next, assignedAgentId: agentId, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  return updated
}

// Marca como pending (agente respondeu, aguardando cliente).
export const markPending = async (conversationId: string): Promise<Conversation> => {
  const [current] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  if (!current) throw new Error('Conversa não encontrada.')

  if (!canTransition(current.status as ConversationStatus, 'pending')) {
    throw new InvalidTransitionError(current.status as ConversationStatus, 'pending')
  }

  const [updated] = await db
    .update(conversations)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  return updated
}

// Resolve (encerra) o atendimento.
export const resolveConversation = async (conversationId: string): Promise<Conversation> => {
  const [current] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  if (!current) throw new Error('Conversa não encontrada.')

  if (!canTransition(current.status as ConversationStatus, 'resolved')) {
    throw new InvalidTransitionError(current.status as ConversationStatus, 'resolved')
  }

  const [updated] = await db
    .update(conversations)
    .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  return updated
}

// Reabre uma conversa resolvida (novo inbound no worker ou reabertura manual
// pela API). Desatribui o agente e limpa resolvedAt.
export const reopenConversation = async (conversationId: string): Promise<Conversation> => {
  const [current] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  if (!current) throw new Error('Conversa não encontrada.')

  if (!canTransition(current.status as ConversationStatus, 'open')) {
    throw new InvalidTransitionError(current.status as ConversationStatus, 'open')
  }

  const [updated] = await db
    .update(conversations)
    .set({ status: 'open', assignedAgentId: null, resolvedAt: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  return updated
}
