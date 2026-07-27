import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ListTree, Pencil, Plus, Trash2, Users, UsersRound } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, EmptyState, Modal, getInitials } from '../../../components/ui'
import {
  assignQueueTeam,
  createQueue,
  deleteQueue,
  fetchAgentsAdmin,
  fetchQueues,
  fetchTeams,
  getInboxAgent,
  setQueueMembers,
  updateQueue,
  type AdminAgentItem,
  type QueueItem,
  type TeamItem,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/filas')({
  head: () => createHeadConfig('Filas — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const [queues, agents, teams] = await Promise.all([fetchQueues(), fetchAgentsAdmin(), fetchTeams()])
    return { agent, queues, agents, teams }
  },
  component: AdminQueues,
})

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

function AdminQueues() {
  const initial = Route.useLoaderData()
  const [queues, setQueues] = useState<QueueItem[]>(initial.queues)
  const [agents] = useState<AdminAgentItem[]>(initial.agents)
  const [teams, setTeams] = useState<TeamItem[]>(initial.teams)
  const [editorQueue, setEditorQueue] = useState<QueueItem | null | 'new'>(null)
  const [membersQueue, setMembersQueue] = useState<QueueItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A fila não carrega o teamId — o vínculo é derivado das equipes (team.queues).
  const teamByQueueId = new Map<string, TeamItem>()
  for (const team of teams) {
    for (const queue of team.queues) teamByQueueId.set(queue.id, team)
  }

  async function reload() {
    const [nextQueues, nextTeams] = await Promise.all([fetchQueues(), fetchTeams()])
    setQueues(nextQueues)
    setTeams(nextTeams)
  }

  async function handleDelete(queue: QueueItem) {
    if (!window.confirm(`Excluir a fila "${queue.name}"? As conversas dela ficam sem fila.`)) return
    setBusyId(queue.id)
    setError(null)
    await deleteQueue({ data: { queueId: queue.id } })
    setBusyId(null)
    await reload()
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Filas</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Organize o atendimento por equipe — conversas entram na fila e são pegas pelos membros.
              </p>
            </div>
            <Button icon={Plus} onClick={() => setEditorQueue('new')}>
              Nova fila
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm font-medium text-error-500">
              {error}
            </div>
          )}

          {queues.length === 0 ? (
            <EmptyState
              icon={ListTree}
              title="Nenhuma fila ainda"
              description="Crie filas como Vendas ou Suporte para distribuir as conversas entre os agentes."
              action={
                <Button icon={Plus} onClick={() => setEditorQueue('new')}>
                  Nova fila
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {queues.map((queue) => (
                <div key={queue.id} className="flex flex-col rounded-lg border border-neutral-200 bg-neutral-0 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: queue.color }}
                        aria-hidden="true"
                      />
                      <p className="truncate text-sm font-semibold text-dark-800">{queue.name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditorQueue(queue)}
                        aria-label={`Editar ${queue.name}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(queue)}
                        disabled={busyId === queue.id}
                        aria-label={`Excluir ${queue.name}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-error-500/10 hover:text-error-500 disabled:opacity-50"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 min-h-5 text-xs text-neutral-500">
                    {queue.description ?? 'Sem descrição.'}
                  </p>

                  {teamByQueueId.get(queue.id) && (
                    <div className="mt-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                        <UsersRound size={11} aria-hidden="true" />
                        {teamByQueueId.get(queue.id)!.name}
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {queue.members.length === 0 ? (
                        <span className="text-xs text-neutral-400">Sem membros</span>
                      ) : (
                        <>
                          <div className="flex -space-x-1.5">
                            {queue.members.slice(0, 5).map((member) => (
                              <span
                                key={member.agentId}
                                title={member.agentName}
                                className="grid size-7 place-items-center rounded-full bg-neutral-100 text-[10px] font-bold text-dark-800 ring-2 ring-neutral-0"
                              >
                                {getInitials(member.agentName)}
                              </span>
                            ))}
                          </div>
                          <span className="text-xs text-neutral-400">
                            {queue.members.length} {queue.members.length === 1 ? 'membro' : 'membros'}
                          </span>
                        </>
                      )}
                    </div>
                    <Button variant="secondary" size="sm" icon={Users} onClick={() => setMembersQueue(queue)}>
                      Membros
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <QueueEditorModal
        queue={editorQueue === 'new' ? null : editorQueue}
        teams={teams}
        currentTeamId={editorQueue && editorQueue !== 'new' ? (teamByQueueId.get(editorQueue.id)?.id ?? null) : null}
        open={editorQueue !== null}
        onClose={() => setEditorQueue(null)}
        onSaved={async () => {
          setEditorQueue(null)
          await reload()
        }}
        onError={setError}
      />

      <QueueMembersModal
        queue={membersQueue}
        agents={agents}
        onClose={() => setMembersQueue(null)}
        onSaved={async () => {
          setMembersQueue(null)
          await reload()
        }}
      />
    </InboxShell>
  )
}

function QueueEditorModal({
  queue,
  teams,
  currentTeamId,
  open,
  onClose,
  onSaved,
  onError,
}: {
  queue: QueueItem | null
  teams: TeamItem[]
  currentTeamId: string | null
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const editing = queue !== null
  const [name, setName] = useState('')
  const [color, setColor] = useState('#DD5973')
  const [description, setDescription] = useState('')
  const [teamId, setTeamId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Preenche o formulário ao abrir (criação = vazio, edição = dados da fila).
  const formKey = open ? (queue?.id ?? 'new') : null
  if (formKey && loadedFor !== formKey) {
    setLoadedFor(formKey)
    setName(queue?.name ?? '')
    setColor(queue?.color ?? '#DD5973')
    setDescription(queue?.description ?? '')
    setTeamId(currentTeamId ?? '')
    setFormError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setFormError(null)
    const payload = { name: name.trim(), color, description: description.trim() || undefined }
    const saved = editing
      ? await updateQueue({ data: { queueId: queue.id, ...payload } })
      : await createQueue({ data: payload })
    if (!saved) {
      setSaving(false)
      // A API recusa quando o plano atinge o limite de filas.
      setFormError(
        editing
          ? 'Não foi possível salvar a fila. Tente novamente.'
          : 'Não foi possível criar a fila. Verifique o limite de filas do seu plano — faça upgrade para criar mais.',
      )
      return
    }
    // Vínculo fila → equipe é um endpoint à parte (null = remove o vínculo).
    if ((teamId || null) !== currentTeamId) {
      await assignQueueTeam({ data: { queueId: saved.id, teamId: teamId || null } })
    }
    setSaving(false)
    onError(null)
    await onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar fila' : 'Nova fila'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="queue-name" className="mb-1.5 block text-sm font-medium text-dark-800">
            Nome
          </label>
          <input
            id="queue-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Suporte"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="queue-color" className="mb-1.5 block text-sm font-medium text-dark-800">
            Cor
          </label>
          <div className="flex items-center gap-3">
            <input
              id="queue-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-neutral-300 bg-neutral-0 p-1"
            />
            <span className="font-mono text-xs text-neutral-500">{color}</span>
          </div>
        </div>

        <div>
          <label htmlFor="queue-description" className="mb-1.5 block text-sm font-medium text-dark-800">
            Descrição <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <textarea
            id="queue-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: Conversas de suporte técnico"
            rows={2}
            className="w-full resize-none rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div>
          <label htmlFor="queue-team" className="mb-1.5 block text-sm font-medium text-dark-800">
            Equipe
          </label>
          <select
            id="queue-team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className={inputClass}
          >
            <option value="">Nenhuma</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-400">A equipe vinculada responde pelas conversas desta fila.</p>
        </div>

        {formError && <p className="text-sm font-medium text-error-500">{formError}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>
            {editing ? 'Salvar' : 'Criar fila'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function QueueMembersModal({
  queue,
  agents,
  onClose,
  onSaved,
}: {
  queue: QueueItem | null
  agents: AdminAgentItem[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Seleção inicial = membros atuais da fila.
  if (queue && loadedFor !== queue.id) {
    setLoadedFor(queue.id)
    setSelected(new Set(queue.members.map((m) => m.agentId)))
  }

  function toggle(agentId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  async function handleSave() {
    if (!queue) return
    setSaving(true)
    await setQueueMembers({ data: { queueId: queue.id, agentIds: [...selected] } })
    setSaving(false)
    await onSaved()
  }

  return (
    <Modal open={queue !== null} onClose={onClose} title={`Membros de ${queue?.name ?? ''}`}>
      <div className="space-y-1">
        {agents.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-400">Nenhum agente cadastrado.</p>
        ) : (
          agents.map((agent) => (
            <label
              key={agent.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-neutral-50"
            >
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                onChange={() => toggle(agent.id)}
                className="size-4 accent-brand-500"
              />
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-bold text-dark-800">
                {getInitials(agent.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-dark-800">{agent.name}</span>
                <span className="block truncate text-xs text-neutral-400">{agent.email}</span>
              </span>
            </label>
          ))
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={handleSave} loading={saving}>
          Salvar membros
        </Button>
      </div>
    </Modal>
  )
}
