import { createFileRoute, useLoaderData, useRouter, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Users, UserPlus, Mail, Trash2, AlertCircle, Shield, User as UserIcon, RotateCw, X } from 'lucide-react'
import { fetchAgents, createAgent, deleteAgent, resendActivation, type AgentItem } from '../../../lib/actions'
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, StatusBadge } from '../../../components/ui'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/agents')({
  head: () => createHeadConfig('Agentes — Naia CRM'),
  loader: async ({ params }) => {
    const agents = await fetchAgents({ data: { workspaceId: params.workspaceId } })
    return { agents }
  },
  component: AgentsPage,
})

function formatLastLogin(iso: string | null) {
  if (!iso) return 'Nunca acessou'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function AgentsPage() {
  const { workspaceId } = Route.useParams()
  const { agents } = Route.useLoaderData()
  const { entitlements, workspace } = useLoaderData({ from: '/_app/$workspaceId' })
  const router = useRouter()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'agent'>('agent')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const limit = entitlements?.agentsLimit ?? 0
  const atLimit = limit >= 0 && agents.length >= limit
  const usage = limit > 0 ? Math.min(100, Math.round((agents.length / limit) * 100)) : 0

  const activeAgents = agents.filter((a) => a.activatedAt)
  const pendingAgents = agents.filter((a) => !a.activatedAt)

  async function refresh() {
    await router.invalidate()
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setSaving(true)
    setMessage(null)
    const result = await createAgent({
      data: { workspaceId, name: name.trim(), email: email.trim(), role },
    })
    setSaving(false)
    if (!result.agentId) {
      setMessage(result.message ?? 'Erro ao criar agente.')
      return
    }
    setMessage('Convite enviado por e-mail com sucesso.')
    setName('')
    setEmail('')
    setRole('agent')
    setShowCreateForm(false)
    await refresh()
  }

  async function handleResend(agent: AgentItem) {
    await resendActivation({ data: { workspaceId, agentId: agent.id } })
    setMessage(`Convite reenviado para ${agent.email}.`)
  }

  async function handleDelete(agent: AgentItem) {
    if (!confirm(`Remover ${agent.name}? Esta ação não pode ser desfeita.`)) return
    await deleteAgent({ data: { workspaceId, agentId: agent.id } })
    await refresh()
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-20">
      <PageHeader
        title="Equipe de atendimento"
        subtitle={
          <>
            Gerencie os agentes que acessam o inbox e atendem as conversas do workspace{' '}
            <strong className="text-dark-800">{workspace.name}</strong>.
          </>
        }
      >
        <Button icon={UserPlus} onClick={() => setShowCreateForm((v) => !v)} disabled={atLimit}>
          Criar agente
        </Button>
      </PageHeader>

      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-0 px-5 py-4 shadow-2xs sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-neutral-100 font-mono text-sm font-bold text-dark-800">
            {agents.length}/{limit}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-dark-800">Uso de assentos</span>
              <Badge className="border-neutral-200 bg-neutral-100 text-neutral-600">
                Plano {entitlements?.plan ?? 'free'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {atLimit
                ? 'Você atingiu o limite de agentes do plano. Faça upgrade para ampliar a equipe.'
                : `Você ainda pode criar ${Math.max(0, limit - agents.length)} agente(s).`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="h-2 w-36 overflow-hidden rounded-full bg-neutral-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${atLimit ? 'bg-error-500' : 'bg-dark-800'}`}
              style={{ width: `${usage}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs font-bold text-neutral-600">{usage}%</span>
          {atLimit && (
            <Link
              to="/$workspaceId/billing"
              params={{ workspaceId }}
              className="rounded-xl bg-dark-800 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-dark-900"
            >
              Expandir assentos
            </Link>
          )}
        </div>
      </div>

      {message && (
        <div className="animate-in flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3 text-xs font-semibold text-white shadow-md">
          <span className="break-all">{message}</span>
          <button onClick={() => setMessage(null)} className="ml-4 text-neutral-400 hover:text-white">
            Fechar
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="animate-in space-y-4 rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xs">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h3 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
              <UserPlus size={16} className="text-dark-800" />
              <span>Convidar agente por e-mail</span>
            </h3>
            <button onClick={() => setShowCreateForm(false)} className="text-neutral-400 hover:text-dark-800" aria-label="Fechar">
              <X size={16} />
            </button>
          </div>

          {atLimit ? (
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs font-medium text-neutral-600">
              <div className="flex items-center gap-2 font-bold text-dark-800">
                <AlertCircle size={15} className="text-error-500" />
                <span>Limite de agentes atingido no plano {entitlements?.plan ?? 'free'}</span>
              </div>
              <p>Para adicionar novos agentes à equipe de atendimento, faça upgrade na página de planos.</p>
              <Link
                to="/$workspaceId/billing"
                params={{ workspaceId }}
                className="inline-flex items-center gap-1 pt-1 font-bold text-dark-800 underline"
              >
                Gerenciar assentos no billing ›
              </Link>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="agent-name">Nome *</label>
                <input
                  id="agent-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Maria Silva"
                  maxLength={80}
                />
              </div>
              <div>
                <label htmlFor="agent-email">E-mail *</label>
                <input
                  id="agent-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="maria@suaempresa.com"
                />
                <p className="mt-1.5 text-xs text-neutral-400">O link para definir a senha será enviado para este e-mail.</p>
              </div>
              <div>
                <label htmlFor="agent-role">Papel</label>
                <select
                  id="agent-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'agent')}
                >
                  <option value="agent">Agente (Atendimento)</option>
                  <option value="admin">Admin (Gestão da equipe)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 border-t border-neutral-100 pt-2 sm:col-span-3">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-neutral-500 transition-colors hover:bg-neutral-100"
                >
                  Cancelar
                </button>
                <Button type="submit" icon={Mail} loading={saving} disabled={!name.trim() || !email.trim()}>
                  Criar e enviar convite
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum agente ainda"
          description="Crie contas para sua equipe acessar o inbox e atender clientes."
          action={
            <Button icon={UserPlus} onClick={() => setShowCreateForm(true)}>
              Criar agente
            </Button>
          }
        />
      ) : (
        <>
          {activeAgents.length > 0 && (
            <Card className="overflow-hidden rounded-2xl shadow-2xs">
              <div className="border-b border-neutral-200/80 bg-neutral-50/50 p-5">
                <h2 className="font-display text-base font-bold text-dark-800">
                  Agentes ativos ({activeAgents.length})
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Contas com acesso ao atendimento deste workspace
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-neutral-200/80 bg-neutral-50/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="py-3.5 pl-6 pr-4">Agente</th>
                      <th className="px-4 py-3.5">E-mail de acesso</th>
                      <th className="px-4 py-3.5">Papel</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5">Último acesso</th>
                      <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
                    {activeAgents.map((agent) => (
                      <tr key={agent.id} className="transition-colors hover:bg-neutral-50/80">
                        <td className="py-4 pl-6 pr-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={agent.name} size="sm" />
                            <span className="block truncate text-sm font-bold text-dark-800">{agent.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-neutral-600">{agent.email}</td>
                        <td className="px-4 py-4">
                          <RoleBadge role={agent.role} />
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status="active" />
                        </td>
                        <td className="px-4 py-4 text-xs text-neutral-500">{formatLastLogin(agent.lastLoginAt)}</td>
                        <td className="py-4 pl-4 pr-6 text-right">
                          <button
                            onClick={() => handleDelete(agent)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-neutral-400 transition-colors hover:bg-error-50 hover:text-error-600"
                          >
                            <Trash2 size={13} />
                            <span>Remover</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {pendingAgents.length > 0 && (
            <Card className="overflow-hidden rounded-2xl shadow-2xs">
              <div className="border-b border-neutral-200/80 bg-neutral-50/50 p-5">
                <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
                  <Mail size={16} className="text-dark-800" />
                  <span>Convites pendentes ({pendingAgents.length})</span>
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500">Aguardando ativação por parte do agente</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-neutral-200/80 bg-neutral-50/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="py-3.5 pl-6 pr-4">Agente</th>
                      <th className="px-4 py-3.5">E-mail convidado</th>
                      <th className="px-4 py-3.5">Papel</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
                    {pendingAgents.map((agent) => (
                      <tr key={agent.id} className="transition-colors hover:bg-neutral-50/80">
                        <td className="py-4 pl-6 pr-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={agent.name} size="sm" />
                            <span className="block truncate text-sm font-bold text-dark-800">{agent.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs font-bold text-dark-800">{agent.email}</td>
                        <td className="px-4 py-4">
                          <RoleBadge role={agent.role} />
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status="pending" />
                        </td>
                        <td className="py-4 pl-4 pr-6 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => handleResend(agent)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                            >
                              <RotateCw size={13} />
                              <span>Reenviar</span>
                            </button>
                            <button
                              onClick={() => handleDelete(agent)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-error-600 transition-colors hover:bg-error-50"
                            >
                              <Trash2 size={13} />
                              <span>Remover</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function RoleBadge({ role }: { role: 'superadmin' | 'admin' | 'agent' }) {
  return (
    <Badge
      className={
        role === 'superadmin'
          ? 'border-brand-200 bg-brand-500 text-white'
          : role === 'admin'
            ? 'border-brand-200 bg-brand-50 text-brand-600'
            : 'border-neutral-200 bg-neutral-100 text-neutral-600'
      }
    >
      {role === 'agent' ? <UserIcon size={10} aria-hidden="true" /> : <Shield size={10} aria-hidden="true" />}
      {role === 'superadmin' ? 'Superadmin' : role === 'admin' ? 'Admin' : 'Agente'}
    </Badge>
  )
}
