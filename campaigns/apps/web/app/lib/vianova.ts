import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'

// Naia não tem cadastro/login próprio — este módulo é o único ponto do
// frontend que fala com o OIDC do Vianova (fluxo Authorization Code). Tudo
// aqui roda só no servidor (createServerFn): o segredo do client OIDC nunca
// chega ao bundle do browser.

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[naia/web] ${name} is required`)
  }
  return value
}

const vianovaApiUrl = () => process.env.VIANOVA_API_INTERNAL_URL || requireEnv('VIANOVA_API_URL')
const vianovaApiPublicUrl = () => requireEnv('VIANOVA_API_URL')
const naiaWebUrl = () => requireEnv('NAIA_WEB_URL')
const clientId = () => requireEnv('NAIA_OIDC_CLIENT_ID')
const clientSecret = () => requireEnv('NAIA_OIDC_CLIENT_SECRET')

const isProduction = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE = 'naia_session'
export const REFRESH_COOKIE = 'naia_refresh'

const REDIRECT_URI = () => `${naiaWebUrl()}/auth/callback`

function cookieBase() {
  const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  }
}

function setSessionCookie(accessToken: string, expiresIn: number) {
  setCookie(SESSION_COOKIE, accessToken, { ...cookieBase(), maxAge: expiresIn })
}

function setRefreshCookie(refreshToken: string, expiresIn: number) {
  setCookie(REFRESH_COOKIE, refreshToken, { ...cookieBase(), maxAge: expiresIn })
}

export const buildLoginUrl = createServerFn()
  .validator((data: { redirectTo?: string }) => data)
  .handler(async ({ data }) => {
    const url = new URL(`${vianovaApiPublicUrl()}/oidc/authorize`)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', REDIRECT_URI())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', data.redirectTo && data.redirectTo.startsWith('/') ? data.redirectTo : '/')
    return url.toString()
  })

export const completeLogin = createServerFn()
  .validator((data: { code: string; state?: string }) => data)
  .handler(async ({ data }) => {
    const res = await fetch(`${vianovaApiUrl()}/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: data.code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: REDIRECT_URI(),
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

    setSessionCookie(tokenData.access_token, tokenData.expires_in ?? 3600)
    if (tokenData.refresh_token) {
      setRefreshCookie(tokenData.refresh_token, tokenData.refresh_token_expires_in ?? 30 * 24 * 3600)
    }

    return {
      ok: true as const,
      redirectTo: data.state && data.state.startsWith('/') ? data.state : '/',
    }
  })

// Renova silenciosamente o access token usando o refresh token.
// Retorna o novo access token ou null se o refresh token expirou/foi revogado.
// Chame ANTES de redirecionar para /login — se retornar um token, o usuário
// continua sem precisar autenticar de novo.
export async function tryRefreshSession(): Promise<string | null> {
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

  setSessionCookie(tokenData.access_token, tokenData.expires_in ?? 3600)
  if (tokenData.refresh_token) {
    setRefreshCookie(tokenData.refresh_token, tokenData.refresh_token_expires_in ?? 30 * 24 * 3600)
  }

  return tokenData.access_token
}

// Retorna a URL do endpoint end_session do Vianova para o browser navegar até
// lá e encerrar a sessão SSO. É o único jeito de garantir single sign-out
// correto: o browser leva o vianova_session cookie até o Vianova, que o revoga
// e dispara o webhook session:revoked para todos os produtos.
export function buildEndSessionUrl(): string {
  const url = new URL(`${vianovaApiPublicUrl()}/oidc/end_session`)
  url.searchParams.set('post_logout_redirect_uri', `${naiaWebUrl()}/login`)
  return url.toString()
}

export const logout = createServerFn().handler(async () => {
  deleteCookie(SESSION_COOKIE)
  deleteCookie(REFRESH_COOKIE)
  // Retorna a URL para o browser navegar ao end_session do Vianova —
  // o Vianova revoga a sessão e dispara o webhook single sign-out nos demais
  // produtos antes de redirecionar de volta ao /login da Naia.
  return { endSessionUrl: buildEndSessionUrl() }
})

export function manageBillingUrl(): string {
  return `${requireEnv('VIANOVA_WEB_URL')}/billing`
}

export const VIANOVA_API_URL = requireEnv('VIANOVA_API_URL')
export const VIANOVA_WEB_URL = requireEnv('VIANOVA_WEB_URL')
