import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionUser } from '../lib/session'
import { getInboxAgentId } from '../lib/inbox-session'
import { getHostContext } from '../lib/inbox-slug'

// Sem tela intermediária.
// No apex: sem sessão Vianova, vai direto pro login (o CRM não implementa
// cadastro/login próprio para managers).
// Num subdomínio de workspace (slug.crm.naia.website): a raiz é o inbox —
// agente autenticado entra direto, senão cai na tela de login de agente.
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { isInboxHost } = await getHostContext()
    if (isInboxHost) {
      const agentId = await getInboxAgentId()
      throw redirect({ to: agentId ? '/inbox' : '/inbox/login' })
    }
    const user = await getSessionUser()
    throw redirect({ to: user ? '/workspaces' : '/login' })
  },
})
