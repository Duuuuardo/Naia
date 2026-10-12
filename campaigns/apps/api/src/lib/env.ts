import { timingSafeEqual } from 'node:crypto'

export function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    console.error(`[env] Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
}

export function requireInProd(name: string, devFallback?: string): string {
  const value = process.env[name]
  if (value && value.trim().length > 0) return value

  if (process.env.NODE_ENV === 'production') {
    console.error(`[env] ${name} is required in production`)
    process.exit(1)
  }

  if (devFallback !== undefined) return devFallback

  console.error(`[env] Missing required environment variable: ${name}`)
  process.exit(1)
}

export function verifySecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}
