import { treaty } from '@elysiajs/eden'
import type { App } from '@crm/api'

export function createCrmClient(baseUrl: string, token?: string) {
  return treaty<App>(baseUrl, {
    fetch: { credentials: 'include' },
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
}

export type CrmClient = ReturnType<typeof createCrmClient>
