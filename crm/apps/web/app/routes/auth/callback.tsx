import { createFileRoute, redirect } from '@tanstack/react-router'
import { completeLogin } from '../../lib/vianova'

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (search: Record<string, unknown>): { code?: string; state?: string } => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
  }),
  loaderDeps: ({ search }) => ({ code: search.code, state: search.state }),
  loader: async ({ deps }) => {
    if (!deps.code) {
      throw redirect({ to: '/auth/error', search: { reason: 'missing_code' } })
    }
    const result = await completeLogin({ data: { code: deps.code, state: deps.state } })
    if (!result.ok) {
      throw redirect({ to: '/auth/error', search: { reason: 'token_exchange_failed' } })
    }
    throw redirect({ href: result.redirectTo })
  },
})
