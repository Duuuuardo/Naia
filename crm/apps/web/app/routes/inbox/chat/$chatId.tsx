import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ListTree, Send as SendIcon, Users, UsersRound } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, getInitials } from '../../../components/ui'
import {
  fetchInternalChatMessages,
  fetchInternalChats,
  getInboxAgent,
  markInternalChatRead,
  sendInternalChatMessage,
  type InternalChatItem,
  type InternalChatMessageItem,
} from '../../../lib/inbox-session'
import { useInboxSocket } from '../../../lib/use-inbox-socket'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/chat/$chatId')({
  head: () => createHeadConfig('Chat interno — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async ({ params }) => {
    const agent = (await getInboxAgent())!
    const chats = await fetchInternalChats()
    const chat = chats.find((c) => c.id === params.chatId) ?? null
    const { messages, hasMore } = await fetchInternalChatMessages({ data: { chatId: params.chatId } })
    return { agent, chat, messages, hasMore }
  },
  component: InternalChatThread,
})

function displayName(chat: InternalChatItem | null, selfId: string): string {
  if (!chat) return 'Conversa'
  if (chat.kind === 'dm') {
    const other = chat.members.find((m) => m.agentId !== selfId)
    return other?.name ?? chat.name ?? 'Conversa'
  }
  return chat.name ?? (chat.kind === 'queue' ? 'Chat da fila' : chat.kind === 'team' ? 'Chat da equipe' : 'Grupo')
}

function InternalChatThread() {
  const { chatId } = Route.useParams()
  const initial = Route.useLoaderData()
  const selfId = initial.agent.id
  const chat = initial.chat

  const [messages, setMessages] = useState<InternalChatMessageItem[]>(initial.messages)
  const [hasMore, setHasMore] = useState(initial.hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const senderName = (agentId: string) =>
    chat?.members.find((m) => m.agentId === agentId)?.name ?? 'Agente'

  // Reseta ao trocar de chat.
  useEffect(() => {
    setMessages(initial.messages)
    setHasMore(initial.hasMore)
  }, [chatId, initial])

  // Ao abrir, marca como lido.
  useEffect(() => {
    markInternalChatRead({ data: { chatId } })
  }, [chatId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  // Tempo real: mensagem nova neste chat entra na thread (dedupe por id).
  useInboxSocket((event) => {
    if (event.type !== 'internal:message:new' || event.chatId !== chatId) return
    const incoming = event.message as InternalChatMessageItem
    if (!incoming?.id) return
    setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
    markInternalChatRead({ data: { chatId } })
  })

  async function loadEarlier() {
    const oldest = messages[0]
    if (!oldest || loadingMore) return
    setLoadingMore(true)
    const { messages: older, hasMore: more } = await fetchInternalChatMessages({
      data: { chatId, before: oldest.id },
    })
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id))
      return [...older.filter((m) => !known.has(m.id)), ...prev]
    })
    setHasMore(more)
    setLoadingMore(false)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (!content) return
    setSending(true)
    setDraft('')
    const sent = await sendInternalChatMessage({ data: { chatId, content } })
    if (sent) {
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
    }
    setSending(false)
  }

  const Icon = chat?.kind === 'group' ? Users : chat?.kind === 'queue' ? ListTree : chat?.kind === 'team' ? UsersRound : null

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-neutral-200 bg-neutral-0 px-5 py-3">
          <Link
            to="/inbox/chat"
            aria-label="Voltar para a lista de conversas internas"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
          >
            <ArrowLeft size={16} />
          </Link>
          {Icon ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-500">
              <Icon size={16} aria-hidden="true" />
            </span>
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-bold text-dark-800">
              {getInitials(displayName(chat, selfId))}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-dark-800">{displayName(chat, selfId)}</p>
            <p className="text-xs capitalize text-neutral-400">
              {chat?.kind === 'dm' ? 'Conversa direta' : chat?.kind === 'group' ? 'Grupo' : chat?.kind === 'team' ? 'Equipe' : 'Fila'}
              {chat && chat.kind !== 'dm' ? ` · ${chat.members.length} membros` : ''}
            </p>
          </div>
        </header>

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-neutral-50 px-5 py-4">
          {hasMore && (
            <div className="flex justify-center pb-2">
              <Button variant="secondary" size="sm" loading={loadingMore} onClick={loadEarlier}>
                Carregar anteriores
              </Button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-neutral-400">
              Nenhuma mensagem ainda.
            </div>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                own={m.senderAgentId === selfId}
                senderLabel={chat && chat.kind !== 'dm' && m.senderAgentId !== selfId ? senderName(m.senderAgentId) : null}
              />
            ))
          )}
        </div>

        {/* Composer */}
        <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-neutral-200 bg-neutral-0 px-4 py-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(e)
              }
            }}
            placeholder="Escreva uma mensagem…"
            rows={1}
            className="max-h-32 flex-1 resize-none !py-2.5"
          />
          <Button type="submit" icon={SendIcon} loading={sending} disabled={!draft.trim()}>
            Enviar
          </Button>
        </form>
      </div>
    </InboxShell>
  )
}

function MessageBubble({
  message,
  own,
  senderLabel,
}: {
  message: InternalChatMessageItem
  own: boolean
  senderLabel: string | null
}) {
  return (
    <div className={`message-in flex ${own ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
          own ? 'bg-brand-500 text-white' : 'border border-neutral-200 bg-neutral-0 text-dark-800'
        }`}
      >
        {senderLabel && <p className="mb-0.5 text-[11px] font-semibold text-brand-500">{senderLabel}</p>}
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${own ? 'text-white/70' : 'text-neutral-400'}`}>
          <span>
            {new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  )
}
