import { useEffect, useState } from 'react'
import { ListTree, User } from 'lucide-react'
import { Button, Modal } from '../ui'
import {
  fetchAgentsAdmin,
  fetchQueues,
  transferConversation,
  type QueueItem,
} from '../../lib/inbox-session'

type AgentOption = { id: string; name: string }
type Tab = 'agent' | 'queue'

// Modal de transferência da conversa: destino = agente OU fila (exatamente
// um), com nota opcional. A lista de agentes vem de fetchAgentsAdmin; como
// essa rota é superadmin-only (403 → lista vazia), o fallback extrai os
// agentes dos membros das filas (fetchQueues).
export function TransferModal({
  open,
  onClose,
  conversationId,
  currentAgentId,
  onTransferred,
}: {
  open: boolean
  onClose: () => void
  conversationId: string
  currentAgentId: string
  onTransferred: () => void
}) {
  const [tab, setTab] = useState<Tab>('agent')
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [queues, setQueues] = useState<QueueItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('agent')
    setSelected(null)
    setNote('')
    setLoading(true)
    Promise.all([fetchAgentsAdmin(), fetchQueues()]).then(([agentRows, queueRows]) => {
      const byId = new Map<string, string>()
      for (const a of agentRows) byId.set(a.id, a.name)
      // Fallback para não-superadmin: admin.agents responde 403 (lista vazia)
      // — monta a lista a partir dos membros das filas.
      for (const q of queueRows) {
        for (const m of q.members) {
          if (!byId.has(m.agentId)) byId.set(m.agentId, m.agentName)
        }
      }
      setAgents(
        [...byId]
          .map(([id, name]) => ({ id, name }))
          .filter((a) => a.id !== currentAgentId)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      )
      setQueues(queueRows)
      setLoading(false)
    })
  }, [open, currentAgentId])

  async function handleTransfer() {
    if (!selected || saving) return
    setSaving(true)
    await transferConversation({
      data: {
        conversationId,
        toAgentId: tab === 'agent' ? selected : undefined,
        toQueueId: tab === 'queue' ? selected : undefined,
        note: note.trim() || undefined,
      },
    })
    setSaving(false)
    onClose()
    onTransferred()
  }

  const options: { id: string; label: string; hint?: string }[] =
    tab === 'agent'
      ? agents.map((a) => ({ id: a.id, label: a.name }))
      : queues.map((q) => ({
          id: q.id,
          label: q.name,
          hint: q.members.length > 0 ? `${q.members.length} agente${q.members.length === 1 ? '' : 's'}` : 'Sem agentes',
        }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transferir conversa"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} disabled={!selected || loading} onClick={handleTransfer}>
            Transferir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          {(['agent', 'queue'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t)
                setSelected(null)
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t ? 'bg-neutral-0 text-dark-800 shadow-2xs' : 'text-neutral-500 hover:text-dark-800'
              }`}
            >
              {t === 'agent' ? 'Agente' : 'Fila'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid place-items-center py-8 text-neutral-300">
            <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </div>
        ) : options.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            {tab === 'agent' ? 'Nenhum outro agente disponível.' : 'Nenhuma fila disponível.'}
          </p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {options.map((opt) => {
              const Icon = tab === 'agent' ? User : ListTree
              const active = selected === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelected(opt.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-brand-500 bg-brand-50 text-dark-800'
                      : 'border-neutral-200 text-dark-800 hover:bg-neutral-50'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-brand-600' : 'text-neutral-400'} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                  {opt.hint && <span className="shrink-0 text-xs text-neutral-400">{opt.hint}</span>}
                </button>
              )
            })}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="transfer-note" className="block text-sm font-medium text-dark-800">
            Nota <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <textarea
            id="transfer-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: cliente pediu especialista em cobrança"
            rows={2}
            maxLength={500}
            className="w-full resize-none rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </div>
    </Modal>
  )
}
