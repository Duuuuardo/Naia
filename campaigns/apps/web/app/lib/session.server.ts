import { getCookie } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'
import { apiClient } from './api'
import { SESSION_COOKIE, tryRefreshSession } from './vianova'

// Módulo estritamente server-only (sufixo .server.ts) — só pode ser importado
// de dentro de outro createServerFn (contexto de request já garantido).
export async function requireApi() {
  let token = getCookie(SESSION_COOKIE)

  if (!token) {
    // Tenta renovar silenciosamente antes de forçar re-autenticação.
    // tryRefreshSession já atualiza os cookies naia_session e naia_refresh.
    token = (await tryRefreshSession()) ?? undefined
  }

  if (!token) throw redirect({ to: '/login' })

  return apiClient(token)
}
