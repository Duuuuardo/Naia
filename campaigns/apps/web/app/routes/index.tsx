import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionUser } from '../lib/session'

// Sem tela intermediária: sem sessão, o usuário vai direto pro login/cadastro
// do Vianova (que já tem os dois fluxos) — o Naia não implementa cadastro/login
// próprio, então não faz sentido pedir um clique extra aqui.
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const user = await getSessionUser()
    throw redirect({ to: user ? '/workspaces' : '/login' })
  },
})
