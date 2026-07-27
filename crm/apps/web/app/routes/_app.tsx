import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { getSessionUser } from '../lib/session'
import { getHostContext } from '../lib/inbox-slug'

// Layout autenticado do painel de gestão. Guarda a sessão Vianova.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    // O painel de gestão só existe no apex — via subdomínio de workspace
    // (slug.crm.naia.website) redireciona para o apex.
    const { isInboxHost, managementUrl } = await getHostContext()
    if (isInboxHost) {
      throw redirect({ href: `${managementUrl}${location.pathname}` })
    }
    const user = await getSessionUser()
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } })
    }
    return { user }
  },
  component: () => <Outlet />,
})
