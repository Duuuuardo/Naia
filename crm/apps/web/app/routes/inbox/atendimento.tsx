import {
  createFileRoute,
  redirect,
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  ChevronDown,
  Circle,
  Clock,
  File,
  Image,
  Inbox,
  ListFilter,
  ListTodo,
  LogOut,
  MessageCircle,
  Mic,
  Plug,
  Search,
  Send,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ContactAvatar } from '../../components/inbox/contact-avatar'
import {
  assignToMe,
  fetchConversations,
  fetchQueues,
  getInboxAgent,
  inboxLogout,
  resolveConversation,
  type ConversationLastMessage,
  type ConversationListItem,
  type ConversationStatusFilter,
  type InboxAgentRole,
  type QueueItem,
} from '../../lib/inbox-session'
import { useInboxSocket } from '../../lib/use-inbox-socket'
import { createHeadConfig } from '../../lib/seo'

type StatusTab = 'abertos' | 'fila' | 'pendentes' | 'resolvidos'
type Filter = 'all' | 'mine' | 'unassigned'
// Filtro de fila: '' = todas, 'mine_queues' = filas do agente, 'no_queue' =
// sem fila, ou o id de uma fila específica (o servidor entende esses valores).
type QueueFilter = '' | 'mine_queues' | 'no_queue' | (string & {})

// Todos opcionais: params ausentes = padrão.
type AtendimentoSearch = { tab?: StatusTab; filter?: Filter; queue?: QueueFilter }

const STATUS_TABS: StatusTab[] = ['abertos', 'fila', 'pendentes', 'resolvidos']

function parseTab(value: unknown): StatusTab | undefined {
  return STATUS_TABS.includes(value as StatusTab) ? (value as StatusTab) : undefined
}

function parseFilter(value: unknown): Filter | undefined {
  return value === 'mine' || value === 'unassigned' || value === 'all' ? value : undefined
}

// Aba + filtro de atribuição → parâmetros da API. "Na fila" = open + não
// atribuídas. "Abertos" = open + assigned ('active' na server fn).
function tabQuery(tab: StatusTab, filter: Filter): { status: ConversationStatusFilter; filter: Filter } {
  switch (tab) {
    case 'fila':
      return { status: 'open', filter: 'unassigned' }
    case 'pendentes':
      return { status: 'pending', filter }
    case 'resolvidos':
      return { status: 'resolved', filter }
    default:
      return { status: 'active', filter }
  }
}

