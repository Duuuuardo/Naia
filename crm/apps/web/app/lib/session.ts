import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import { introspectSessionToken, REFRESH_COOKIE, SESSION_COOKIE } from './vianova'

// Decodifica o payload do JWT (sem verificar assinatura — a verificação real é
// no crm-api via JWKS; aqui só extraímos claims para exibir o usuário).
function decodeJwtPayload(token: string): {
  sub?: string
  email?: string
  name?: string
  picture?: string
  picture_frame?: string
} | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

export type SessionUser = {
  id: string
  email: string
  name: string
  picture?: string
  pictureFrame?: string
}

// Retorna o usuário Vianova autenticado no painel de gestão, ou null.
export const getSessionUser = createServerFn().handler(async (): Promise<SessionUser | null> => {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null

  const introspection = await introspectSessionToken(token)
  if (introspection === 'inactive') {
    const cookieDomain = process.env.CRM_COOKIE_DOMAIN
    const options = { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }
    deleteCookie(SESSION_COOKIE, options)
    deleteCookie(REFRESH_COOKIE, options)
    return null
  }

  const payload = decodeJwtPayload(token)
  if (!payload?.sub) return null

  return {
    id: payload.sub,
    email: payload.email ?? '',
    name: payload.name ?? payload.email ?? 'Usuário',
    picture: payload.picture,
    pictureFrame: payload.picture_frame,
  }
})

// Retorna o token de sessão bruto (para chamadas autenticadas do server ao crm-api).
export const getSessionToken = createServerFn().handler(async (): Promise<string | null> => {
  return getCookie(SESSION_COOKIE) ?? null
})
