import { createFileRoute, useRouter, useLoaderData, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  AlertCircle,
  Check,
  CreditCard,
  Crown,
  Headset,
  Lock,
  Mail,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCog,
  X,
} from 'lucide-react'
import {
  DEFAULT_ROLE_PERMISSIONS,
  type PermissionKey,
  type RolePermissionMap,
  type WorkspaceRolePermissions,
} from '@crm/schemas'
import {
  fetchMembers,
  fetchInvites,
  fetchPermissions,
  createInvite,
  revokeInvite,
  removeMember,
  updatePermissions,
} from '../../../lib/actions'
import { Avatar, Badge, Button, PageHeader, Switch } from '../../../components/ui'
import { createHeadConfig } from '../../../lib/seo'
import { validateEmail } from '../../../lib/validation'

export const Route = createFileRoute('/_app/$workspaceId/members')({
  head: () => createHeadConfig('Membros — Naia CRM'),
  loader: async ({ params }) => {
    const [members, invites, permissionMatrix] = await Promise.all([
      fetchMembers({ data: { workspaceId: params.workspaceId } }),
      fetchInvites({ data: { workspaceId: params.workspaceId } }),
      fetchPermissions({ data: { workspaceId: params.workspaceId } }),
    ])
    return { members, invites, permissionMatrix }
  },
  component: MembersPage,
})

const PERMISSION_INFO: { key: PermissionKey; icon: typeof Headset; label: string; description: string }[] = [
  { key: 'agents', icon: Headset, label: 'Agentes', description: 'Equipe de atendimento do inbox.' },
  { key: 'members', icon: UserRoundCog, label: 'Membros', description: 'Convidar, remover e definir papéis de gerentes.' },
  { key: 'billing', icon: CreditCard, label: 'Assinatura', description: 'Plano e cobrança do workspace.' },
  { key: 'settings', icon: Settings, label: 'Configurações', description: 'Nome, avatar e informações do workspace.' },
]

const ROLE_LABELS: Record<string, { label: string; badge: string }> = {
  owner: { label: 'Proprietário', badge: 'bg-amber-50 text-amber-800 border-amber-200/80' },
  admin: { label: 'Administrador', badge: 'bg-purple-50 text-purple-800 border-purple-200/80' },
}

