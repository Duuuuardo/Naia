import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[vianova-auth] ${name} is required`)
  }
  return value
}

const VIANOVA_API_URL = requireEnv('VIANOVA_API_URL')
const VIANOVA_WEB_URL = requireEnv('VIANOVA_WEB_URL')

function requireClientId(): string {
  const value = process.env.NAIA_OIDC_CLIENT_ID
  if (!value) {
    throw new Error('[vianova-auth] NAIA_OIDC_CLIENT_ID is required')
  }
  return value
}

function requireClientSecret(): string {
  const value = process.env.NAIA_OIDC_CLIENT_SECRET
  if (!value) {
    throw new Error('[vianova-auth] NAIA_OIDC_CLIENT_SECRET is required')
  }
  return value
}

const jwks = createRemoteJWKSet(new URL(`${VIANOVA_API_URL}/.well-known/jwks.json`))

export function buildAuthorizeUrl(opts: { redirectUri: string; state: string }): string {
  const url = new URL(`${VIANOVA_API_URL}/oidc/authorize`)
  url.searchParams.set('client_id', requireClientId())
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
      client_id: requireClientId(),
      client_secret: requireClientSecret(),
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) return null
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) return null
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 }
}

export interface VianovaUser {
  userId: string
  email: string
  name: string
  picture: string | null
  pictureFrame: string | null
  sid: string
  emailVerified: boolean
}

export async function verifyUserToken(token: string): Promise<VianovaUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: VIANOVA_API_URL,
      audience: requireClientId(),
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
      emailVerified: payload.email_verified === true,
    }
  } catch {
    return null
  }
}

export async function verifyServiceToken(
  token: string,
  expectedScope: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: VIANOVA_API_URL,
      audience: requireClientId(),
      subject: 'vianova-service',
    })
    return payload.scope === expectedScope
  } catch {
    return false
  }
}

export async function introspectToken(token: string): Promise<
  { active: false } | { active: true; sub: string; sid: string }
> {
  const res = await fetch(`${VIANOVA_API_URL}/oidc/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, client_id: requireClientId(), client_secret: requireClientSecret() }),
  })
  if (!res.ok) return { active: false }
  const data = (await res.json()) as JWTPayload & { active: boolean }
  if (!data.active || typeof data.sub !== 'string' || typeof data.sid !== 'string') {
    return { active: false }
  }
  return { active: true, sub: data.sub, sid: data.sid }
}

export function manageBillingUrl(): string {
  return `${VIANOVA_WEB_URL}/billing`
}

export { VIANOVA_API_URL, VIANOVA_WEB_URL }
