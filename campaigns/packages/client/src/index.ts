import { treaty } from '@elysiajs/eden'
import type { App } from '@naia/api'

export function createNaiaClient(baseUrl: string, token?: string) {
  return treaty<App>(baseUrl, {
    fetch: { credentials: 'include' },
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
}

export type NaiaClient = ReturnType<typeof createNaiaClient>
