import { createFileRoute, redirect } from '@tanstack/react-router'
import { buildLoginUrl } from '../lib/vianova'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/login')({ head: () => createHeadConfig('Entrar — Naia Campanhas'),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  loaderDeps: ({ search }) => ({ redirectTo: search.redirect }),
  loader: async ({ deps }) => {
    const url = await buildLoginUrl({ data: { redirectTo: deps.redirectTo } })
    throw redirect({ href: url })
  },
})
