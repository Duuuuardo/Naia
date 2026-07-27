import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Bot,
  BotOff,
  Check,
  CheckCheck,
  Clock,
  CircleCheck,
  Copy,
  PanelRight,
  Pause,
  Pencil,
  RotateCcw,
  Star,
  UserPlus,
  X,
} from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, Modal, getInitials } from '../../../components/ui'
import { Composer } from '../../../components/inbox/composer'
import { MessageAttachments } from '../../../components/inbox/message-attachments'
import { TransferModal } from '../../../components/inbox/transfer-modal'
import { ConversationTags } from '../../../components/inbox/conversation-tags'
import { ContactPanel } from '../../../components/inbox/contact-panel'
import {
  getInboxAgent,
  fetchConversations,
  fetchContact,
  fetchContactHistory,
  fetchTags,
  renameConversation,
  assignToMe,
  resolveConversation,
} from '../../../lib/inbox-session'
import {
  fetchConversationPage,
  markConversationRead,
  markConversationPending,
  reopenConversation,
  sendThreadMessage,
  stopConversationBot,
  type ThreadMessageItem,
  type ThreadTransferItem,
  type ThreadRatingItem,
} from '../../../lib/inbox-thread'
import { type ConversationNoteItem } from '../../../lib/inbox-notes'
import { useInboxSocket } from '../../../lib/use-inbox-socket'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/c/$conversationId')({
  head: () => createHeadConfig('Conversa — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async ({ params }) => {
    const agent = (await getInboxAgent())!
    // Página mais recente da thread (50 mensagens); páginas anteriores são
    // carregadas sob demanda pelo botão "Carregar mensagens anteriores".
    const data = await fetchConversationPage({ data: { conversationId: params.conversationId, limit: 50 } })
    const contactId = data.conversation?.contactId
    // A API de detalhe não retorna as tags da conversa: os labels (nomes)
    // saem da listagem e são mapeados para as tags do workspace (com cor).
    const [tags, list, contactDetail, history] = await Promise.all([
      fetchTags(),
      fetchConversations({ data: { filter: 'all' } }),
      contactId ? fetchContact({ data: { contactId } }) : Promise.resolve(null),
      contactId ? fetchContactHistory({ data: { contactId } }) : Promise.resolve([]),
    ])
    const labels = list.find((c) => c.id === params.conversationId)?.labels ?? []
    return { agent, ...data, tags, labels, contactDetail, history }
  },
  component: ConversationView,
})

const statusMeta: Record<string, { label: string; color: string }> = {
  open: { label: 'Aberta', color: 'text-brand-600 bg-brand-50' },
  assigned: { label: 'Atribuída', color: 'text-blue-600 bg-blue-50' },
  pending: { label: 'Aguardando cliente', color: 'text-amber-600 bg-amber-50' },
  resolved: { label: 'Resolvida', color: 'text-neutral-500 bg-neutral-100' },
}

// Linha do tempo da thread: mensagens, transferências e avaliação CSAT
// intercaladas por data.
type TimelineEntry =
  | { kind: 'message'; at: string; message: ThreadMessageItem }
  | { kind: 'transfer'; at: string; transfer: ThreadTransferItem }
  | { kind: 'rating'; at: string; rating: ThreadRatingItem }

// SSR-safe: no servidor cai para useEffect (scroll só existe no cliente).
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function formatProtocol(protocol: number): string {
  return `#${String(protocol).padStart(5, '0')}`
}

// Mescla a página mais recente na lista carregada (que pode incluir páginas
// antigas): atualiza mensagens conhecidas, anexa as novas e substitui as
// otimistas (tmp-*) já confirmadas na página (mesmo conteúdo outbound).
function mergeLatestPage(prev: ThreadMessageItem[], page: ThreadMessageItem[]): ThreadMessageItem[] {
  const byId = new Map(page.map((m) => [m.id, m]))
  const known = new Set(prev.map((m) => m.id))
  const fresh = page.filter((m) => !known.has(m.id))
  const confirmedOutbound = new Set(
    fresh.filter((m) => m.direction === 'outbound').map((m) => m.content.trim()),
  )
  const kept = prev.filter((m) => !m.id.startsWith('tmp-') || !confirmedOutbound.has(m.content.trim()))
  const merged = kept.map((m) => byId.get(m.id) ?? m)
  return fresh.length > 0 ? [...merged, ...fresh] : merged
}

