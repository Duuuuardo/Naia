import { createFileRoute, redirect } from '@tanstack/react-router'
import { buildLoginUrl } from '../lib/vianova'
import { getSessionUser } from '../lib/session'
import { createHeadConfig } from '../lib/seo'

export const Route = createFileRoute('/login')({
  head: () => createHeadConfig('Entrar — Naia CRM'),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirectTo: search.redirect }),
  loader: async ({ deps }) => {
    const user = await getSessionUser()
    if (user) throw redirect({ to: '/workspaces' })
    const url = await buildLoginUrl({ data: { redirectTo: deps.redirectTo } })
    throw redirect({ href: url })
  },
})
