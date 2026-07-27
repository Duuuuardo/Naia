import { createFileRoute, redirect, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ListTree, MessagesSquare, Plus, Users, UsersRound } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, EmptyState, Modal, getInitials } from '../../../components/ui'
import {
  createInternalChat,
  fetchAgentsAdmin,
  fetchInternalChats,
  fetchQueues,
  fetchTeams,
  getInboxAgent,
  type AdminAgentItem,
  type InternalChatItem,
  type QueueItem,
  type TeamItem,
} from '../../../lib/inbox-session'
import { useInboxSocket } from '../../../lib/use-inbox-socket'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/chat/')({
  head: () => createHeadConfig('Chat interno — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const chats = await fetchInternalChats()
    return { agent, chats }
  },
  component: InternalChatIndex,
})

// Nome de exibição do chat: DM = outro agente, grupo = name, fila/equipe = name.
function chatDisplayName(chat: InternalChatItem, selfId: string): string {
  if (chat.kind === 'dm') {
    const other = chat.members.find((m) => m.agentId !== selfId)
    return other?.name ?? chat.name ?? 'Conversa'
  }
  return chat.name ?? (chat.kind === 'queue' ? 'Chat da fila' : chat.kind === 'team' ? 'Chat da equipe' : 'Grupo')
}

function ChatAvatar({ chat, selfId }: { chat: InternalChatItem; selfId: string }) {
  if (chat.kind === 'dm') {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-bold text-dark-800">
        {getInitials(chatDisplayName(chat, selfId))}
      </span>
    )
  }
  const Icon = chat.kind === 'group' ? Users : chat.kind === 'team' ? UsersRound : ListTree
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-500">
      <Icon size={16} aria-hidden="true" />
    </span>
  )
}

function formatChatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function InternalChatIndex() {
  const { agent, chats: initialChats } = Route.useLoaderData()
  const [chats, setChats] = useState<InternalChatItem[]>(initialChats)
  const [modalOpen, setModalOpen] = useState(false)

  async function reload() {
    setChats(await fetchInternalChats())
  }

  // Tempo real: mensagem nova em qualquer chat interno atualiza a lista.
  useInboxSocket((event) => {
    if (event.type === 'internal:message:new') reload()
  })

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="flex h-full flex-col bg-neutral-0">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
          <p className="text-sm font-semibold text-dark-800">Chat interno</p>
          <Button size="sm" icon={Plus} onClick={() => setModalOpen(true)}>
            Nova conversa
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {chats.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="Nenhuma conversa interna"
              description="Converse com outros agentes, crie grupos ou abra o chat de uma fila ou equipe."
              action={
                <Button size="sm" icon={Plus} onClick={() => setModalOpen(true)}>
                  Nova conversa
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-neutral-100">
              {chats.map((chat) => (
                <Link
                  key={chat.id}
                  to="/inbox/chat/$chatId"
                  params={{ chatId: chat.id }}
                  className="flex items-center gap-3 border-b border-neutral-50 px-4 py-3 transition-colors last:border-b-0 hover:bg-neutral-50"
                >
                  <ChatAvatar chat={chat} selfId={agent.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-dark-800">
                      {chatDisplayName(chat, agent.id)}
                    </p>
                    <p className="truncate text-xs text-neutral-400">
                      {chat.lastMessage ? chat.lastMessage.content : 'Nenhuma mensagem ainda'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {chat.lastMessage && (
                      <span className="text-[10px] text-neutral-400">
                        {formatChatTime(chat.lastMessage.createdAt)}
                      </span>
                    )}
                    {chat.unreadCount > 0 && (
                      <span className="grid min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <NewChatModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        selfId={agent.id}
        onCreated={reload}
      />
    </InboxShell>
  )
}

type Tab = 'dm' | 'group' | 'queue' | 'team'

const tabs: { id: Tab; label: string }[] = [
  { id: 'dm', label: 'Agente' },
  { id: 'group', label: 'Grupo' },
  { id: 'queue', label: 'Fila' },
  { id: 'team', label: 'Equipe' },
]

function NewChatModal({
  open,
  onClose,
  selfId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  selfId: string
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('dm')
  const [agents, setAgents] = useState<AdminAgentItem[]>([])
  const [queues, setQueues] = useState<QueueItem[]>([])
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [loadingLists, setLoadingLists] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [queueId, setQueueId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [creating, setCreating] = useState(false)

  // Carrega agentes/filas ao abrir. fetchAgentsAdmin é só para superadmin —
  // cai no fallback: membros das filas (qualquer agente pode listar).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setLoadingLists(true)
      let agentRows: AdminAgentItem[] = []
      try {
        agentRows = await fetchAgentsAdmin()
      } catch {
        agentRows = []
      }
      let queueRows: QueueItem[] = []
      try {
        queueRows = await fetchQueues()
      } catch {
        queueRows = []
      }
      let teamRows: TeamItem[] = []
      try {
        teamRows = await fetchTeams()
      } catch {
        teamRows = []
      }
      if (agentRows.length === 0 && queueRows.length > 0) {
        const seen = new Map<string, string>()
        for (const q of queueRows) {
          for (const m of q.members) seen.set(m.agentId, m.agentName)
        }
        agentRows = [...seen.entries()].map(([id, name]) => ({
          id,
          name,
          email: '',
          role: 'agent',
          activatedAt: null,
          lastLoginAt: null,
          createdAt: '',
        }))
      }
      if (!cancelled) {
        setAgents(agentRows)
        setQueues(queueRows)
        setTeams(teamRows)
        setLoadingLists(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open])

  async function openChat(data: Parameters<typeof createInternalChat>[0]['data']) {
    setCreating(true)
    // Se já existir (DM duplicado / chat de fila), a API devolve o existente.
    const { chat } = await createInternalChat({ data })
    setCreating(false)
    if (!chat) return
    onClose()
    onCreated()
    navigate({ to: '/inbox/chat/$chatId', params: { chatId: chat.id } })
  }

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]))
  }

  const otherAgents = agents.filter((a) => a.id !== selfId)

  return (
    <Modal open={open} onClose={onClose} title="Nova conversa">
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral-50 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? 'bg-neutral-0 text-brand-600 shadow-sm' : 'text-neutral-500 hover:text-dark-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadingLists ? (
        <div className="grid place-items-center py-10 text-neutral-300">
          <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      ) : tab === 'dm' ? (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {otherAgents.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">Nenhum outro agente no workspace.</p>
          ) : (
            otherAgents.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={creating}
                onClick={() => openChat({ kind: 'dm', agentIds: [a.id] })}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-neutral-50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-[11px] font-bold text-dark-800">
                  {getInitials(a.name)}
                </span>
                <span className="truncate text-sm font-medium text-dark-800">{a.name}</span>
              </button>
            ))
          )}
        </div>
      ) : tab === 'group' ? (
        <div className="space-y-3">
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Nome do grupo"
            className="w-full"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {otherAgents.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(a.id)}
                  onChange={() => toggleSelected(a.id)}
                  className="size-4 accent-brand-500"
                />
                <span className="truncate text-sm font-medium text-dark-800">{a.name}</span>
              </label>
            ))}
          </div>
          <Button
            className="w-full"
            loading={creating}
            disabled={!groupName.trim() || selected.length < 2}
            onClick={() => openChat({ kind: 'group', agentIds: selected, name: groupName.trim() })}
          >
            Criar grupo
          </Button>
        </div>
      ) : tab === 'queue' ? (
        <div className="space-y-3">
          {queues.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">Nenhuma fila disponível.</p>
          ) : (
            <select value={queueId} onChange={(e) => setQueueId(e.target.value)} className="w-full">
              <option value="">Selecione uma fila…</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          )}
          <Button
            className="w-full"
            loading={creating}
            disabled={!queueId}
            onClick={() => openChat({ kind: 'queue', queueId })}
          >
            Abrir chat da fila
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">Nenhuma equipe disponível.</p>
          ) : (
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full">
              <option value="">Selecione uma equipe…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Button
            className="w-full"
            loading={creating}
            disabled={!teamId}
            onClick={() => openChat({ kind: 'team', teamId })}
          >
            Abrir chat da equipe
          </Button>
        </div>
      )}
    </Modal>
  )
}
