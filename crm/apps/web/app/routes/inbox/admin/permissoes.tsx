import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { BarChart3, Check, Lock, MessagesSquare, ShieldCheck, Tags, Zap, type LucideIcon } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Switch } from '../../../components/ui'
import {
  fetchAgentPermissions,
  getInboxAgent,
  updateAgentPermissions,
  type AgentPermissionKey,
  type AgentPermissionsState,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/permissoes')({
  head: () => createHeadConfig('Permissões — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const permissions = await fetchAgentPermissions()
    return { agent, permissions }
  },
  component: AdminPermissions,
})

const PERMISSION_INFO: { key: AgentPermissionKey; icon: LucideIcon; label: string; description: string }[] = [
  {
    key: 'conversations_assign',
    icon: MessagesSquare,
    label: 'Atribuir conversas',
    description: 'Atribuir e transferir conversas para outros agentes e filas.',
  },
  {
    key: 'labels',
    icon: Tags,
    label: 'Etiquetas',
    description: 'Criar e aplicar etiquetas nas conversas.',
  },
  {
    key: 'quick_replies_manage',
    icon: Zap,
    label: 'Respostas rápidas',
    description: 'Criar e editar as respostas rápidas do workspace.',
  },
  {
    key: 'reports',
    icon: BarChart3,
    label: 'Relatórios',
    description: 'Acessar os relatórios de atendimento e funis.',
  },
]

type EditableRole = 'admin' | 'agent'

function AdminPermissions() {
  const initial = Route.useLoaderData()
  const [admin, setAdmin] = useState(initial.permissions.effective.admin)
  const [agent, setAgent] = useState(initial.permissions.effective.agent)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(role: EditableRole, key: AgentPermissionKey, value: boolean) {
    const previous = role === 'admin' ? admin : agent
    const next = { ...previous, [key]: value }
    if (role === 'admin') setAdmin(next)
    else setAgent(next)
    setError(null)

    const result: AgentPermissionsState = await updateAgentPermissions({
      data: role === 'admin' ? { admin: next } : { agent: next },
    })
    // Sem "effective" na resposta = a API recusou; reverte o toggle.
    if (!result?.effective) {
      if (role === 'admin') setAdmin(previous)
      else setAgent(previous)
      setError('Não foi possível salvar a permissão. Tente novamente.')
      return
    }
    setAdmin(result.effective.admin)
    setAgent(result.effective.agent)
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Permissões</h1>
            <p className="mt-1 text-sm text-neutral-500">
              O que cada papel pode fazer no inbox. As mudanças valem na hora.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0">
            <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-dark-800">
                <ShieldCheck size={16} aria-hidden="true" />
                O que cada papel pode acessar
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                O superadmin sempre tem acesso total — a matriz configurável vale para admin e agente.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="py-3 pl-5 pr-4">Área</th>
                    <th className="w-28 px-4 py-3 text-center">Superadmin</th>
                    <th className="w-28 px-4 py-3 text-center">Admin</th>
                    <th className="w-28 py-3 pl-4 pr-5 text-center">Agente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {PERMISSION_INFO.map(({ key, icon: Icon, label, description }) => (
                    <tr key={key} className="transition-colors hover:bg-neutral-50">
                      <td className="py-3.5 pl-5 pr-4">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
                            <Icon size={14} aria-hidden="true" />
                          </span>
                          <div>
                            <span className="block text-sm font-semibold text-dark-800">{label}</span>
                            <span className="block text-xs text-neutral-500">{description}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className="inline-flex items-center gap-1 text-neutral-400"
                          title="O superadmin sempre tem acesso total"
                        >
                          <Check size={15} className="text-success-500" aria-hidden="true" />
                          <Lock size={11} aria-hidden="true" />
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Switch
                          size="sm"
                          checked={admin[key]}
                          onChange={(value) => handleToggle('admin', key, value)}
                          aria-label={`${label} para admins`}
                        />
                      </td>
                      <td className="py-3.5 pl-4 pr-5 text-center">
                        <Switch
                          size="sm"
                          checked={agent[key]}
                          onChange={(value) => handleToggle('agent', key, value)}
                          aria-label={`${label} para agentes`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="border-t border-neutral-100 px-5 py-3 text-sm font-medium text-error-500">{error}</div>
            )}
          </div>
        </div>
      </div>
    </InboxShell>
  )
}
