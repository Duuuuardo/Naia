import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'

// Server fns da THREAD da conversa (paginação, leitura, reabrir/pendente) e do
// bloqueio de contato. Arquivo separado porque inbox-session.ts é mantido por
// outro fluxo — mesma convenção de inbox-notes.ts: token JWT do agente no
// cookie httpOnly 'crm_inbox_token'.

export type ThreadMessageAttachment = {
  storageKey: string
  mimeType: string
  kind: 'image' | 'video' | 'audio' | 'document'
  filename: string
}

export type ThreadMessageItem = {
  id: string
  direction: 'inbound' | 'outbound'
  content: string
  kind: string
  status: string
  sentAt: string
  // Atendimento (ciclo resolve→reopen) a que a mensagem pertence. Base dos
  // divisores da thread por atendimento.
  atendimentoSeq: number
  // Nome do agente autor em outbound manual; null em inbound e em mensagens de bot.
  agentName: string | null
  attachments?: ThreadMessageAttachment[]
}

export type ThreadTransferItem = {
  id: string
  note: string | null
  createdAt: string
  fromAgentId: string | null
  fromAgentName: string | null
  fromQueueId: string | null
  fromQueueName: string | null
  toAgentId: string | null
  toAgentName: string | null
  toQueueId: string | null
  toQueueName: string | null
  transferredByAgentId: string
  transferredByAgentName: string | null
}

// Avaliação CSAT da conversa (uma por conversa). agentName = agente que
// estava atribuído na resolução (null = sem dono/bot).
export type ThreadRatingItem = {
  id: string
  score: number
  comment: string | null
  createdAt: string
  atendimentoSeq: number
  agentId: string | null
  agentName: string | null
}

export type ThreadContactInfo = {
  name: string
  avatarUrl: string | null
  blocked: boolean
  blockedAt: string | null
}

export type ConversationPage = {
  conversation: {
    id: string
    status: string
    contactId: string
    title: string | null
    protocol: number
    atendimentoSeq: number
  } | null
  contact: ThreadContactInfo | null
  messages: ThreadMessageItem[]
  hasMore: boolean
  nextCursor: string | null
  notes: { id: string; content: string; createdAt: string }[]
  transfers: ThreadTransferItem[]
  ratings: ThreadRatingItem[]
  activeBotFlow: { id: string; name: string } | null
}

function inboxToken(): string | undefined {
  return getCookie('crm_inbox_token') ?? undefined
}

// GET /inbox/conversations/:id com paginação da thread: limit=50 retorna a
// página mais recente (ordem cronológica); before=<nextCursor> pagina para
// trás. hasMore/nextCursor vêm da API.
export const fetchConversationPage = createServerFn()
  .validator((data: { conversationId: string; limit?: number; before?: string }) => data)
  .handler(async ({ data }): Promise<ConversationPage> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .get({ query: { limit: data.limit, before: data.before } })
    const body = res.data as {
      conversation?: ConversationPage['conversation']
      contact?: ThreadContactInfo
      messages?: ThreadMessageItem[]
      hasMore?: boolean
      nextCursor?: string | null
      notes?: { id: string; content: string; createdAt: string }[]
      transfers?: ThreadTransferItem[]
      ratings?: ThreadRatingItem[]
      activeBotFlow?: { id: string; name: string } | null
    } | null
    return {
      conversation: body?.conversation ?? null,
      contact: body?.contact ?? null,
      messages: (body?.messages ?? []) as ThreadMessageItem[],
      hasMore: body?.hasMore ?? false,
      nextCursor: body?.nextCursor ?? null,
      notes: body?.notes ?? [],
      transfers: (body?.transfers ?? []) as ThreadTransferItem[],
      ratings: (body?.ratings ?? []) as ThreadRatingItem[],
      activeBotFlow: body?.activeBotFlow ?? null,
    }
  })

// Marca a conversa como lida pelo agente (idempotente, sem broadcast WS).
export const markConversationRead = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .read.post()
      .catch(() => null)
    return { ok: true }
  })

