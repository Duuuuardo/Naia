import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'
import { introspectSessionToken, REFRESH_COOKIE, SESSION_COOKIE } from './vianova'

// Único export deste módulo é um createServerFn — seguro de importar de
// qualquer route (client ou server), já que o compilador troca a chamada por
// uma RPC no bundle do browser. Ver lib/session.server.ts pro helper que usa
// getCookie diretamente (esse sim nunca pode ser alcançável pelo client).
export const getSessionUser = createServerFn().handler(async () => {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null
  try {
    const introspection = await introspectSessionToken(token)
    if (introspection === 'inactive') {
      const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
      const options = { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }
      deleteCookie(SESSION_COOKIE, options)
      deleteCookie(REFRESH_COOKIE, options)
      return null
    }
    const { data, error } = await apiClient(token).auth.me.get()
    if (error || !data?.user) {
      const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
      const options = { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }
      deleteCookie(SESSION_COOKIE, options)
      deleteCookie(REFRESH_COOKIE, options)
      return null
    }
    return data.user
  } catch {
    return null
  }
})