function ConversationView() {
  const { conversationId } = Route.useParams()
  const initial = Route.useLoaderData()
  const [messages, setMessages] = useState<ThreadMessageItem[]>(initial.messages)
  const [transfers, setTransfers] = useState<ThreadTransferItem[]>(initial.transfers)
  const [rating, setRating] = useState<ThreadRatingItem | null>(initial.rating)
  const [status, setStatus] = useState(initial.conversation?.status ?? 'open')
  const [botFlowName, setBotFlowName] = useState<string | null>(initial.activeBotFlow?.name ?? null)
  // Confirmação do takeover (interromper o bot que atende a conversa).
  const [stopBotOpen, setStopBotOpen] = useState(false)
  const [stoppingBot, setStoppingBot] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  // Título manual da conversa (null = exibe o nome do contato).
  const [title, setTitle] = useState<string | null>(initial.conversation?.title ?? null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [labels, setLabels] = useState<string[]>(initial.labels)
  const [notes, setNotes] = useState<ConversationNoteItem[]>(initial.notes)
  // Paginação da thread: páginas anteriores via cursor (before=nextCursor).
  const [hasMore, setHasMore] = useState(initial.hasMore)
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Bloqueio do contato (aviso na thread + 409 no envio).
  const [blocked, setBlocked] = useState(initial.contact?.blocked ?? false)
  // Feedback efêmero de erro de ação (409 de transição, envio bloqueado…).
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [protocolCopied, setProtocolCopied] = useState(false)
  // Painel do contato: aside no desktop (lg+), Modal no mobile.
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelMobileOpen, setPanelMobileOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Âncora de scroll para o prepend de mensagens antigas: guarda
  // scrollHeight/scrollTop antes do prepend e compensa depois.
  const prependAnchor = useRef<{ height: number; top: number } | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const contact = initial.contact
  const contactDetail = initial.contactDetail
  const protocol = initial.conversation?.protocol ?? null

  function flashError(message: string) {
    setActionError(message)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setActionError(null), 5000)
  }

  async function refresh() {
    const data = await fetchConversationPage({ data: { conversationId, limit: 50 } })
    setMessages(data.messages)
    setTransfers(data.transfers)
    setRating(data.rating)
    setNotes(data.notes)
    setHasMore(data.hasMore)
    setNextCursor(data.nextCursor)
    if (data.conversation?.status) setStatus(data.conversation.status)
    setBotFlowName(data.activeBotFlow?.name ?? null)
  }

  useEffect(() => {
    // Reseta ao trocar de conversa.
    setMessages(initial.messages)
    setTransfers(initial.transfers)
    setRating(initial.rating)
    setStatus(initial.conversation?.status ?? 'open')
    setBotFlowName(initial.activeBotFlow?.name ?? null)
    setTitle(initial.conversation?.title ?? null)
    setLabels(initial.labels)
    setNotes(initial.notes)
    setHasMore(initial.hasMore)
    setNextCursor(initial.nextCursor)
    setBlocked(initial.contact?.blocked ?? false)
    setActionError(null)
    setEditingTitle(false)
    setPanelMobileOpen(false)
    prependAnchor.current = null
    // Abrir a conversa marca como lida (idempotente).
    void markConversationRead({ data: { conversationId } })
  }, [conversationId, initial])

  const timeline: TimelineEntry[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: m.sentAt, message: m })),
    ...transfers.map((t) => ({ kind: 'transfer' as const, at: t.createdAt, transfer: t })),
    ...(rating ? [{ kind: 'rating' as const, at: rating.createdAt, rating }] : []),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependAnchor.current) {
      // Prepend de página antiga: compensa a altura adicionada para manter a
      // posição de leitura (sem pular para o fim).
      const { height, top } = prependAnchor.current
      prependAnchor.current = null
      el.scrollTop = el.scrollHeight - height + top
      return
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [timeline.length])

  // Carrega a página anterior da thread e prepende mantendo a posição.
  async function loadOlder() {
    if (!hasMore || !nextCursor || loadingOlder) return
    setLoadingOlder(true)
    const el = scrollRef.current
    if (el) prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop }
    try {
      const page = await fetchConversationPage({ data: { conversationId, limit: 50, before: nextCursor } })
      setMessages((prev) => [...page.messages, ...prev])
      setHasMore(page.hasMore)
      setNextCursor(page.nextCursor)
    } catch {
      prependAnchor.current = null
      flashError('Não foi possível carregar mensagens anteriores.')
    } finally {
      setLoadingOlder(false)
    }
  }

  // Tempo real: mensagens, status de leitura, transferências e bot.
  useInboxSocket(async (event) => {
    if (event.type === 'message:new' && event.conversationId === conversationId) {
      // Mescla a página mais recente sem derrubar as páginas antigas já
      // carregadas: atualiza as conhecidas e anexa só as novas.
      const data = await fetchConversationPage({ data: { conversationId, limit: 50 } })
      setMessages((prev) => mergeLatestPage(prev, data.messages))
      // Thread aberta e aba visível = leitura contínua.
      if (document.visibilityState === 'visible') {
        void markConversationRead({ data: { conversationId } })
      }
    }
    if (event.type === 'message:status' && event.conversationId === conversationId) {
      // Atualiza só o status da mensagem, sem refetch total.
      setMessages((prev) => prev.map((m) => (m.id === event.messageId ? { ...m, status: event.status } : m)))
    }
    if (event.type === 'conversation:transferred' && event.conversationId === conversationId) {
      refresh()
    }
    if (event.type === 'bot:status' && event.conversationId === conversationId) {
      setBotFlowName(event.active ? (event.flowName ?? 'Chatbot') : null)
    }
    if (event.type === 'bot:stopped' && event.conversationId === conversationId) {
      // Takeover por outro agente (ou por esta aba): some o badge.
      setBotFlowName(null)
    }
    if (event.type === 'conversation:resolved' && event.conversationId === conversationId) {
      setStatus('resolved')
    }
    if (event.type === 'conversation:assigned' && event.conversationId === conversationId) {
      setStatus('assigned')
    }
    if (event.type === 'conversation:reopened' && event.conversationId === conversationId) {
      setStatus('open')
    }
    if (event.type === 'conversation:pending' && event.conversationId === conversationId) {
      setStatus('pending')
    }
  })

  async function handleSend({ content, attachments }: { content: string; attachments: { fileId: string; filename: string; kind: 'image' | 'video' | 'audio' | 'document'; storageKey: string }[] }) {
    if (blocked) {
      flashError('Contato bloqueado: desbloqueie para enviar mensagens.')
      return
    }
    // Otimista: mostra a mensagem imediatamente (com os anexos).
    const optimistic: ThreadMessageItem = {
      id: `tmp-${Date.now()}`,
      direction: 'outbound',
      content,
      kind: attachments[0]?.kind ?? 'text',
      status: 'queued',
      sentAt: new Date().toISOString(),
      agentName: null,
      attachments: attachments.map((a) => ({
        storageKey: a.storageKey,
        mimeType: '',
        kind: a.kind,
        filename: a.filename,
      })),
    }
    setMessages((prev) => [...prev, optimistic])
    const result = await sendThreadMessage({
      data: {
        conversationId,
        content,
        attachmentFileIds: attachments.length > 0 ? attachments.map((a) => a.fileId) : undefined,
      },
    })
    if (!result.ok) {
      // Desfaz a mensagem otimista e mostra o motivo (ex.: contato bloqueado).
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      flashError(result.message ?? 'Não foi possível enviar a mensagem.')
      return
    }
    // Confirma a otimista com a mensagem real (sem esperar o WS).
    const data = await fetchConversationPage({ data: { conversationId, limit: 50 } })
    setMessages((prev) => mergeLatestPage(prev, data.messages))
    if (status === 'open' || status === 'assigned') setStatus('pending')
  }

  async function handleAssign() {
    await assignToMe({ data: { conversationId } })
    setStatus('assigned')
  }

  // Takeover: interrompe o bot que está atendendo e o agente assume.
  async function handleStopBot() {
    if (stoppingBot) return
    setStoppingBot(true)
    const result = await stopConversationBot({ data: { conversationId } })
    setStoppingBot(false)
    setStopBotOpen(false)
    if (!result.ok) {
      flashError(result.message ?? 'Não foi possível interromper o bot.')
      return
    }
    setBotFlowName(null)
  }

  async function handleResolve() {
    await resolveConversation({ data: { conversationId } })
    setStatus('resolved')
  }

  async function handleReopen() {
    if (actionBusy) return
    setActionBusy(true)
    const result = await reopenConversation({ data: { conversationId } })
    setActionBusy(false)
    if (!result.ok) {
      flashError(result.message ?? 'Não foi possível reabrir a conversa.')
      return
    }
    setStatus('open')
  }

  async function handlePending() {
    if (actionBusy) return
    setActionBusy(true)
    const result = await markConversationPending({ data: { conversationId } })
    setActionBusy(false)
    if (!result.ok) {
      flashError(result.message ?? 'Não foi possível marcar como pendente.')
      return
    }
    setStatus('pending')
  }

  async function handleCopyProtocol() {
    if (protocol == null) return
    try {
      await navigator.clipboard.writeText(formatProtocol(protocol))
      setProtocolCopied(true)
      setTimeout(() => setProtocolCopied(false), 1500)
    } catch {
      // Clipboard indisponível (permissão negada / contexto não seguro).
    }
  }

  function startEditTitle() {
    setTitleDraft(title ?? '')
    setEditingTitle(true)
  }

  async function handleSaveTitle() {
    if (savingTitle) return
    const value = titleDraft.trim()
    setSavingTitle(true)
    await renameConversation({ data: { conversationId, title: value || null } })
    setTitle(value || null)
    setSavingTitle(false)
    setEditingTitle(false)
  }

  function handleNoteAdded(note: ConversationNoteItem | null) {
    if (note) {
      setNotes((prev) => [...prev, note])
    } else {
      // Fallback: o POST não devolveu a nota — refetch completo das notas.
      fetchConversationPage({ data: { conversationId, limit: 50 } }).then((data) => setNotes(data.notes))
    }
  }

  // No desktop alterna o aside; no mobile abre o painel como Modal.
  function togglePanel() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setPanelOpen((v) => !v)
    } else {
      setPanelMobileOpen(true)
    }
  }

  const meta = statusMeta[status] ?? statusMeta.open
  const displayName = title ?? contact?.name ?? 'Contato'

  const panel = (
    <ContactPanel
      contact={contactDetail?.contact ?? null}
      identities={contactDetail?.identities ?? []}
      deals={contactDetail?.deals ?? []}
      history={initial.history}
      tags={initial.tags}
      notes={notes}
      conversationId={conversationId}
      blocked={blocked}
      onBlockedChange={setBlocked}
      onNoteAdded={handleNoteAdded}
    />
  )

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="flex h-full">
        {/* Thread principal */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-0 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/inbox"
                aria-label="Voltar para a lista de conversas"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
              >
                <ArrowLeft size={16} />
              </Link>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-bold text-dark-800">
                {getInitials(contact?.name ?? '?')}
              </span>
              <div className="min-w-0">
                {editingTitle ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleSaveTitle()
                    }}
                  >
                    <input
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      type="text"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      maxLength={120}
                      placeholder={contact?.name ?? 'Nome da conversa'}
                      aria-label="Nome da conversa"
                      className="h-8 w-48 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm text-dark-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <button
                      type="submit"
                      disabled={savingTitle}
                      aria-label="Salvar nome"
                      title="Salvar nome"
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-40"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTitle(false)}
                      aria-label="Cancelar"
                      title="Cancelar"
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                    >
                      <X size={15} />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1">
                    <p className="truncate text-sm font-semibold text-dark-800">{displayName}</p>
                    {protocol != null && (
                      <button
                        type="button"
                        onClick={handleCopyProtocol}
                        title="Copiar protocolo"
                        aria-label={`Copiar protocolo ${formatProtocol(protocol)}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                      >
                        {formatProtocol(protocol)}
                        {protocolCopied ? (
                          <Check size={11} className="text-brand-600" aria-hidden="true" />
                        ) : (
                          <Copy size={11} aria-hidden="true" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={startEditTitle}
                      aria-label="Renomear conversa"
                      title="Renomear conversa"
                      className="grid size-6 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                    {meta.label}
                  </span>
                  {botFlowName && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600"
                      title={botFlowName}
                    >
                      <Bot size={11} aria-hidden="true" />
                      Chatbot atendendo
                    </span>
                  )}
                  <ConversationTags
                    conversationId={conversationId}
                    labels={labels}
                    tags={initial.tags}
                    onSaved={setLabels}
                  />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {botFlowName && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={BotOff}
                  onClick={() => setStopBotOpen(true)}
                  title="Interromper o chatbot e assumir o atendimento"
                >
                  Interromper bot
                </Button>
              )}
              <Button variant="secondary" size="sm" icon={ArrowRightLeft} onClick={() => setTransferOpen(true)}>
                Transferir
              </Button>
              <Button variant="secondary" size="sm" icon={UserPlus} onClick={handleAssign}>
                Pegar
              </Button>
              {status === 'resolved' && (
                <Button variant="secondary" size="sm" icon={RotateCcw} loading={actionBusy} onClick={handleReopen}>
                  Reabrir
                </Button>
              )}
              {status === 'assigned' && (
                <Button variant="secondary" size="sm" icon={Pause} loading={actionBusy} onClick={handlePending}>
                  Marcar pendente
                </Button>
              )}
              {status !== 'resolved' && (
                <Button variant="secondary" size="sm" icon={CircleCheck} onClick={handleResolve}>
                  Resolver
                </Button>
              )}
              <button
                type="button"
                onClick={togglePanel}
                aria-label="Painel do contato"
                title="Painel do contato"
                className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
                  panelOpen ? 'bg-brand-50 text-brand-600' : 'text-neutral-400 hover:bg-neutral-100 hover:text-dark-800'
                }`}
              >
                <PanelRight size={16} />
              </button>
            </div>
          </header>

          {/* Feedback de erro de ação (409 de transição, envio bloqueado…) */}
          {actionError && (
            <div role="alert" className="border-b border-error-500/25 bg-error-500/5 px-5 py-2">
              <p className="text-xs text-error-500">{actionError}</p>
            </div>
          )}

          {/* Mensagens + eventos de transferência */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-neutral-50 px-5 py-4">
            {hasMore && (
              <div className="flex justify-center pb-1">
                <Button variant="secondary" size="sm" loading={loadingOlder} onClick={loadOlder}>
                  Carregar mensagens anteriores
                </Button>
              </div>
            )}
            {timeline.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-neutral-400">
                Nenhuma mensagem ainda.
              </div>
            ) : (
              timeline.map((entry) =>
                entry.kind === 'message' ? (
                  <MessageBubble key={entry.message.id} message={entry.message} />
                ) : entry.kind === 'transfer' ? (
                  <TransferEvent key={entry.transfer.id} transfer={entry.transfer} />
                ) : (
                  <RatingEvent key={entry.rating.id} rating={entry.rating} />
                ),
              )
            )}
          </div>

          {/* Aviso de contato bloqueado (o envio retorna 409 na API) */}
          {blocked && (
            <div className="flex items-center gap-2 border-t border-error-500/25 bg-error-500/5 px-5 py-2 text-xs text-error-500">
              <Ban size={13} aria-hidden="true" className="shrink-0" />
              Contato bloqueado — mensagens recebidas são ignoradas e o envio está indisponível.
            </div>
          )}

          {/* Composer */}
          <Composer onSend={handleSend} />
        </div>

        {/* Painel do contato (desktop) */}
        {panelOpen && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-neutral-200 bg-neutral-0 lg:block">
            {panel}
          </aside>
        )}
      </div>

      {/* Painel do contato (mobile) */}
      <Modal open={panelMobileOpen} onClose={() => setPanelMobileOpen(false)} title="Contato">
        <div className="max-h-[70vh] overflow-y-auto">{panel}</div>
      </Modal>

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        conversationId={conversationId}
        currentAgentId={initial.agent.id}
        onTransferred={refresh}
      />

      {/* Confirmação do takeover: interromper o bot que atende a conversa */}
      <Modal
        open={stopBotOpen}
        onClose={() => setStopBotOpen(false)}
        title="Interromper bot"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStopBotOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" icon={BotOff} loading={stoppingBot} onClick={handleStopBot}>
              Interromper
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-500">
          O chatbot{' '}
          <span className="font-semibold text-dark-800">{botFlowName ?? 'atual'}</span> vai parar de
          responder esta conversa e o atendimento fica com os agentes. Deseja continuar?
        </p>
      </Modal>
    </InboxShell>
  )
}