// Resultado de ação com possível 409 (transição de estado inválida).
export type ThreadActionResult = { ok: boolean; message: string | null }

function errorMessage(error: { status?: number | string; value?: unknown } | null): string | null {
  if (!error) return null
  const value = error.value as { message?: string } | null
  return value?.message ?? 'Não foi possível concluir a ação.'
}

// Reabre conversa resolvida (409 se a transição for inválida).
export const reopenConversation = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<ThreadActionResult> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .reopen.post()
    if (res.error) return { ok: false, message: errorMessage(res.error) }
    return { ok: true, message: null }
  })

// Marca a conversa como pendente (409 se a transição for inválida).
export const markConversationPending = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<ThreadActionResult> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .pending.post()
    if (res.error) return { ok: false, message: errorMessage(res.error) }
    return { ok: true, message: null }
  })

// Envia mensagem capturando o 409 de contato bloqueado (a thread precisa do
// motivo para dar feedback — sendMessage de inbox-session ignora erros).
export const sendThreadMessage = createServerFn()  .validator((data: { conversationId: string; content: string; attachmentFileIds?: string[] }) => data)
  .handler(async ({ data }): Promise<ThreadActionResult> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .messages.post({ content: data.content, attachmentFileIds: data.attachmentFileIds })
    if (res.error) return { ok: false, message: errorMessage(res.error) }
    return { ok: true, message: null }
  })

// Interrompe o bot que está atendendo a conversa (takeover humano).
// 404/409 quando não há bot ativo — a thread mostra o motivo.
export const stopConversationBot = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<ThreadActionResult> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .bot.stop.post()
    if (res.error) {
      const status = Number(res.error.status)
      if (status === 404 || status === 409) {
        return { ok: false, message: 'Não há bot atendendo esta conversa.' }
      }
      return { ok: false, message: errorMessage(res.error) }
    }
    return { ok: true, message: null }
  })

// Envia o número do protocolo ao contato pelo canal (mensagem automática).
export const sendConversationProtocol = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<ThreadActionResult> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })['send-protocol'].post()
    if (res.error) return { ok: false, message: errorMessage(res.error) }
    return { ok: true, message: null }
  })

// Reenvia a pesquisa CSAT ao contato (conversa resolvida, CSAT habilitado,
// ainda sem nota). 409 traz o motivo para a thread exibir.
export const resendCsatSurvey = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<ThreadActionResult> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .csat.send.post()
    if (res.error) return { ok: false, message: errorMessage(res.error) }
    return { ok: true, message: null }
  })

export type ContactBlockState = { blocked: boolean; blockedAt: string | null }

// Estado de bloqueio do contato (GET /inbox/contacts/:id retorna a linha
// completa; aqui só extraímos blocked/blockedAt).
export const fetchContactBlockState = createServerFn()
  .validator((data: { contactId: string }) => data)
  .handler(async ({ data }): Promise<ContactBlockState> => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).get()
    const contact = (res.data as { contact?: ContactBlockState } | null)?.contact
    return { blocked: contact?.blocked ?? false, blockedAt: contact?.blockedAt ?? null }
  })

// Bloqueia: inbound do contato passa a ser descartado e outbound retorna 409.
export const blockContact = createServerFn()
  .validator((data: { contactId: string }) => data)
  .handler(async ({ data }): Promise<ContactBlockState & { ok: boolean }> => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).block.post()
    const contact = (res.data as { contact?: ContactBlockState } | null)?.contact
    return { ok: !res.error, blocked: contact?.blocked ?? true, blockedAt: contact?.blockedAt ?? null }
  })

export const unblockContact = createServerFn()
  .validator((data: { contactId: string }) => data)
  .handler(async ({ data }): Promise<ContactBlockState & { ok: boolean }> => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).unblock.post()
    const contact = (res.data as { contact?: ContactBlockState } | null)?.contact
    return { ok: !res.error, blocked: contact?.blocked ?? false, blockedAt: contact?.blockedAt ?? null }
  })
