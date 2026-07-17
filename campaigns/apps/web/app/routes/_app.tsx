import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { getSessionUser } from '../lib/session'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const user = await getSessionUser()
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { user }
  },
  component: () => <Outlet />,
})
