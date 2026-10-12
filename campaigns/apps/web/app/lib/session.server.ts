import { getCookie } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'
import { apiClient } from './api'
import { SESSION_COOKIE, tryRefreshSession } from './vianova'

export async function requireApi() {
  let token = getCookie(SESSION_COOKIE)

  if (!token) {
    token = (await tryRefreshSession()) ?? undefined
  }

  if (!token) throw redirect({ to: '/login' })

  return apiClient(token)
}
