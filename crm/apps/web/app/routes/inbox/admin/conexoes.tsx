import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { MessageCircle, MessageSquareText, Plug, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, EmptyState, Modal } from '../../../components/ui'
import {
  createConnectionInbox,
  deleteConnectionInbox,
  fetchConnectionsAdmin,
  fetchConnectionStatus,
  fetchQueues,
  getInboxAgent,
  reconnectConnectionInbox,
  updateConnectionInbox,
  type AdminConnectionItem,
  type QueueItem,
} from '../../../lib/inbox-session'
import { useInboxSocket } from '../../../lib/use-inbox-socket'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/conexoes')({
  head: () => createHeadConfig('Conexões — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const [connections, queues] = await Promise.all([fetchConnectionsAdmin(), fetchQueues()])
    return { agent, connections, queues }
  },
  component: AdminConnections,
})

const channelMeta = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, className: 'text-emerald-600' },
  telegram: { label: 'Telegram', icon: Send, className: 'text-blue-500' },
} as const

const statusMeta: Record<AdminConnectionItem['status'], { label: string; className: string }> = {
  active: { label: 'Ativa', className: 'bg-success-500/10 text-success-500' },
  error: { label: 'Erro', className: 'bg-error-500/10 text-error-500' },
  disconnected: { label: 'Desconectada', className: 'bg-neutral-100 text-neutral-500' },
}