export const Route = createFileRoute('/inbox/atendimento')({
  head: () => createHeadConfig('Atendimento — Naia CRM'),
  validateSearch: (search: Record<string, unknown>): AtendimentoSearch => ({
    tab: parseTab(search.tab),
    filter: parseFilter(search.filter),
    queue: typeof search.queue === 'string' && search.queue ? (search.queue as QueueFilter) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async ({ deps }) => {
    const agent = (await getInboxAgent())!
    // fetchQueues é superadmin-only: para outros papéis devolve [] (o select
    // ainda mostra "Minhas filas"/"Sem fila", resolvidos no servidor).
    const { status, filter } = tabQuery(deps.tab ?? 'abertos', deps.filter ?? 'all')
    const [conversations, queues] = await Promise.all([
      fetchConversations({ data: { filter, status, queue: deps.queue || undefined } }),
      fetchQueues(),
    ])
    return { agent, conversations, queues }
  },
  component: AtendimentoLayout,
})

const tabLabel: Record<StatusTab, string> = {
  abertos: 'Abertos',
  fila: 'Na fila',
  pendentes: 'Pendentes',
  resolvidos: 'Resolvidos',
}

const emptyState: Record<StatusTab, { icon: LucideIcon; message: string }> = {
  abertos: { icon: Inbox, message: 'Nenhuma conversa aberta.' },
  fila: { icon: ListTodo, message: 'A fila está vazia.' },
  pendentes: { icon: Clock, message: 'Nenhuma conversa pendente.' },
  resolvidos: { icon: CheckCheck, message: 'Nenhuma conversa resolvida.' },
}

const statusDot: Record<string, string> = {
  open: 'text-brand-500',
  assigned: 'text-blue-500',
  pending: 'text-amber-500',
  resolved: 'text-neutral-300',
}

const statusLabel: Record<string, string> = {
  open: 'Aberta',
  assigned: 'Em atendimento',
  pending: 'Pendente',
  resolved: 'Resolvida',
}

const channelIcon = { whatsapp: MessageCircle, telegram: Send }

const kindIcon = { image: Image, audio: Mic, video: Video, document: File } as const
const kindLabel = { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', document: 'Arquivo' } as const

function formatProtocol(protocol: number): string {
  return `#${String(protocol).padStart(5, '0')}`
}

// Horário relativo curto para a lista ("agora", "5 min", "2 h", "3 d", data).
function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function MessagePreview({ message, unread }: { message: ConversationLastMessage | null; unread: boolean }) {
  if (!message) return <p className="truncate text-xs italic text-neutral-300">Sem mensagens</p>
  const KindIcon = message.kind !== 'text' ? kindIcon[message.kind] : null
  const text = message.content.trim() || (message.kind !== 'text' ? kindLabel[message.kind] : '')
  return (
    <p
      className={`flex items-center gap-1 truncate text-xs ${unread ? 'font-semibold text-dark-800' : 'text-neutral-400'}`}
    >
      {KindIcon && <KindIcon size={12} className="shrink-0" aria-hidden="true" />}
      <span className="truncate">
        {message.direction === 'outbound' ? `Você: ${text}` : text}
      </span>
    </p>
  )
}

const roleMeta: Record<InboxAgentRole, { label: string; className: string }> = {
  superadmin: { label: 'Superadmin', className: 'bg-brand-50 text-brand-600' },
  admin: { label: 'Admin', className: 'bg-blue-50 text-blue-600' },
  agent: { label: 'Agente', className: 'bg-neutral-100 text-neutral-500' },
}

function AtendimentoLayout() {
  const { agent, conversations, queues } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const isLoading = useRouterState({ select: (s) => s.isLoading })
  // Conversa aberta no Outlet (destaca a linha e, no mobile, troca a coluna
  // visível entre a lista e a thread).
  const { conversationId } = useParams({ strict: false })
  const onThread = conversationId != null
  const roleInfo = roleMeta[agent.role] ?? roleMeta.agent

  // Padrões quando o param está ausente da URL.
  const tab = search.tab ?? 'abertos'
  const filter = search.filter ?? 'all'
  const queue = search.queue ?? ''

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [acting, setActing] = useState(false)

  // Navegação com replace: filtros/aba não poluem o histórico (o link
  // compartilhável continua funcionando — o estado vive na URL).
  function setSearch(patch: Partial<AtendimentoSearch>) {
    navigate({ search: (prev: AtendimentoSearch) => ({ ...prev, ...patch }), replace: true })
  }

  // Descarta selecionados que saíram da página atual (troca de aba, refresh
  // por tempo real, ação em massa) e limpa o feedback ao trocar de aba.
  useEffect(() => {
    const ids = new Set(conversations.map((c) => c.id))
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
    setFailed((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [conversations])

  useEffect(() => {
    setActionMsg(null)
    setFailed(new Set())
  }, [tab, filter, queue])

  // Tempo real: invalida o loader (recarrega a lista atual com os filtros da
  // URL) em eventos relevantes — atualiza preview e não lidas.
  useInboxSocket((event) => {
    if (
      event.type === 'conversation:new' ||
      event.type === 'conversation:assigned' ||
      event.type === 'conversation:resolved' ||
      event.type === 'conversation:transferred' ||
      event.type === 'bot:status' ||
      event.type === 'bot:stopped' ||
      event.type === 'message:new'
    ) {
      router.invalidate()
    }
  })

  // Busca client-side sobre a página atual (a API não tem parâmetro de busca):
  // nome/título da conversa ou protocolo (com ou sem zeros).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    const digits = q.replace(/\D/g, '')
    return conversations.filter((c) => {
      const name = (c.title ?? c.contactName).toLowerCase()
      if (name.includes(q)) return true
      if (!digits) return false
      const protocol = String(c.protocol).padStart(5, '0')
      return protocol.includes(digits)
    })
  }, [conversations, query])

  const selectionMode = selected.size > 0
  const selectedItems = useMemo(() => conversations.filter((c) => selected.has(c.id)), [conversations, selected])
  // Resolver: qualquer status exceto já resolvida. Assumir: idem, e pula
  // conversas já atribuídas ao próprio agente.
  const resolvable = selectedItems.filter((c) => c.status !== 'resolved')
  const assumable = selectedItems.filter((c) => c.status !== 'resolved' && c.assignedAgentId !== agent.id)

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Ações em massa: paralelismo limitado (4 por vez), feedback por item
  // (falhas ficam selecionadas e destacadas em vermelho) e refresh da lista.
  async function runBulk(kind: 'resolve' | 'assign') {
    const targets = kind === 'resolve' ? resolvable : assumable
    if (targets.length === 0 || acting) return
    setActing(true)
    setActionMsg(null)
    setFailed(new Set())
    const fn = kind === 'resolve' ? resolveConversation : assignToMe
    const failedIds: string[] = []
    for (let i = 0; i < targets.length; i += 4) {
      const chunk = targets.slice(i, i + 4)
      const results = await Promise.all(
        chunk.map((c) =>
          fn({ data: { conversationId: c.id } })
            .then((r) => r.ok)
            .catch(() => false),
        ),
      )
      results.forEach((ok, j) => {
        if (!ok) failedIds.push(chunk[j]!.id)
      })
    }
    const okCount = targets.length - failedIds.length
    const verb = kind === 'resolve' ? 'resolvida' : 'assumida'
    setActionMsg(
      failedIds.length
        ? `${okCount} ${verb}${okCount === 1 ? '' : 's'} · falhou em ${failedIds.length}`
        : `${okCount} ${verb}${okCount === 1 ? '' : 's'}`,
    )
    setFailed(new Set(failedIds))
    setSelected(new Set(failedIds))
    setActing(false)
    router.invalidate()
  }

  async function handleLogout() {
    await inboxLogout()
    router.navigate({ to: '/inbox/login' })
  }

  const searching = query.trim().length > 0
  const EmptyIcon = searching ? Search : emptyState[tab].icon
  const emptyMessage = searching ? `Nenhum resultado para “${query.trim()}”.` : emptyState[tab].message

  return (
    <div className="flex h-screen bg-neutral-50">
      {/* Sidebar de atendimento: lista de conversas + filtros + voltar */}
      <aside
        className={`${onThread ? 'hidden' : 'flex'} w-full flex-col border-r border-neutral-200 bg-neutral-0 md:flex md:w-[360px] md:shrink-0`}
      >
        {/* Voltar ao painel + identidade do agente */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-100 px-3">
          <Link
            to="/inbox/meu-desempenho"
            aria-label="Voltar ao painel"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Painel
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="min-w-0 text-right">
              <p className="truncate text-xs font-semibold text-dark-800">{agent.name}</p>
              <span className={`inline-block rounded-full px-1.5 text-[10px] font-bold ${roleInfo.className}`}>
                {roleInfo.label}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Abas de status */}
        <div className="flex items-center gap-1 border-b border-neutral-100 px-2 pt-2">
          {STATUS_TABS.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setSearch({ tab: tabKey })}
              className={`rounded-t-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                tab === tabKey ? 'bg-brand-50 text-brand-600' : 'text-neutral-500 hover:bg-neutral-100'
              }`}
            >
              {tabLabel[tabKey]}
            </button>
          ))}
          {isLoading && (
            <span
              className="ml-auto size-3.5 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-500"
              aria-label="Atualizando lista"
            />
          )}
        </div>

        {/* Busca + filtros de atribuição + fila */}
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 p-2">
          <div className="relative min-w-40 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou protocolo…"
              aria-label="Buscar conversas"
              className="h-8 w-full rounded-md border border-neutral-200 bg-neutral-0 pl-7 pr-3 text-xs text-dark-800 transition-colors placeholder:text-neutral-400 hover:border-neutral-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {tab !== 'fila' && (
            <div className="flex gap-1">
              {(['all', 'mine', 'unassigned'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSearch({ filter: f })}
                  className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                    filter === f ? 'bg-brand-50 text-brand-600' : 'text-neutral-500 hover:bg-neutral-100'
                  }`}
                >
                  {f === 'all' ? 'Todas' : f === 'mine' ? 'Minhas' : 'Não atrib.'}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex items-center">
            <ListFilter size={13} className="pointer-events-none absolute left-2 text-neutral-400" aria-hidden="true" />
            <select
              value={queue}
              onChange={(e) => setSearch({ queue: e.target.value as QueueFilter })}
              aria-label="Filtrar por fila"
              className="h-8 appearance-none rounded-md border border-neutral-200 bg-neutral-0 pl-7 pr-6 text-xs font-semibold text-neutral-600 transition-colors hover:border-neutral-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">Todas as filas</option>
              <option value="mine_queues">Minhas filas</option>
              {queues.map((q: QueueItem) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
              <option value="no_queue">Sem fila</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 text-neutral-400" aria-hidden="true" />
          </div>
        </div>

        <div className="relative flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <EmptyIcon size={28} className="text-neutral-300" />
              <p className="text-sm text-neutral-400">{emptyMessage}</p>
            </div>
          ) : (
            visible.map((c: ConversationListItem) => {
              const ChannelIcon = channelIcon[c.originChannel ?? 'whatsapp']
              const unread = c.unreadCount > 0
              const isSelected = selected.has(c.id)
              const isActive = c.id === conversationId
              return (
                <Link
                  key={c.id}
                  to="/inbox/atendimento/c/$conversationId"
                  params={{ conversationId: c.id }}
                  className={`group flex items-center gap-3 border-b border-neutral-50 px-4 py-3 transition-colors ${
                    failed.has(c.id)
                      ? 'bg-red-50 hover:bg-red-50'
                      : isActive
                        ? 'bg-brand-50'
                        : isSelected
                          ? 'bg-brand-50/60 hover:bg-brand-50'
                          : 'hover:bg-neutral-50'
                  }`}
                >
                  {/* Checkbox substitui o avatar no hover/focus ou no modo seleção. */}
                  <span className="relative grid size-9 shrink-0 place-items-center">
                    <ContactAvatar
                      name={c.contactName}
                      url={c.contactAvatarUrl}
                      size={36}
                      className={`text-xs transition-opacity ${
                        selectionMode ? 'opacity-0' : 'group-hover:opacity-0'
                      }`}
                    />
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(c.id)}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      aria-label={`Selecionar conversa com ${c.contactName}`}
                      className={`absolute inset-0 m-auto size-4 accent-brand-500 transition-opacity ${
                        selectionMode ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                      }`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-dark-800">{c.title ?? c.contactName}</p>
                      <ChannelIcon size={11} className="shrink-0 text-neutral-300" />
                      {c.activeBotFlowId && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">
                          <Bot size={10} aria-hidden="true" />
                          Bot
                        </span>
                      )}
                    </div>
                    <MessagePreview message={c.lastMessage} unread={unread} />
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-400">
                      <Circle size={7} className={`shrink-0 fill-current ${statusDot[c.status]}`} aria-hidden="true" />
                      <span className="shrink-0">{statusLabel[c.status]}</span>
                      {c.queueName && <span className="truncate">· {c.queueName}</span>}
                      <span className="shrink-0">· {formatProtocol(c.protocol)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`text-[11px] ${unread ? 'font-semibold text-brand-600' : 'text-neutral-400'}`}
                      suppressHydrationWarning
                    >
                      {formatRelativeTime(c.lastMessage?.sentAt ?? c.updatedAt)}
                    </span>
                    {unread && (
                      <span className="grid min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </Link>
              )
            })
          )}

          {/* Barra de ações em massa */}
          {selectionMode && (
            <div className="sticky bottom-3 mx-auto flex w-fit items-center gap-2 rounded-xl bg-dark-800 px-3 py-2 text-white shadow-lg">
              <span className="whitespace-nowrap text-xs font-semibold">
                {selected.size} selecionada{selected.size === 1 ? '' : 's'}
              </span>
              {actionMsg && <span className="whitespace-nowrap text-[11px] text-neutral-300">{actionMsg}</span>}
              <button
                type="button"
                disabled={acting || resolvable.length === 0}
                title={resolvable.length === 0 ? 'Nenhuma conversa selecionada pode ser resolvida' : 'Resolver selecionadas'}
                onClick={() => runBulk('resolve')}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCheck size={13} aria-hidden="true" />
                Resolver
              </button>
              <button
                type="button"
                disabled={acting || assumable.length === 0}
                title={assumable.length === 0 ? 'Nenhuma conversa selecionada pode ser assumida (já resolvidas ou já suas)' : 'Assumir selecionadas'}
                onClick={() => runBulk('assign')}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <UserPlus size={13} aria-hidden="true" />
                Assumir
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set())
                  setFailed(new Set())
                  setActionMsg(null)
                }}
                aria-label="Limpar seleção"
                className="grid size-7 place-items-center rounded-md text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Atalho de conexões: status dos canais (só superadmin). */}
        {agent.role === 'superadmin' && (
          <Link
            to="/inbox/admin/conexoes"
            className="flex shrink-0 items-center gap-2 border-t border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800"
          >
            <Plug size={15} aria-hidden="true" className="shrink-0" />
            Status das conexões
          </Link>
        )}
      </aside>

      {/* Conteúdo: thread da conversa ou estado vazio */}
      <main className={`${onThread ? 'block' : 'hidden'} min-w-0 flex-1 overflow-hidden md:block`}>
        <Outlet />
      </main>
    </div>
  )
}
