import { createFileRoute, useRouter, useLoaderData, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Users,
  UserPlus,
  Mail,
  Trash2,
  AlertCircle,
  CreditCard,
  Crown,
  Check,
  Files,
  Lock,
  Megaphone,
  Plug,
  Settings,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import type { PermissionKey, WorkspaceRolePermissions } from '@naia/schemas'
import {
  fetchMembers,
  fetchInvites,
  fetchPermissions,
  createInvite,
  revokeInvite,
  removeMember,
  updateMemberRole,
  updatePermissions,
} from '../../../lib/actions'
import { Avatar, Button, Switch } from '../../../components/ui'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/members')({ head: () => createHeadConfig('Membros — Naia Campanhas'),
  loader: async ({ params }) => {
    const [members, invites, permissionMatrix] = await Promise.all([
      fetchMembers({ data: params.workspaceId }),
      fetchInvites({ data: params.workspaceId }),
      fetchPermissions({ data: params.workspaceId }),
    ])
    return { members, invites, permissionMatrix }
  },
  component: MembersPage,
})

const PERMISSION_INFO: { key: PermissionKey; icon: typeof Users; label: string; description: string }[] = [
  { key: 'contacts', icon: UsersRound, label: 'Contatos', description: 'Base de contatos, tags e importações.' },
  { key: 'campaigns', icon: Megaphone, label: 'Campanhas', description: 'Criar, disparar e acompanhar campanhas.' },
  { key: 'connections', icon: Plug, label: 'Conexões', description: 'Conectar e remover canais (WhatsApp, Telegram).' },
  { key: 'members', icon: Users, label: 'Membros', description: 'Convidar, remover e definir papéis da equipe.' },
  { key: 'billing', icon: CreditCard, label: 'Assinatura', description: 'Planos, add-ons e cobrança do workspace.' },
  { key: 'files', icon: Files, label: 'Arquivos', description: 'Mídias e documentos enviados para o workspace.' },
  { key: 'settings', icon: Settings, label: 'Configurações', description: 'Nome, avatar e informações do workspace.' },
]

const ROLE_LABELS: Record<string, { label: string; badge: string }> = {
  owner: { label: 'Proprietário', badge: 'bg-amber-50 text-amber-800 border-amber-200/80' },
  admin: { label: 'Administrador', badge: 'bg-purple-50 text-purple-800 border-purple-200/80' },
  member: { label: 'Membro', badge: 'bg-neutral-100 text-neutral-700 border-neutral-200/80' },
}

