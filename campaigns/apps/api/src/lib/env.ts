import { timingSafeEqual } from 'node:crypto'

// Helpers para leitura defensiva de variáveis de ambiente.
//
// - `getRequiredEnv`: falha fatal sempre que a variável não estiver definida.
//   Use para secrets e endpoints obrigatórios.
// - `requireInProd`: obrigatória em produção; em dev pode cair em fallback
//   controlado (localhost) para não quebrar o ambiente local.

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

/**
 * Comparação constant-time de segredos.
 * Retorna false imediatamente se o valor fornecido for vazio.
 */
export function verifySecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}