function AdminConnections() {
  const initial = Route.useLoaderData()
  const [connections, setConnections] = useState<AdminConnectionItem[]>(initial.connections)
  const [queues] = useState<QueueItem[]>(initial.queues)
  const [createOpen, setCreateOpen] = useState(false)
  const [qrConnection, setQrConnection] = useState<AdminConnectionItem | null>(null)
  const [welcomeTarget, setWelcomeTarget] = useState<AdminConnectionItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const queueName = (id: string | null) => queues.find((q) => q.id === id)?.name ?? null

  async function reload() {
    setConnections(await fetchConnectionsAdmin())
  }

  // Tempo real: mudança de status de qualquer conexão recarrega a lista.
  useInboxSocket((event) => {
    if (event.type === 'connection:status') reload()
  })

  async function handleReconnect(connection: AdminConnectionItem) {
    setBusyId(connection.id)
    setError(null)
    await reconnectConnectionInbox({ data: { connectionId: connection.id } })
    setBusyId(null)
    // WhatsApp reabre o fluxo de QR; Telegram reconecta direto.
    if (connection.kind === 'whatsapp') setQrConnection(connection)
    await reload()
  }

  async function handleDelete(connection: AdminConnectionItem) {
    if (!window.confirm(`Excluir a conexão "${connection.name}"? As conversas já recebidas são mantidas.`)) return
    setBusyId(connection.id)
    setError(null)
    await deleteConnectionInbox({ data: { connectionId: connection.id } })
    setBusyId(null)
    await reload()
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Conexões</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Canais de atendimento do workspace — cada conversa chega por uma destas conexões.
              </p>
            </div>
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              Nova conexão
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm font-medium text-error-500">
              {error}
            </div>
          )}

          {connections.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="Nenhuma conexão ainda"
              description="Conecte um número de WhatsApp ou um bot do Telegram para começar a receber conversas."
              action={
                <Button icon={Plus} onClick={() => setCreateOpen(true)}>
                  Nova conexão
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => {
                const channel = channelMeta[connection.kind]
                const status = statusMeta[connection.status] ?? statusMeta.disconnected
                const ChannelIcon = channel.icon
                const defaultQueue = queueName(connection.defaultQueueId)
                return (
                  <div
                    key={connection.id}
                    className="flex flex-wrap items-center gap-4 rounded-lg border border-neutral-200 bg-neutral-0 px-5 py-4"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-neutral-100">
                      <ChannelIcon size={18} className={channel.className} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-dark-800">{connection.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {channel.label}
                        {defaultQueue ? ` · Fila padrão: ${defaultQueue}` : ' · Sem fila padrão'}
                        {connection.welcomeMessage ? ' · Boas-vindas configurada' : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={MessageSquareText}
                        onClick={() => setWelcomeTarget(connection)}
                      >
                        Boas-vindas
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={RefreshCw}
                        loading={busyId === connection.id}
                        onClick={() => handleReconnect(connection)}
                      >
                        Reconectar
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleDelete(connection)}
                        disabled={busyId === connection.id}
                        aria-label={`Excluir ${connection.name}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-error-500/10 hover:text-error-500 disabled:opacity-50"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <CreateConnectionModal
        open={createOpen}
        queues={queues}
        onClose={() => setCreateOpen(false)}
        onCreated={async (connection) => {
          setCreateOpen(false)
          await reload()
          if (connection.kind === 'whatsapp') setQrConnection(connection)
        }}
        onError={setError}
      />

      <QrModal connection={qrConnection} onClose={() => setQrConnection(null)} />

      <WelcomeMessageModal
        connection={welcomeTarget}
        onClose={() => setWelcomeTarget(null)}
        onSaved={(connectionId, welcomeMessage) => {
          setConnections((list) => list.map((c) => (c.id === connectionId ? { ...c, welcomeMessage } : c)))
          setWelcomeTarget(null)
        }}
        onError={setError}
      />
    </InboxShell>
  )
}

// Mensagem de boas-vindas da conexão: enviada só em conversa NOVA e apenas
// quando nenhum bot atende primeiro. Vazio = desativada.
function WelcomeMessageModal({
  connection,
  onClose,
  onSaved,
  onError,
}: {
  connection: AdminConnectionItem | null
  onClose: () => void
  onSaved: (connectionId: string, welcomeMessage: string | null) => void
  onError: (message: string | null) => void
}) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const connectionId = connection?.id ?? null

  // Preenche o campo ao trocar de conexão.
  useEffect(() => {
    setMessage(connection?.welcomeMessage ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  async function handleSave() {
    if (!connection) return
    setSaving(true)
    onError(null)
    const result = await updateConnectionInbox({
      data: { connectionId: connection.id, welcomeMessage: message.trim() || null },
    })
    setSaving(false)
    if (!result.ok) {
      onError('Não foi possível salvar a mensagem de boas-vindas. Tente novamente.')
      return
    }
    onSaved(connection.id, result.welcomeMessage)
  }

  return (
    <Modal
      open={connection !== null}
      onClose={onClose}
      title={`Boas-vindas — ${connection?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={handleSave}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <label htmlFor="welcome-message" className="block text-sm font-medium text-dark-800">
          Mensagem de boas-vindas <span className="font-normal text-neutral-400">(opcional)</span>
        </label>
        <textarea
          id="welcome-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Olá! Recebemos sua mensagem e já vamos te atender."
          className="w-full resize-y rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        <p className="text-xs leading-relaxed text-neutral-400">
          Enviada automaticamente quando uma conversa nova chega por esta conexão — mas só se
          nenhum bot atender primeiro. Deixe vazio para desativar.
        </p>
      </div>
    </Modal>
  )
}

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

function CreateConnectionModal({
  open,
  queues,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean
  queues: QueueItem[]
  onClose: () => void
  onCreated: (connection: AdminConnectionItem) => Promise<void>
  onError: (message: string | null) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'whatsapp' | 'telegram'>('whatsapp')
  const [token, setToken] = useState('')
  const [defaultQueueId, setDefaultQueueId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setFormError(null)
    const connection = await createConnectionInbox({
      data: {
        name: name.trim(),
        kind,
        token: kind === 'telegram' ? token.trim() : undefined,
        defaultQueueId: defaultQueueId || undefined,
      },
    })
    setSaving(false)
    if (!connection) {
      // A API recusa quando o plano atinge o limite de conexões.
      setFormError('Não foi possível criar a conexão. Verifique o limite de conexões do seu plano — faça upgrade para adicionar mais canais.')
      return
    }
    onError(null)
    setName('')
    setToken('')
    setDefaultQueueId('')
    setKind('whatsapp')
    await onCreated(connection)
  }

  return (
    <Modal open={open} onClose={onClose} title="Nova conexão">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="conn-name" className="mb-1.5 block text-sm font-medium text-dark-800">
            Nome
          </label>
          <input
            id="conn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: WhatsApp comercial"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="conn-kind" className="mb-1.5 block text-sm font-medium text-dark-800">
            Canal
          </label>
          <select
            id="conn-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'whatsapp' | 'telegram')}
            className={inputClass}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
          </select>
        </div>

        {kind === 'telegram' && (
          <div>
            <label htmlFor="conn-token" className="mb-1.5 block text-sm font-medium text-dark-800">
              Token do bot
            </label>
            <input
              id="conn-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token gerado pelo @BotFather"
              required
              className={inputClass}
            />
          </div>
        )}

        <div>
          <label htmlFor="conn-queue" className="mb-1.5 block text-sm font-medium text-dark-800">
            Fila padrão <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <select
            id="conn-queue"
            value={defaultQueueId}
            onChange={(e) => setDefaultQueueId(e.target.value)}
            className={inputClass}
          >
            <option value="">Sem fila padrão</option>
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-neutral-400">
            Conversas novas deste canal entram direto nesta fila.
          </p>
        </div>

        {formError && <p className="text-sm font-medium text-error-500">{formError}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>
            Criar conexão
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function QrModal({ connection, onClose }: { connection: AdminConnectionItem | null; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const connectionId = connection?.id ?? null

  // Reseta o estado a cada nova conexão.
  useEffect(() => {
    setQr(null)
    setConnected(false)
  }, [connectionId])

  // Tempo real: o session-host empurra o QR pelo WS (evento session:qr).
  useInboxSocket((event) => {
    if (!connectionId) return
    if (event.type === 'session:qr' && event.connectionId === connectionId) {
      setQr(event.qr)
    }
    if (event.type === 'connection:status' && event.connectionId === connectionId && event.status === 'active') {
      setConnected(true)
    }
  })

  // Fallback: polling a cada 5s enquanto o modal estiver aberto (cobre queda do WS).
  useEffect(() => {
    if (!connectionId || connected) return
    let cancelled = false
    async function poll() {
      const status = await fetchConnectionStatus({ data: { connectionId: connectionId! } })
      if (cancelled) return
      if (status.qr) setQr(status.qr)
      if (status.socketStatus === 'connected') setConnected(true)
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [connectionId, connected])

  return (
    <Modal open={connection !== null} onClose={onClose} title="Conectar WhatsApp">
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {connected ? (
          <>
            <span className="grid size-12 place-items-center rounded-full bg-success-500/10 text-success-500">
              <MessageCircle size={22} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-dark-800">WhatsApp conectado</p>
              <p className="mt-1 text-sm text-neutral-500">
                {connection?.name} já está recebendo mensagens.
              </p>
            </div>
            <Button onClick={onClose}>Concluir</Button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-2xs">
              {qr ? (
                <QRCode value={qr} size={192} />
              ) : (
                <div className="grid size-48 place-items-center">
                  <span className="size-7 animate-spin rounded-full border-2 border-dark-800 border-t-transparent" />
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-dark-800">
                {qr ? 'Escaneie o QR Code com o WhatsApp' : 'Gerando QR Code…'}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                No celular, abra WhatsApp → Aparelhos conectados → Conectar aparelho.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
