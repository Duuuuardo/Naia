import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'

// Naia não tem cadastro/login próprio — este módulo é o único ponto do
// frontend que fala com o OIDC do Vianova (fluxo Authorization Code). Tudo
// aqui roda só no servidor (createServerFn): o segredo do client OIDC nunca
// chega ao bundle do browser.

function requireEnv(name: string): string {
  // process.env works on the server (Bun/Node); import.meta.env is the Vite
  // object baked into the client bundle — needed because Vite only replaces
  // import.meta.env.VITE_* statically, not process.env[dynamicKey].
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
// Cookie de transação do login: guarda o state (anti-CSRF), o PKCE code_verifier
// e o destino pós-login. httpOnly, vida curta, consumido uma única vez no callback.
const OIDC_TX_COOKIE = 'naia_oidc_tx'
const OIDC_TX_TTL_SECONDS = 600

const REDIRECT_URI = () => `${naiaWebUrl()}/auth/callback`

// Só aceita caminho interno. Bloqueia protocol-relative (//evil, /\evil), que o
// browser trata como URL absoluta — senão o `state`/redirect vira open redirect.
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

// Retorna a URL do endpoint end_session do Vianova. Isomorphic (sem imports
// server-only) — pode ser chamado de qualquer contexto.
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
    // state aleatório (não é mais o caminho de redirect) amarra o callback a
    // este browser; PKCE amarra a troca do código a este mesmo início de fluxo.
    const state = randomToken()
    const verifier = randomToken()
    const challenge = await pkceChallenge(verifier)
    const redirectTo = safeRedirectPath(data.redirectTo)

    setCookie(OIDC_TX_COOKIE, JSON.stringify({ state, verifier, redirectTo }), oidcTxCookieOptions())

    // O navegador entra pelo domínio do serviço Vianova. A URL da API fica
    // encapsulada como continuação segura do login e não como destino inicial.
    const loginUrl = new URL(`${vianovaWebPublicUrl()}/login`)
    loginUrl.searchParams.set('redirect_uri', buildAuthorizeUrl(state, challenge))
    return loginUrl.toString()
  })

export const completeLogin = createServerFn()
  .validator((data: { code: string; state?: string }) => data)
  .handler(async ({ data }) => {
    // Consome o cookie de transação uma única vez, aconteça o que acontecer.
    const txRaw = getCookie(OIDC_TX_COOKIE)
    deleteCookie(OIDC_TX_COOKIE, { path: '/' })
    if (!txRaw) return { ok: false as const }

    let tx: { state?: string; verifier?: string; redirectTo?: string }
    try {
      tx = JSON.parse(txRaw)
    } catch {
      return { ok: false as const }
    }

    // Anti-CSRF: o state que voltou do Vianova tem que ser exatamente o que
    // gravamos no início do fluxo neste browser. Sem isso, um code injetado por
    // atacante (login CSRF / code injection) é rejeitado aqui.
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

// Tenta renovar o access token usando o refresh token armazenado no cookie.
// Retorna o novo access token ou null se o refresh token expirou/foi revogado.
// Wrapped em createServerFn para que o bundler remova o código server-only
// (getCookie/setCookie) do bundle do cliente.
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

// Segunda garantia do single sign-out. O webhook continua sendo o caminho
// rápido no API do Campaigns; esta consulta impede que uma sessão local pareça
// válida quando o webhook estiver atrasado ou indisponível.
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
    // Erro HTTP pode ser indisponibilidade ou configuração do client; só uma
    // resposta 200 com active=false tem autoridade para apagar a sessão.
    if (!res.ok) return 'unavailable'
    const data = await res.json() as { active?: boolean }
    return data.active === true ? 'active' : 'inactive'
  } catch {
    // Falha do Vianova não derruba sessões válidas: o API local ainda verifica
    // assinatura, expiração e a tabela preenchida pelo webhook de revogação.
    return 'unavailable'
  }
}

export const logout = createServerFn().handler(async () => {
  // A remoção deve usar os mesmos atributos do cookie de criação. Sem path e
  // domain idênticos o navegador pode manter uma cópia válida do cookie.
  const cookieDomain = process.env.NAIA_COOKIE_DOMAIN
  const options = { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) }
  deleteCookie(SESSION_COOKIE, options)
  deleteCookie(REFRESH_COOKIE, options)
  // Retorna a URL para o browser navegar ao end_session do Vianova —
  // o Vianova revoga a sessão e dispara o webhook single sign-out nos demais
  // produtos antes de redirecionar de volta ao /login da Naia.
  return { endSessionUrl: buildEndSessionUrl() }
})

export function manageBillingUrl(): string {
  return `${requireEnv('VITE_VIANOVA_WEB_URL')}/billing`
}

export const VIANOVA_API_URL = requireEnv('VITE_VIANOVA_API_URL')
export const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')
