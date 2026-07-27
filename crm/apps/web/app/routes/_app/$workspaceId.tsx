import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { House, Users, UserRoundCog, CreditCard, Settings, ExternalLink } from 'lucide-react'
import type { PermissionKey, RolePermissionMap } from '@crm/schemas'
import { Topbar } from '../../components/topbar'
import { MobileNav } from '../../components/mobile-nav'
import { getSessionUser } from '../../lib/session'
import { fetchWorkspace } from '../../lib/actions'
import { createHeadConfig } from '../../lib/seo'
import { WorkspaceShell } from '../../components/ui'

export const Route = createFileRoute('/_app/$workspaceId')({
  head: () => createHeadConfig('Painel — Naia CRM'),
  loader: async ({ params }) => {
    const [user, ws] = await Promise.all([getSessionUser(), fetchWorkspace({ data: { workspaceId: params.workspaceId } })])
    if (!ws || (ws as any).message) {
      throw redirect({ to: '/workspaces' })
    }
    return {
      user: user!,
      workspace: (ws as any).workspace,
      role: (ws as any).role,
      entitlements: (ws as any).entitlements,
      permissions: ((ws as any).permissions ?? null) as RolePermissionMap | null,
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
  { to: '/$workspaceId/agents', label: 'Agentes', icon: Users, permission: 'agents' },
  { to: '/$workspaceId/members', label: 'Membros', icon: UserRoundCog, permission: 'members' },
  { to: '/$workspaceId/billing', label: 'Assinatura', icon: CreditCard, permission: 'billing' },
  { to: '/$workspaceId/settings', label: 'Configurações', icon: Settings, permission: 'settings' },
]

function WorkspaceLayout() {
  const { user, workspace, permissions } = Route.useLoaderData()
  const { workspaceId } = Route.useParams()

  // Enquanto o backend não expõe `permissions` (ou para o Owner, que tem tudo),
  // todos os itens ficam visíveis.
  const visibleItems = navItems.filter(
    (item) => item.permission === null || (permissions?.[item.permission] ?? true),
  )

  const inboxUrl =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? `http://${workspace.slug}.localhost:${window.location.port || 3002}`
      : `https://${workspace.slug}.crm.naia.website`

  return (
    <WorkspaceShell
      header={
        <Topbar
          user={user}
          workspaceName={workspace.name}
          workspaceAvatarUrl={workspace.avatarUrl}
          mobileNav={<MobileNav workspaceId={workspaceId} items={visibleItems} />}
        />
      }
      sidebar={
        <>
          <nav className="space-y-0.5">
            {visibleItems.map(({ icon: Icon, permission: _permission, ...item }) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ workspaceId }}
                activeOptions={{ exact: 'exact' in item && item.exact }}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-dark-800 transition-colors hover:bg-neutral-50"
                activeProps={{ className: 'bg-brand-50 text-brand-600' }}
              >
                <Icon size={16} aria-hidden="true" className="shrink-0" />
                {item.label}
              </Link>
            ))}
          </nav>

          <a
            href={inboxUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-dark-800 transition-colors hover:bg-neutral-50"
          >
            <ExternalLink size={16} aria-hidden="true" className="shrink-0" />
            Abrir inbox
          </a>
        </>
      }
    >
      <Outlet />
    </WorkspaceShell>
  )
}