function MembersPage() {
  const { members, invites, permissionMatrix } = Route.useLoaderData()
  const { workspaceId } = Route.useParams()
  const { entitlements: ent, workspace, role: myRole } = useLoaderData({ from: '/_app/$workspaceId' })
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showInviteForm, setShowInviteForm] = useState(false)

  const totalOccupied = members.length + invites.length
  const seatLimit = ent?.seats ?? 1
  const isAtSeatLimit = totalOccupied >= seatLimit
  const usagePct = Math.min(100, Math.round((totalOccupied / Math.max(1, seatLimit)) * 100))

  async function refresh() {
    await router.invalidate()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (isAtSeatLimit) {
      setMessage(
        ent.tier === 'free' || seatLimit <= 1
          ? 'O plano Free permite apenas 1 assento (ocupado pelo titular da workspace). Faça upgrade para convidar outros colaboradores.'
          : `O seu plano ${ent.tier} permite no máximo ${seatLimit} assento(s). Faça upgrade para convidar mais pessoas.`
      )
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await createInvite({ data: { workspaceId, email, role } })
    setSaving(false)
    if ('error' in result) { setMessage(result.error ?? 'Erro inesperado.'); return }
    setMessage(`Convite gerado com sucesso! Link de acesso: ${result.inviteUrl}`)
    setEmail('')
    setShowInviteForm(false)
    await refresh()
  }

  async function handleRevoke(inviteId: string) {
    await revokeInvite({ data: { workspaceId, inviteId } })
    await refresh()
  }

  async function handleRemove(memberId: string) {
    await removeMember({ data: { workspaceId, memberId } })
    await refresh()
  }

  async function handleRoleChange(memberId: string, role: 'admin' | 'member') {
    const result = await updateMemberRole({ data: { workspaceId, memberId, role } })
    if (result && 'error' in result && result.error) setMessage(result.error)
    await refresh()
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-dark-800 tracking-tight">
            Equipe & Permissões
          </h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-xl">
            Gerencie os colaboradores que possuem acesso ao workspace <strong className="text-dark-800">{workspace.name}</strong> e suas permissões.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
          <Button
            className="w-full md:w-auto"
            icon={UserPlus}
            onClick={() => setShowInviteForm((v) => !v)}
          >
            Convidar Membro
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 rounded-2xl border border-neutral-200 bg-white shadow-2xs">
        <div className="flex items-center gap-4">
          <div className="grid size-10 place-items-center rounded-xl bg-neutral-100 text-dark-800 font-bold font-mono text-sm shrink-0">
            {totalOccupied}/{seatLimit}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-dark-800 text-sm">Uso de Assentos</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                Plano {ent.tier}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              {isAtSeatLimit
                ? ent.tier === 'free' || seatLimit <= 1
                  ? `O plano Free inclui apenas 1 assento (ocupado pelo titular da workspace). Faça upgrade para adicionar colaboradores.`
                  : `Você atingiu o limite de assentos contratados. Faça upgrade para expandir o time.`
                : `Você ainda possui ${seatLimit - totalOccupied} assento(s) disponível(is) para novos colaboradores.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <div className="w-36 h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isAtSeatLimit ? 'bg-error-500' : 'bg-dark-800'}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-neutral-600 w-10 text-right">{usagePct}%</span>
          {isAtSeatLimit && (
            <Link
              to="/$workspaceId/billing"
              params={{ workspaceId }}
              className="px-3.5 py-1.5 rounded-xl bg-dark-800 text-xs font-bold text-white hover:bg-dark-900 transition-colors"
            >
              Expandir Assentos
            </Link>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl bg-neutral-900 text-white px-4 py-3 text-xs font-semibold flex items-center justify-between shadow-md animate-in">
          <span className="break-all">{message}</span>
          <button onClick={() => setMessage(null)} className="text-neutral-400 hover:text-white ml-4">
            Fechar
          </button>
        </div>
      )}

      {showInviteForm && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4 animate-in">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h3 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
              <UserPlus size={16} className="text-dark-800" />
              <span>Enviar Convite por E-mail</span>
            </h3>
            <button onClick={() => setShowInviteForm(false)} className="text-neutral-400 hover:text-dark-800">
              <X size={16} />
            </button>
          </div>

          {isAtSeatLimit ? (
            <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-4 text-xs text-neutral-600 font-medium space-y-2">
              <div className="flex items-center gap-2 font-bold text-dark-800">
                <AlertCircle size={15} className="text-error-500" />
                <span>Limite de assentos atingido no plano {ent.tier}</span>
              </div>
              <p>
                {ent.tier === 'free' || seatLimit <= 1
                  ? 'O plano Free inclui exatamente 1 assento (já ocupado pelo titular da workspace). Para convidar outros colaboradores e expandir sua equipe, faça upgrade na página de planos.'
                  : 'Para convidar novos administradores ou operadores, ajuste a quantidade de assentos da sua conta na página de planos.'}
              </p>
              <Link
                to="/$workspaceId/billing"
                params={{ workspaceId }}
                className="inline-flex items-center gap-1 text-dark-800 font-bold underline pt-1 block"
              >
                Gerenciar Assentos no Billing ›
              </Link>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                  E-mail do Colaborador *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colaborador@suaempresa.com"
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm focus:border-dark-800 outline-none transition-all bg-neutral-50/50 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                  Nível de Acesso
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm focus:border-dark-800 outline-none bg-white transition-all font-medium"
                >
                  <option value="member">Membro (Disparo & Contatos)</option>
                  <option value="admin">Administrador (Gestão Completa)</option>
                </select>
              </div>
              <div className="sm:col-span-3 flex justify-end gap-2 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setShowInviteForm(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
                >
                  Cancelar
                </button>
                <Button type="submit" loading={saving}>
                  Gerar e Enviar Convite
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Active Members Table */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-neutral-200/80 bg-neutral-50/50 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-dark-800">
              Colaboradores Ativos ({members.length})
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Usuários com acesso verificado a este workspace
            </p>
          </div>
        </div>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="min-w-[640px] w-full text-left text-sm">
            <thead className="bg-neutral-50/80 border-b border-neutral-200/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="py-3.5 pl-6 pr-4">Colaborador</th>
                <th className="py-3.5 px-4">E-mail de Acesso</th>
                <th className="py-3.5 px-4">Permissão</th>
                <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-neutral-700 font-medium">
              {members.map((m) => {
                const roleInfo = ROLE_LABELS[m.role] ?? ROLE_LABELS.member
                return (
                  <tr key={m.id} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="py-4 pl-6 pr-4">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={m.name ?? m.userId}
                          picture={m.picture ?? null}
                          frame={m.pictureFrame ?? null}
                          size="sm"
                        />
                        <div>
                          <span className="font-bold text-dark-800 block text-sm">{m.name ?? m.userId}</span>
                          {m.role === 'owner' && (
                            <span className="text-[11px] text-amber-700 font-semibold flex items-center gap-1 mt-0.5">
                              <Crown size={12} className="text-amber-600" /> Titular da Conta
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-mono text-xs text-neutral-600">{m.email ?? '—'}</td>
                    <td className="py-4 px-4">
                      {myRole === 'owner' && m.role !== 'owner' ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value as 'admin' | 'member')}
                          aria-label={`Papel de ${m.name ?? m.email ?? 'membro'}`}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer outline-none transition-colors ${roleInfo.badge}`}
                        >
                          <option value="admin">Administrador</option>
                          <option value="member">Membro</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${roleInfo.badge}`}>
                          {roleInfo.label}
                        </span>
                      )}
                    </td>
                    <td className="py-4 pl-4 pr-6 text-right">
                      {m.role !== 'owner' ? (
                        <button
                          onClick={() => handleRemove(m.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-neutral-400 hover:text-error-600 hover:bg-error-50 transition-colors"
                        >
                          <Trash2 size={13} />
                          <span>Remover</span>
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-400 font-medium pr-2">Permanente</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invites Table */}
      {invites.length > 0 && (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-neutral-200/80 bg-neutral-50/50">
            <h2 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
              <Mail size={16} className="text-dark-800" />
              <span>Convites Pendentes ({invites.length})</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">Aguardando ativação por parte do convidado</p>
          </div>

          <div className="overflow-x-auto -mx-5 px-5">
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead className="bg-neutral-50/80 border-b border-neutral-200/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">E-mail Convidado</th>
                  <th className="py-3.5 px-4">Permissão Solicitada</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-700 font-medium">
                {invites.map((i) => {
                  const roleInfo = ROLE_LABELS[i.role] ?? ROLE_LABELS.member
                  return (
                    <tr key={i.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-4 pl-6 pr-4 font-mono text-xs font-bold text-dark-800">{i.email}</td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${roleInfo.badge}`}>
                          {roleInfo.label}
                        </span>
                      </td>
                      <td className="py-4 pl-4 pr-6 text-right">
                        <button
                          onClick={() => handleRevoke(i.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-error-600 hover:bg-error-50 transition-colors"
                        >
                          <Trash2 size={13} />
                          <span>Revogar</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {permissionMatrix?.permissions && (
        <PermissionMatrixSection
          workspaceId={workspaceId}
          initial={permissionMatrix.permissions}
          canEdit={permissionMatrix.canEdit === true}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

function PermissionToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <Switch
      size="sm"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
    />
  )
}

function PermissionMatrixSection({
  workspaceId,
  initial,
  canEdit,
  onSaved,
}: {
  workspaceId: string
  initial: WorkspaceRolePermissions
  canEdit: boolean
  onSaved: () => Promise<void>
}) {
  const [matrix, setMatrix] = useState<WorkspaceRolePermissions>(initial)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(role: 'admin' | 'member', key: PermissionKey, value: boolean) {
    const next = { ...matrix, [role]: { ...matrix[role], [key]: value } }
    setMatrix(next)
    setError(null)

    const result = await updatePermissions({
      data: { workspaceId, admin: next.admin, member: next.member },
    })
    if (result && 'error' in result && result.error) {
      setMatrix(matrix)
      setError(result.error)
      return
    }
    await onSaved()
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
      <div className="p-5 border-b border-neutral-200/80 bg-neutral-50/50">
        <h2 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
          <ShieldCheck size={16} className="text-dark-800" aria-hidden="true" />
          <span>O que cada papel pode acessar</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          {canEdit
            ? 'As mudanças valem na hora: áreas desativadas somem do menu de quem tem aquele papel.'
            : 'Definido pelo Owner do workspace. Áreas desativadas ficam fora do menu daquele papel.'}
        </p>
      </div>

      <div className="overflow-x-auto -mx-5 px-5">
        <table className="min-w-[640px] w-full text-left text-sm">
          <thead className="bg-neutral-50/80 border-b border-neutral-200/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="py-3.5 pl-6 pr-4">Área</th>
              <th className="py-3.5 px-4 text-center w-32">Proprietário</th>
              <th className="py-3.5 px-4 text-center w-32">Administrador</th>
              <th className="py-3.5 pl-4 pr-6 text-center w-32">Membro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {PERMISSION_INFO.map(({ key, icon: Icon, label, description }) => (
              <tr key={key} className="hover:bg-neutral-50/60 transition-colors">
                <td className="py-3.5 pl-6 pr-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
                      <Icon size={14} aria-hidden="true" />
                    </span>
                    <div>
                      <span className="block text-sm font-bold text-dark-800">{label}</span>
                      <span className="block text-xs text-neutral-500">{description}</span>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <span
                    className="inline-flex items-center gap-1 text-neutral-400"
                    title="O Owner sempre tem acesso total"
                  >
                    <Check size={15} className="text-success-500" aria-hidden="true" />
                    <Lock size={11} aria-hidden="true" />
                  </span>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <PermissionToggle
                    checked={matrix.admin[key]}
                    disabled={!canEdit}
                    label={`${label} para administradores`}
                    onChange={(value) => handleToggle('admin', key, value)}
                  />
                </td>
                <td className="py-3.5 pl-4 pr-6 text-center">
                  <PermissionToggle
                    checked={matrix.member[key]}
                    disabled={!canEdit}
                    label={`${label} para membros`}
                    onChange={(value) => handleToggle('member', key, value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="px-6 py-3 border-t border-neutral-100 text-xs font-semibold text-error-600">
          {error}
        </div>
      )}
    </div>
  )
}
