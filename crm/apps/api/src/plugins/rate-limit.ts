import { Elysia } from 'elysia'

export type RateLimitConfig = {
  windowMs: number
  maxRequests: number
}

export type RateLimitStore = Map<string, { count: number; resetAt: number }>

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return '127.0.0.1'
}

export function createRateLimitPlugin(config: RateLimitConfig) {
  const store: RateLimitStore = new Map()

  return new Elysia({ name: 'rate-limit' }).onRequest(({ request, set }) => {
    const now = Date.now()
    const key = `${getClientIp(request)}:${request.method}:${new URL(request.url).pathname}`
    let entry = store.get(key)

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + config.windowMs }
      store.set(key, entry)
    }

    entry.count += 1

    if (entry.count > config.maxRequests) {
      set.status = 429
      return { message: 'Too many requests. Please try again later.' }
    }
  })
}
