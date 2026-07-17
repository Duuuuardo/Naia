import { createFileRoute, redirect } from '@tanstack/react-router'
import { buildLoginUrl } from '../lib/vianova'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirectTo: search.redirect }),
  loader: async ({ deps }) => {
    const url = await buildLoginUrl({ data: { redirectTo: deps.redirectTo } })
    throw redirect({ href: url })
  },
})
