import { createFileRoute, Link, Outlet, redirect, useRouteContext } from '@tanstack/react-router'
import { CreditCard, Files, House, Megaphone, Plug, Settings, Users, UsersRound, Workflow } from 'lucide-react'
import type { PermissionKey, RolePermissionMap } from '@naia/schemas'
import { Topbar } from '../../components/topbar'
import { MobileNav } from '../../components/mobile-nav'
import { VerifyEmailBanner } from '../../components/verify-email-banner'
import { fetchWorkspace } from '../../lib/actions'

export const Route = createFileRoute('/_app/$workspaceId')({
  loader: async ({ params }) => {
    const result = await fetchWorkspace({ data: params.workspaceId })
    if (!result?.workspace) throw redirect({ to: '/workspaces' })
    return {
      workspace: result.workspace,
      role: result.role!,
      entitlements: result.entitlements!,
      permissions: result.permissions! as RolePermissionMap,
    }
  },
  component: WorkspaceLayout,
})

const navItems: {
  to: string
  label: string
  icon: typeof House
  exact?: boolean
  permission: PermissionKey | null
}[] = [
  { to: '/$workspaceId', label: 'Início', icon: House, exact: true, permission: null },
  { to: '/$workspaceId/contacts', label: 'Contatos', icon: UsersRound, permission: 'contacts' },
  { to: '/$workspaceId/connections', label: 'Conexões', icon: Plug, permission: 'connections' },
  { to: '/$workspaceId/campaigns', label: 'Campanhas', icon: Megaphone, permission: 'campaigns' },
  { to: '/$workspaceId/automations', label: 'Automações', icon: Workflow, permission: 'campaigns' },
  { to: '/$workspaceId/members', label: 'Membros', icon: Users, permission: 'members' },
  { to: '/$workspaceId/billing', label: 'Assinatura', icon: CreditCard, permission: 'billing' },
  { to: '/$workspaceId/files', label: 'Arquivos', icon: Files, permission: 'files' },
  { to: '/$workspaceId/settings', label: 'Configurações', icon: Settings, permission: 'settings' },
]

function WorkspaceLayout() {
  const { workspace, permissions, entitlements } = Route.useLoaderData()
  const { user } = useRouteContext({ from: '/_app' })
  const { workspaceId } = Route.useParams()

  const visibleItems = navItems.filter(
    (item) => item.permission === null || permissions[item.permission],
  )

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar
        user={user}
        workspaceName={workspace.name}
        workspaceAvatarUrl={'avatarUrl' in workspace ? (workspace.avatarUrl as string | null) : null}
        credits={{ balance: entitlements.creditsBalance, perCycle: entitlements.creditsPerCycle }}
        workspaceId={workspaceId}
        mobileNav={<MobileNav workspaceId={workspaceId} items={visibleItems} />}
      />
      {user.emailVerified === false && <VerifyEmailBanner email={user.email} />}
      <div className="flex-1 flex max-w-6xl w-full mx-auto">
        <aside className="hidden md:block w-48 shrink-0 border-r border-neutral-200 py-8 pr-4">
          <nav className="space-y-0.5">
            {visibleItems.map(({ icon: Icon, permission: _permission, ...item }) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ workspaceId }}
                activeOptions={{ exact: 'exact' in item && item.exact }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-dark-800 hover:bg-neutral-50 transition-colors"
                activeProps={{ className: 'bg-brand-50 text-brand-600' }}
              >
                <Icon size={16} aria-hidden="true" className="shrink-0" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 min-w-0 py-8 px-4 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
