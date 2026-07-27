import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ListTree, Pencil, Plus, Trash2, Users, UsersRound } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, EmptyState, Modal, getInitials } from '../../../components/ui'
import {
  createTeam,
  deleteTeam,
  fetchAgentsAdmin,
  fetchTeams,
  getInboxAgent,
  setTeamMembers,
  updateTeam,
  type AdminAgentItem,
  type TeamItem,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/equipes')({
  head: () => createHeadConfig('Equipes — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const [teams, agents] = await Promise.all([fetchTeams(), fetchAgentsAdmin()])
    return { agent, teams, agents }
  },
  component: AdminTeams,
})

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

function AdminTeams() {
  const initial = Route.useLoaderData()
  const [teams, setTeams] = useState<TeamItem[]>(initial.teams)
  const [agents] = useState<AdminAgentItem[]>(initial.agents)
  const [editorTeam, setEditorTeam] = useState<TeamItem | null | 'new'>(null)
  const [membersTeam, setMembersTeam] = useState<TeamItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setTeams(await fetchTeams())
  }

  async function handleDelete(team: TeamItem) {
    const extra =
      team.queues.length > 0
        ? ` As filas vinculadas (${team.queues.map((q) => q.name).join(', ')}) ficam sem equipe.`
        : ''
    if (!window.confirm(`Excluir a equipe "${team.name}"?${extra}`)) return
    setBusyId(team.id)
    setError(null)
    await deleteTeam({ data: { teamId: team.id } })
    setBusyId(null)
    await reload()
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Equipes</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Agrupe agentes em equipes e vincule-as às filas — a equipe responde pelas conversas da fila.
              </p>
            </div>
            <Button icon={Plus} onClick={() => setEditorTeam('new')}>
              Nova equipe
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm font-medium text-error-500">
              {error}
            </div>
          )}

          {teams.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="Nenhuma equipe ainda"
              description="Crie equipes como Comercial ou Suporte N1 para organizar os agentes e as filas."
              action={
                <Button icon={Plus} onClick={() => setEditorTeam('new')}>
                  Nova equipe
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {teams.map((team) => (
                <div key={team.id} className="flex flex-col rounded-lg border border-neutral-200 bg-neutral-0 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: team.color }}
                        aria-hidden="true"
                      />
                      <p className="truncate text-sm font-semibold text-dark-800">{team.name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditorTeam(team)}
                        aria-label={`Editar ${team.name}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(team)}
                        disabled={busyId === team.id}
                        aria-label={`Excluir ${team.name}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-error-500/10 hover:text-error-500 disabled:opacity-50"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 min-h-5 text-xs text-neutral-500">{team.description ?? 'Sem descrição.'}</p>

                  {team.queues.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {team.queues.map((queue) => (
                        <span
                          key={queue.id}
                          className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600"
                        >
                          <ListTree size={11} aria-hidden="true" />
                          {queue.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {team.members.length === 0 ? (
                        <span className="text-xs text-neutral-400">Sem membros</span>
                      ) : (
                        <>
                          <div className="flex -space-x-1.5">
                            {team.members.slice(0, 5).map((member) => (
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
                            {team.members.length} {team.members.length === 1 ? 'membro' : 'membros'}
                          </span>
                        </>
                      )}
                    </div>
                    <Button variant="secondary" size="sm" icon={Users} onClick={() => setMembersTeam(team)}>
                      Membros
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <TeamEditorModal
        team={editorTeam === 'new' ? null : editorTeam}
        open={editorTeam !== null}
        onClose={() => setEditorTeam(null)}
        onSaved={async () => {
          setEditorTeam(null)
          await reload()
        }}
        onError={setError}
      />

      <TeamMembersModal
        team={membersTeam}
        agents={agents}
        onClose={() => setMembersTeam(null)}
        onSaved={async () => {
          setMembersTeam(null)
          await reload()
        }}
      />
    </InboxShell>
  )
}

function TeamEditorModal({
  team,
  open,
  onClose,
  onSaved,
  onError,
}: {
  team: TeamItem | null
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const editing = team !== null
  const [name, setName] = useState('')
  const [color, setColor] = useState('#DD5973')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Preenche o formulário ao abrir (criação = vazio, edição = dados da equipe).
  const formKey = open ? (team?.id ?? 'new') : null
  if (formKey && loadedFor !== formKey) {
    setLoadedFor(formKey)
    setName(team?.name ?? '')
    setColor(team?.color ?? '#DD5973')
    setDescription(team?.description ?? '')
    setFormError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setFormError(null)
    const payload = { name: name.trim(), color, description: description.trim() || undefined }
    const saved = editing
      ? await updateTeam({ data: { teamId: team.id, ...payload } })
      : await createTeam({ data: payload })
    setSaving(false)
    if (!saved) {
      setFormError('Não foi possível salvar a equipe. Tente novamente.')
      return
    }
    onError(null)
    await onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar equipe' : 'Nova equipe'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="team-name" className="mb-1.5 block text-sm font-medium text-dark-800">
            Nome
          </label>
          <input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Comercial"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="team-color" className="mb-1.5 block text-sm font-medium text-dark-800">
            Cor
          </label>
          <div className="flex items-center gap-3">
            <input
              id="team-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-neutral-300 bg-neutral-0 p-1"
            />
            <span className="font-mono text-xs text-neutral-500">{color}</span>
          </div>
        </div>

        <div>
          <label htmlFor="team-description" className="mb-1.5 block text-sm font-medium text-dark-800">
            Descrição <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <textarea
            id="team-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: Time de vendas do varejo"
            rows={2}
            className="w-full resize-none rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {formError && <p className="text-sm font-medium text-error-500">{formError}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>
            {editing ? 'Salvar' : 'Criar equipe'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function TeamMembersModal({
  team,
  agents,
  onClose,
  onSaved,
}: {
  team: TeamItem | null
  agents: AdminAgentItem[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Seleção inicial = membros atuais da equipe.
  if (team && loadedFor !== team.id) {
    setLoadedFor(team.id)
    setSelected(new Set(team.members.map((m) => m.agentId)))
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
    if (!team) return
    setSaving(true)
    await setTeamMembers({ data: { teamId: team.id, agentIds: [...selected] } })
    setSaving(false)
    await onSaved()
  }

  return (
    <Modal open={team !== null} onClose={onClose} title={`Membros de ${team?.name ?? ''}`}>
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
