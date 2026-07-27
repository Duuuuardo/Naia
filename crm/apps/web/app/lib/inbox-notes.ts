import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'

// Nota interna da conversa (não vai ao cliente). O tipo é o mesmo retornado
// por fetchConversation em inbox-session.ts.
export type ConversationNoteItem = { id: string; content: string; createdAt: string }

// Arquivo separado porque inbox-session.ts é mantido por outro fluxo — mesma
// convenção: token JWT do agente no cookie httpOnly 'crm_inbox_token'.
export const addConversationNote = createServerFn()
  .validator((data: { conversationId: string; content: string }) => data)
  .handler(async ({ data }): Promise<ConversationNoteItem | null> => {
    const token = getCookie('crm_inbox_token') ?? undefined
    const res = await apiClient(token)
      .inbox.conversations({ id: data.conversationId })
      .notes.post({ content: data.content })
    return ((res.data as { note?: ConversationNoteItem })?.note ?? null) as ConversationNoteItem | null
  })