function MessageBubble({ message }: { message: ThreadMessageItem }) {
  const outbound = message.direction === 'outbound'
  const hasAttachments = (message.attachments?.length ?? 0) > 0
  const hasText = message.content.trim().length > 0
  return (
    <div className={`message-in flex flex-col ${outbound ? 'items-end' : 'items-start'}`}>
      {outbound && message.agentName && (
        <span className="mb-0.5 pr-1 text-[10px] text-neutral-400">{message.agentName}</span>
      )}
      <div
        className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
          outbound ? 'bg-brand-500 text-white' : 'border border-neutral-200 bg-neutral-0 text-dark-800'
        }`}
      >
        {hasAttachments && (
          <div className={hasText ? 'mb-1.5' : ''}>
            <MessageAttachments attachments={message.attachments!} />
          </div>
        )}
        {hasText && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${outbound ? 'text-white/70' : 'text-neutral-400'}`}>
          <span>{new Date(message.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          {outbound && <MessageStatus status={message.status} />}
        </div>
      </div>
    </div>
  )
}

// Evento de sistema: transferência da conversa, centralizado e neutro.
function TransferEvent({ transfer }: { transfer: ThreadTransferItem }) {
  const by = transfer.transferredByAgentName ?? 'Alguém'
  const destination = transfer.toAgentName
    ? `para ${transfer.toAgentName}`
    : transfer.toQueueName
      ? `para a fila ${transfer.toQueueName}`
      : 'para outro destino'
  return (
    <div className="flex justify-center">
      <p className="max-w-[85%] rounded-full bg-neutral-100 px-3 py-1 text-center text-[11px] text-neutral-500">
        {by} transferiu {destination}
        {transfer.note ? ` — “${transfer.note}”` : ''}
        {' · '}
        {new Date(transfer.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  )
}

// Evento de sistema: avaliação CSAT do cliente (nota 1-5 + comentário),
// centralizado e neutro como a transferência.
function RatingEvent({ rating }: { rating: ThreadRatingItem }) {
  return (
    <div className="flex justify-center">
      <p className="flex max-w-[85%] flex-wrap items-center justify-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-center text-[11px] text-neutral-500">
        Avaliação do cliente:
        <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating.score} de 5 estrelas`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star
              key={i}
              size={11}
              aria-hidden="true"
              className={i <= rating.score ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}
            />
          ))}
        </span>
        ({rating.score})
        {rating.comment ? ` — “${rating.comment}”` : ''}
        {' · '}
        {new Date(rating.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  )
}

function MessageStatus({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck size={12} />
  if (status === 'delivered') return <CheckCheck size={12} className="opacity-60" />
  if (status === 'sent') return <Check size={12} />
  if (status === 'failed') return <span className="text-error-500">falhou</span>
  return <Clock size={11} />
}
