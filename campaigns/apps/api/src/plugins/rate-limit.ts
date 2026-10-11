import { Elysia } from 'elysia'

export interface RateLimitOptions {
  windowMs: number
  max: number
  keyPrefix?: string
  /** Path prefixes that should not count toward the rate limit (e.g. auth checks). */
  exclude?: string[]
}

interface Bucket {
  count: number
  resetAt: number
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const last = forwarded.split(',').pop()?.trim()
    if (last) return last
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

// Rate limiter simples em memória (janela fixa por IP + rota/prefixo).
// Em deploy multi-instância ele atua por réplica; para limites globais,
// substituir por um backend compartilhado (Redis) no futuro.
export function rateLimitPlugin(options: RateLimitOptions) {
  const store = new Map<string, Bucket>()
  const { windowMs, max, keyPrefix = 'global', exclude = [] } = options

  return new Elysia({ name: 'rate-limit' }).onBeforeHandle(
    { as: 'global' },
    ({ request, set }) => {
      const pathname = new URL(request.url).pathname
      if (exclude.some((prefix) => pathname.startsWith(prefix))) {
        return
      }

      const ip = getClientIp(request)
      const key = `${keyPrefix}:${ip}`
      const now = Date.now()

      const bucket = store.get(key)
      if (!bucket || now > bucket.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs })
        return
      }

      bucket.count++
      if (bucket.count > max) {
        set.status = 429
        set.headers['Retry-After'] = String(Math.ceil((bucket.resetAt - now) / 1000))
        return { message: 'Too many requests. Please slow down.' }
      }
    },
  )
}
