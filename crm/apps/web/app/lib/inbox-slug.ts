import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

// Extrai o slug do workspace a partir do host do inbox.
// Produção: [slug].crm.naia.website → slug
// Dev: [slug].localhost:3002 → slug
// Apex (crm.naia.website / localhost puro) → null (painel de gestão).
export function parseWorkspaceSlug(host: string | null | undefined): string | null {
  if (!host) return null
  const hostname = host.split(':')[0]

  if (hostname.endsWith('.crm.naia.website')) {
    return hostname.split('.')[0]
  }
  if (hostname.endsWith('.localhost')) {
    return hostname.split('.')[0]
  }
  return null
}

// Host do painel de gestão correspondente a um host de inbox
// (slug.crm.naia.website → crm.naia.website; slug.localhost:3002 → localhost:3002).
// Só faz sentido para hosts com subdomínio — chamar apenas quando isInboxHost.
export function managementHost(host: string): string {
  const [hostname, port] = host.split(':')
  const apex = hostname.split('.').slice(1).join('.')
  return port ? `${apex}:${port}` : apex
}

// Versão client-side: lê do window.location.
// Fallback (localhost puro, sem subdomínio): usa ?ws= da query.
export function getWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null
  const fromHost = parseWorkspaceSlug(window.location.host)
  if (fromHost) return fromHost
  const params = new URLSearchParams(window.location.search)
  return params.get('ws')
}

export type HostContext = {
  isInboxHost: boolean
  workspaceSlug: string | null
  // URL absoluta do painel de gestão (apex), para redirects cross-host.
  managementUrl: string
}

// Roda no servidor (inclusive durante o SSR): decide pelo header Host se a
// requisição veio do painel de gestão (apex) ou do inbox de um workspace
// (subdomínio).
export const getHostContext = createServerFn().handler(async (): Promise<HostContext> => {
  const host = getRequestHeader('host') ?? ''
  const proto = getRequestHeader('x-forwarded-proto') ?? 'http'
  const workspaceSlug = parseWorkspaceSlug(host)
  return {
    isInboxHost: workspaceSlug !== null,
    workspaceSlug,
    managementUrl: `${proto}://${managementHost(host)}`,
  }
})
