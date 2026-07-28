import { createFileRoute, redirect } from '@tanstack/react-router'
import { getInboxAgent } from '../../lib/inbox-session'

// A home do app do agente é o painel pessoal (Meu desempenho). O atendimento
// (lista de conversas + thread) vive em /inbox/atendimento, com sidebar própria.
export const Route = createFileRoute('/inbox/')({
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    throw redirect({ to: '/inbox/meu-desempenho' })
  },
})
