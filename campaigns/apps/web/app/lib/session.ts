import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'
import { introspectSessionToken, REFRESH_COOKIE, SESSION_COOKIE } from './vianova'

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
