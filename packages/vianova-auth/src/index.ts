import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const VIANOVA_API_URL = process.env.VIANOVA_API_URL ?? 'http://localhost:5000'
const VIANOVA_WEB_URL = process.env.VIANOVA_WEB_URL ?? 'http://localhost:3000'
const CLIENT_ID = process.env.NAIA_OIDC_CLIENT_ID ?? 'naia'
const CLIENT_SECRET = process.env.NAIA_OIDC_CLIENT_SECRET ?? 'naia-dev-secret'

// Cacheado pelo próprio jose (por URL) — sem round-trip ao Vianova a cada
// verificação de token, só quando o cache do JWKS expira/precisa de um `kid`
// novo (rotação de chave).
const jwks = createRemoteJWKSet(new URL(`${VIANOVA_API_URL}/.well-known/jwks.json`))

// ─── Fluxo de login (Authorization Code) ─────────────────────────────────────

export function buildAuthorizeUrl(opts: { redirectUri: string; state: string }): string {
  const url = new URL(`${VIANOVA_API_URL}/oidc/authorize`)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export function buildLoginRedirectUrl(redirectUri: string, state: string): string {
  return buildAuthorizeUrl({ redirectUri, state })
}

export interface TokenExchangeResult {
  accessToken: string
  expiresIn: number
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult | null> {
  const res = await fetch(`${VIANOVA_API_URL}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) return null
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) return null
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 }
}

// ─── Validação local de token de usuário ─────────────────────────────────────

export interface VianovaUser {
  userId: string
  email: string
  name: string
  // Avatar da conta Vianova (claims picture/picture_frame) — o Naia só exibe
  // a URL; a imagem vive no storage do Vianova.
  picture: string | null
  pictureFrame: string | null
  sid: string
}

// Verificação 100% local via JWKS — nenhum round-trip ao Vianova no caminho
// quente. Chamador é responsável por checar `revokedSessions` (sid) para
// completar o single sign-out imediato — ver packages/db revokedSessions.
export async function verifyUserToken(token: string): Promise<VianovaUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: VIANOVA_API_URL,
      audience: CLIENT_ID,
    })

    if (!payload.sub || typeof payload.sid !== 'string') return null
    if (typeof payload.scope === 'string' && payload.scope.startsWith('service:')) return null

    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      pictureFrame: typeof payload.picture_frame === 'string' ? payload.picture_frame : null,
      sid: payload.sid,
    }
  } catch {
    return null
  }
}

// ─── Validação de token de serviço (Vianova → Naia) ──────────────────────────
// Usado só pelos endpoints /internal/*. Nunca aceita o JWT de usuário aqui.

export async function verifyServiceToken(
  token: string,
  expectedScope: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: VIANOVA_API_URL,
      audience: CLIENT_ID,
      subject: 'vianova-service',
    })
    return payload.scope === expectedScope
  } catch {
    return false
  }
}

// ─── Introspection síncrona (complementa o webhook de revogação) ────────────

export async function introspectToken(token: string): Promise<
  { active: false } | { active: true; sub: string; sid: string }
> {
  const res = await fetch(`${VIANOVA_API_URL}/oidc/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  })
  if (!res.ok) return { active: false }
  const data = (await res.json()) as JWTPayload & { active: boolean }
  if (!data.active || typeof data.sub !== 'string' || typeof data.sid !== 'string') {
    return { active: false }
  }
  return { active: true, sub: data.sub, sid: data.sid }
}

// ─── Checkout ────────────────────────────────────────────────────────────────
// O checkout (POST {vianova-api}/billing/checkout) NÃO tem um helper aqui:
// o Vianova autentica essa rota pelo cookie de sessão dele (vianova_session),
// que só o browser do usuário guarda — o servidor do Naia nunca tem acesso a
// esse cookie, então a chamada tem que sair do browser (fetch client-side,
// cross-origin, credentials: 'include'). Ver apps/web routes/_app/$workspaceId/billing.tsx
// e docs/architecture.md, seção "Portal de billing".

export function manageBillingUrl(): string {
  return `${VIANOVA_WEB_URL}/billing`
}

export { VIANOVA_API_URL, VIANOVA_WEB_URL, CLIENT_ID }
