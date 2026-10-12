import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'

function requireEnv(name: string): string {
  const value = process.env[name] ?? (import.meta.env as Record<string, string>)[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[naia/web] ${name} is required`)
  }
  return value
}

const vianovaApiUrl = () => process.env.VIANOVA_API_INTERNAL_URL || requireEnv('VITE_VIANOVA_API_URL')
const vianovaApiPublicUrl = () => requireEnv('VITE_VIANOVA_API_URL')
const vianovaWebPublicUrl = () => requireEnv('VITE_VIANOVA_WEB_URL')
const naiaWebUrl = () => requireEnv('VITE_NAIA_WEB_URL')
const clientId = () => requireEnv('NAIA_OIDC_CLIENT_ID')
const clientSecret = () => requireEnv('NAIA_OIDC_CLIENT_SECRET')

const isProduction = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE = 'naia_session'
export const REFRESH_COOKIE = 'naia_refresh'
const OIDC_TX_COOKIE = 'naia_oidc_tx'
const OIDC_TX_TTL_SECONDS = 600

const REDIRECT_URI = () => `${naiaWebUrl()}/auth/callback`

function safeRedirectPath(path: string | undefined): string {
  if (!path || !path.startsWith('/')) return '/'
  if (path.startsWith('//') || path.startsWith('/\\')) return '/'
  return path
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function oidcTxCookieOptions() {
  const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    maxAge: OIDC_TX_TTL_SECONDS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  }
}

export function buildEndSessionUrl(): string {
  const url = new URL(`${vianovaWebPublicUrl()}/logout`)
  url.searchParams.set('post_logout_redirect_uri', `${naiaWebUrl()}/login`)
  return url.toString()
}

function buildAuthorizeUrl(state: string, challenge: string): string {
  const url = new URL(`${vianovaApiPublicUrl()}/oidc/authorize`)
  url.searchParams.set('client_id', clientId())
  url.searchParams.set('redirect_uri', REDIRECT_URI())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export const buildLoginUrl = createServerFn()
  .validator((data: { redirectTo?: string }) => data)
  .handler(async ({ data }) => {
    const state = randomToken()
    const verifier = randomToken()
    const challenge = await pkceChallenge(verifier)
    const redirectTo = safeRedirectPath(data.redirectTo)

    setCookie(OIDC_TX_COOKIE, JSON.stringify({ state, verifier, redirectTo }), oidcTxCookieOptions())

    const loginUrl = new URL(`${vianovaWebPublicUrl()}/login`)
    loginUrl.searchParams.set('redirect_uri', buildAuthorizeUrl(state, challenge))
    return loginUrl.toString()
  })

export const completeLogin = createServerFn()
  .validator((data: { code: string; state?: string }) => data)
  .handler(async ({ data }) => {
    const txRaw = getCookie(OIDC_TX_COOKIE)
    deleteCookie(OIDC_TX_COOKIE, { path: '/' })
    if (!txRaw) return { ok: false as const }

    let tx: { state?: string; verifier?: string; redirectTo?: string }
    try {
      tx = JSON.parse(txRaw)
    } catch {
      return { ok: false as const }
    }

    if (!tx.state || !data.state || tx.state !== data.state) return { ok: false as const }
    if (!tx.verifier) return { ok: false as const }

    const res = await fetch(`${vianovaApiUrl()}/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: data.code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: REDIRECT_URI(),
        code_verifier: tx.verifier,
      }),
    })

    if (!res.ok) return { ok: false as const }
    const tokenData = (await res.json()) as {
      access_token?: string
      expires_in?: number
      refresh_token?: string
      refresh_token_expires_in?: number
    }
    if (!tokenData.access_token) return { ok: false as const }

    const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
    const base = { httpOnly: true, sameSite: 'lax' as const, secure: isProduction, path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }

    setCookie(SESSION_COOKIE, tokenData.access_token, { ...base, maxAge: tokenData.expires_in ?? 3600 })
    if (tokenData.refresh_token) {
      setCookie(REFRESH_COOKIE, tokenData.refresh_token, { ...base, maxAge: tokenData.refresh_token_expires_in ?? 30 * 24 * 3600 })
    }

    return {
      ok: true as const,
      redirectTo: safeRedirectPath(tx.redirectTo),
    }
  })

export const tryRefreshSession = createServerFn().handler(async (): Promise<string | null> => {
  const refreshToken = getCookie(REFRESH_COOKIE)
  if (!refreshToken) return null

  const res = await fetch(`${vianovaApiUrl()}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  })

  if (!res.ok) {
    deleteCookie(REFRESH_COOKIE)
    return null
  }

  const tokenData = (await res.json()) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    refresh_token_expires_in?: number
  }
  if (!tokenData.access_token) {
    deleteCookie(REFRESH_COOKIE)
    return null
  }

  const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: isProduction, path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }

  setCookie(SESSION_COOKIE, tokenData.access_token, { ...base, maxAge: tokenData.expires_in ?? 3600 })
  if (tokenData.refresh_token) {
    setCookie(REFRESH_COOKIE, tokenData.refresh_token, { ...base, maxAge: tokenData.refresh_token_expires_in ?? 30 * 24 * 3600 })
  }

  return tokenData.access_token
})

export type SessionIntrospection = 'active' | 'inactive' | 'unavailable'

export async function introspectSessionToken(token: string): Promise<SessionIntrospection> {
  try {
    const res = await fetch(`${vianovaApiUrl()}/oidc/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        client_id: clientId(),
        client_secret: clientSecret(),
      }),
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) return 'unavailable'
    const data = await res.json() as { active?: boolean }
    return data.active === true ? 'active' : 'inactive'
  } catch {
    return 'unavailable'
  }
}

export const logout = createServerFn().handler(async () => {
  const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
  const options = { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }
  deleteCookie(SESSION_COOKIE, options)
  deleteCookie(REFRESH_COOKIE, options)
  return { endSessionUrl: buildEndSessionUrl() }
})

export function manageBillingUrl(): string {
  return `${requireEnv('VITE_VIANOVA_WEB_URL')}/billing`
}

export const VIANOVA_API_URL = requireEnv('VITE_VIANOVA_API_URL')
export const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')
