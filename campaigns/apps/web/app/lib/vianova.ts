import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'

// Naia não tem cadastro/login próprio — este módulo é o único ponto do
// frontend que fala com o OIDC do Vianova (fluxo Authorization Code). Tudo
// aqui roda só no servidor (createServerFn): o segredo do client OIDC nunca
// chega ao bundle do browser.

const vianovaApiUrl = () => process.env.VIANOVA_API_URL ?? 'http://localhost:5000'
const naiaWebUrl = () => process.env.NAIA_WEB_URL ?? 'http://localhost:3001'
const clientId = () => process.env.NAIA_OIDC_CLIENT_ID ?? 'naia'
const clientSecret = () => process.env.NAIA_OIDC_CLIENT_SECRET ?? 'naia-dev-secret'

export const SESSION_COOKIE = 'naia_session'
const REDIRECT_URI = () => `${naiaWebUrl()}/auth/callback`

export const buildLoginUrl = createServerFn()
  .validator((data: { redirectTo?: string }) => data)
  .handler(async ({ data }) => {
    const url = new URL(`${vianovaApiUrl()}/oidc/authorize`)
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
    const tokenData = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!tokenData.access_token) return { ok: false as const }

    setCookie(SESSION_COOKIE, tokenData.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: tokenData.expires_in ?? 3600,
    })

    return {
      ok: true as const,
      redirectTo: data.state && data.state.startsWith('/') ? data.state : '/',
    }
  })

export const logout = createServerFn().handler(async () => {
  deleteCookie(SESSION_COOKIE)

  // Best-effort: se o cookie de sessão do Vianova chegou até aqui (em dev os
  // dois rodam em localhost), encerra a sessão lá também — derruba os demais
  // produtos via single sign-out. Roda no servidor: o browser nunca chama o
  // Vianova via fetch manual (regra do M2).
  const vianovaSession = getCookie('vianova_session')
  if (vianovaSession) {
    try {
      await fetch(`${vianovaApiUrl()}/auth/logout`, {
        method: 'POST',
        headers: { cookie: `vianova_session=${vianovaSession}` },
      })
    } catch {
      /* melhor esforço — a sessão do Naia já caiu */
    }
  }
})