function MembersPage() {
  const { members, invites, permissionMatrix } = Route.useLoaderData()
  const { workspaceId } = Route.useParams()
  const { entitlements, workspace, role: myRole } = useLoaderData({ from: '/_app/$workspaceId' })
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showInviteForm, setShowInviteForm] = useState(false)

  const managersLimit: number = entitlements?.managersLimit ?? 2
  const isUnlimited = managersLimit < 0
  const totalOccupied = members.length + invites.length
  const isAtLimit = !isUnlimited && totalOccupied >= managersLimit
  const usagePct = isUnlimited
    ? 0
    : Math.min(100, Math.round((totalOccupied / Math.max(1, managersLimit)) * 100))

  async function refresh() {
    await router.invalidate()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (isAtLimit) {
      setMessage(
        `O seu plano permite no máximo ${managersLimit} gerente(s). Faça upgrade para convidar mais pessoas.`,
      )
      return
    }
    const invalidEmail = validateEmail(email)
    setEmailError(invalidEmail)
    if (invalidEmail) return
    setSaving(true)
    setMessage(null)
    const result = await createInvite({ data: { workspaceId, email: email.trim(), role: 'admin' } })
    setSaving(false)
    if ('error' in result) {
      setMessage(result.error ?? 'Erro inesperado.')
      return
    }
    setMessage('Convite enviado por e-mail com sucesso.')
    setEmail('')
    setShowInviteForm(false)
    await refresh()
  }

  async function handleRevoke(inviteId: string) {
    const result = await revokeInvite({ data: { workspaceId, inviteId } })
    if ('error' in result) {
      setMessage(result.error ?? 'Erro ao revogar convite.')
      return
    }
    await refresh()
  }

  async function handleRemove(managerId: string) {
    const result = await removeMember({ data: { workspaceId, managerId } })
    if ('error' in result) {
      setMessage(result.error ?? 'Erro ao remover membro.')
      return
    }
    await refresh()
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-20">
      <PageHeader
        title="Membros"
        subtitle={
          <>
            Gerentes com conta Vianova que acessam este painel de gestão do workspace{' '}
            <strong className="text-dark-800">{workspace.name}</strong> — diferente dos agentes, que
            atendem as conversas no inbox.
          </>
        }
      >
        <Button icon={UserPlus} onClick={() => setShowInviteForm((v) => !v)} disabled={isAtLimit}>
          Convidar gerente
        </Button>
      </PageHeader>

      {/* Uso de gerentes vs limite do plano */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-0 px-5 py-4 shadow-2xs sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-neutral-100 font-mono text-sm font-bold text-dark-800">
            {isUnlimited ? `${totalOccupied}/∞` : `${totalOccupied}/${managersLimit}`}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-dark-800">Uso de gerentes</span>
              <Badge className="border-neutral-200 bg-neutral-100 text-neutral-600">
                Plano {entitlements?.plan ?? 'free'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {isUnlimited
                ? 'Seu plano permite gerentes ilimitados.'
                : isAtLimit
                  ? 'Você atingiu o limite de gerentes do plano. Faça upgrade para ampliar a equipe de gestão.'
                  : `Você ainda pode adicionar ${Math.max(0, managersLimit - totalOccupied)} gerente(s) — convites pendentes também contam no limite.`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {!isUnlimited && (
            <>
              <div className="h-2 w-36 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isAtLimit ? 'bg-error-500' : 'bg-dark-800'}`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-xs font-bold text-neutral-600">{usagePct}%</span>
            </>
          )}
          {isAtLimit && (
            <Link
              to="/$workspaceId/billing"
              params={{ workspaceId }}
              className="rounded-xl bg-dark-800 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-dark-900"
            >
              Expandir
            </Link>
          )}
        </div>
      </div>

      {message && (
        <div className="flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3 text-xs font-semibold text-white shadow-md">
          <span className="break-all">{message}</span>
          <button onClick={() => setMessage(null)} className="ml-4 text-neutral-400 hover:text-white">
            Fechar
          </button>
        </div>
      )}

      {showInviteForm && (
        <div className="space-y-4 rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xs">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h3 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
              <UserPlus size={16} className="text-dark-800" />
              <span>Enviar convite por e-mail</span>
            </h3>
            <button onClick={() => setShowInviteForm(false)} className="text-neutral-400 hover:text-dark-800">
              <X size={16} />
            </button>
          </div>

          {isAtLimit ? (
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs font-medium text-neutral-600">
              <div className="flex items-center gap-2 font-bold text-dark-800">
                <AlertCircle size={15} className="text-error-500" />
                <span>Limite de gerentes atingido</span>
              </div>
              <p>
                Para convidar novos gerentes, faça upgrade do plano na página de assinatura.
              </p>
              <Link
                to="/$workspaceId/billing"
                params={{ workspaceId }}
                className="inline-flex items-center gap-1 pt-1 font-bold text-dark-800 underline"
              >
                Gerenciar plano na Assinatura ›
              </Link>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  E-mail do gerente *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setEmailError(null)
                  }}
                  onBlur={() => setEmailError(validateEmail(email))}
                  aria-invalid={emailError ? true : undefined}
                  placeholder="gerente@suaempresa.com"
                  className={`h-10 w-full rounded-xl border bg-neutral-50/50 px-3.5 text-sm outline-none transition-all focus:border-dark-800 focus:bg-white ${emailError ? 'border-red-400' : 'border-neutral-200'}`}
                />
                {emailError && (
                  <span className="mt-1 block text-[11px] text-red-500" role="alert">{emailError}</span>
                )}
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  O convidado precisa ter (ou criar) uma conta Vianova para aceitar o convite.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Nível de acesso
                </label>
                <div className="flex h-10 w-full items-center rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 text-sm font-medium text-neutral-600">
                  Administrador
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-neutral-100 pt-2 sm:col-span-3">
                <button
                  type="button"
                  onClick={() => setShowInviteForm(false)}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-neutral-500 transition-colors hover:bg-neutral-100"
                >
                  Cancelar
                </button>
                <Button type="submit" loading={saving}>
                  Gerar e enviar convite
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Membros ativos */}
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-0 shadow-2xs">
        <div className="flex items-center justify-between border-b border-neutral-200/80 bg-neutral-50/50 p-5">
          <div>
            <h2 className="font-display text-base font-bold text-dark-800">
              Gerentes ativos ({members.length})
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Usuários com conta Vianova e acesso verificado a este workspace
            </p>
          </div>
        </div>

        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-neutral-200/80 bg-neutral-50/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="py-3.5 pl-6 pr-4">Gerente</th>
                <th className="px-4 py-3.5">E-mail de acesso</th>
                <th className="px-4 py-3.5">Permissão</th>
                <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
              {members.map((m) => {
                const roleInfo = ROLE_LABELS[m.role] ?? ROLE_LABELS.admin
                return (
                  <tr key={m.id} className="transition-colors hover:bg-neutral-50/80">
                    <td className="py-4 pl-6 pr-4">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={m.name ?? m.email ?? m.vianovaUserId}
                          picture={m.pictureUrl}
                          size="sm"
                        />
                        <div>
                          <span className="block text-sm font-bold text-dark-800">
                            {m.name ?? m.email ?? m.vianovaUserId}
                          </span>
                          {m.role === 'owner' && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                              <Crown size={12} className="text-amber-600" /> Titular do workspace
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-neutral-600">{m.email ?? '—'}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${roleInfo.badge}`}>
                        {roleInfo.label}
                      </span>
                    </td>
                    <td className="py-4 pl-4 pr-6 text-right">
                      {m.role !== 'owner' ? (
                        <button
                          onClick={() => handleRemove(m.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-neutral-400 transition-colors hover:bg-error-50 hover:text-error-600"
                        >
                          <Trash2 size={13} />
                          <span>Remover</span>
                        </button>
                      ) : (
                        <span className="pr-2 text-xs font-medium text-neutral-400">Permanente</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Convites pendentes */}
      {invites.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-0 shadow-2xs">
          <div className="border-b border-neutral-200/80 bg-neutral-50/50 p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
              <Mail size={16} className="text-dark-800" />
              <span>Convites pendentes ({invites.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">Aguardando aceite por parte do convidado</p>
          </div>

          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-neutral-200/80 bg-neutral-50/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">E-mail convidado</th>
                  <th className="px-4 py-3.5">Permissão solicitada</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
                {invites.map((i) => {
                  const roleInfo = ROLE_LABELS[i.role] ?? ROLE_LABELS.admin
                  return (
                    <tr key={i.id} className="transition-colors hover:bg-neutral-50/80">
                      <td className="py-4 pl-6 pr-4 font-mono text-xs font-bold text-dark-800">{i.email}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${roleInfo.badge}`}>
                          {roleInfo.label}
                        </span>
                      </td>
                      <td className="py-4 pl-4 pr-6 text-right">
                        <button
                          onClick={() => handleRevoke(i.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-error-600 transition-colors hover:bg-error-50"
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
          canEdit={permissionMatrix.canEdit === true && myRole === 'owner'}
          onSaved={refresh}
        />
      )}
    </div>
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
  // Owner sempre tem tudo — a matriz configurável só existe para o admin.
  const [admin, setAdmin] = useState<RolePermissionMap>({
    ...DEFAULT_ROLE_PERMISSIONS.admin,
    ...initial.admin,
  })
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(key: PermissionKey, value: boolean) {
    const previous = admin
    const next = { ...admin, [key]: value }
    setAdmin(next)
    setError(null)

    const result = await updatePermissions({ data: { workspaceId, admin: next } })
    if (result && 'error' in result && result.error) {
      setAdmin(previous)
      setError(result.error)
      return
    }
    await onSaved()
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-0 shadow-2xs">
      <div className="border-b border-neutral-200/80 bg-neutral-50/50 p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
          <ShieldCheck size={16} className="text-dark-800" aria-hidden="true" />
          <span>O que cada papel pode acessar</span>
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          {canEdit
            ? 'As mudanças valem na hora: áreas desativadas somem do menu de quem tem aquele papel.'
            : 'Definido pelo Proprietário do workspace. Áreas desativadas ficam fora do menu do Administrador.'}
        </p>
      </div>

      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-neutral-200/80 bg-neutral-50/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="py-3.5 pl-6 pr-4">Área</th>
              <th className="w-32 px-4 py-3.5 text-center">Proprietário</th>
              <th className="w-32 py-3.5 pl-4 pr-6 text-center">Administrador</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {PERMISSION_INFO.map(({ key, icon: Icon, label, description }) => (
              <tr key={key} className="transition-colors hover:bg-neutral-50/60">
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
                <td className="px-4 py-3.5 text-center">
                  <span
                    className="inline-flex items-center gap-1 text-neutral-400"
                    title="O Proprietário sempre tem acesso total"
                  >
                    <Check size={15} className="text-success-500" aria-hidden="true" />
                    <Lock size={11} aria-hidden="true" />
                  </span>
                </td>
                <td className="py-3.5 pl-4 pr-6 text-center">
                  <Switch
                    size="sm"
                    checked={admin[key]}
                    disabled={!canEdit}
                    onChange={(value) => handleToggle(key, value)}
                    aria-label={`${label} para administradores`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="border-t border-neutral-100 px-6 py-3 text-xs font-semibold text-error-600">
          {error}
        </div>
      )}
    </div>
  )
}
