import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { MailPlus, UserCog } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, Modal, getInitials } from '../../../components/ui'
import {
  fetchAgentsAdmin,
  getInboxAgent,
  resendAgentActivationInbox,
  updateAgentRole,
  type AdminAgentItem,
  type InboxAgentRole,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/agentes')({
  head: () => createHeadConfig('Agentes — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const agents = await fetchAgentsAdmin()
    return { agent, agents }
  },
  component: AdminAgents,
})

const roleMeta: Record<InboxAgentRole, { label: string; className: string }> = {
  superadmin: { label: 'Superadmin', className: 'bg-brand-50 text-brand-600' },
  admin: { label: 'Admin', className: 'bg-blue-50 text-blue-600' },
  agent: { label: 'Agente', className: 'bg-neutral-100 text-neutral-500' },
}

function formatLastLogin(value: string | null): string {
  if (!value) return 'Nunca acessou'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function AdminAgents() {
  const initial = Route.useLoaderData()
  const [agents, setAgents] = useState<AdminAgentItem[]>(initial.agents)
  const [roleTarget, setRoleTarget] = useState<AdminAgentItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function reload() {
    setAgents(await fetchAgentsAdmin())
  }

  async function handleResend(agent: AdminAgentItem) {
    setBusyId(agent.id)
    setMessage(null)
    await resendAgentActivationInbox({ data: { agentId: agent.id } })
    setBusyId(null)
    setMessage(`Email de ativação reenviado para ${agent.email}.`)
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Agentes</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Equipe de atendimento do inbox — novos agentes são convidados pelo painel de gestão do workspace.
            </p>
          </div>

          {message && (
            <div className="rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm font-medium text-success-500">
              {message}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-3 pl-5 pr-4">Agente</th>
                  <th className="px-4 py-3">Papel</th>
                  <th className="px-4 py-3">Último acesso</th>
                  <th className="py-3 pl-4 pr-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {agents.map((agent) => {
                  const role = roleMeta[agent.role] ?? roleMeta.agent
                  const isSelf = agent.id === initial.agent.id
                  return (
                    <tr key={agent.id} className="transition-colors hover:bg-neutral-50">
                      <td className="py-3.5 pl-5 pr-4">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-bold text-dark-800">
                            {getInitials(agent.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-dark-800">
                              {agent.name}
                              {isSelf && <span className="ml-1.5 text-xs font-normal text-neutral-400">(você)</span>}
                            </p>
                            <p className="truncate text-xs text-neutral-400">{agent.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${role.className}`}>
                          {role.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-neutral-500">{formatLastLogin(agent.lastLoginAt)}</td>
                      <td className="py-3.5 pl-4 pr-5">
                        <div className="flex items-center justify-end gap-2">
                          {!agent.activatedAt && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={MailPlus}
                              loading={busyId === agent.id}
                              onClick={() => handleResend(agent)}
                            >
                              Reenviar ativação
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={UserCog}
                            disabled={isSelf}
                            title={isSelf ? 'Você não pode alterar o próprio papel' : undefined}
                            onClick={() => setRoleTarget(agent)}
                          >
                            Alterar papel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <RoleModal
        agent={roleTarget}
        onClose={() => setRoleTarget(null)}
        onSaved={async () => {
          setRoleTarget(null)
          await reload()
        }}
      />
    </InboxShell>
  )
}

function RoleModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: AdminAgentItem | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [role, setRole] = useState<InboxAgentRole>('agent')
  const [saving, setSaving] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  if (agent && loadedFor !== agent.id) {
    setLoadedFor(agent.id)
    setRole(agent.role)
  }

  async function handleSave() {
    if (!agent) return
    setSaving(true)
    await updateAgentRole({ data: { agentId: agent.id, role } })
    setSaving(false)
    await onSaved()
  }

  return (
    <Modal open={agent !== null} onClose={onClose} title={`Papel de ${agent?.name ?? ''}`}>
      <div className="space-y-4">
        <div>
          <label htmlFor="agent-role" className="mb-1.5 block text-sm font-medium text-dark-800">
            Papel
          </label>
          <select
            id="agent-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InboxAgentRole)}
            className="h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="superadmin">Superadmin — acesso total, incluindo administração</option>
            <option value="admin">Admin — atende e gerencia áreas liberadas</option>
            <option value="agent">Agente — apenas atendimento</option>
          </select>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
