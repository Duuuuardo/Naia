import type { InboxAgent } from '../plugins/auth-inbox'

// Guard de superadmin do inbox. auth-inbox.ts ainda tipa role como
// 'admin' | 'agent' (a inclusão de 'superadmin' no plugin é de outra frente),
// então a comparação passa por string para não quebrar o typecheck.
export function isSuperadmin(agent: InboxAgent | null): boolean {
  return (agent?.role as string | undefined) === 'superadmin'
}
