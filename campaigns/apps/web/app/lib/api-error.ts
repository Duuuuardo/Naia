export function parseApiError(value: unknown, fallback: string): string {
  const val = value as any
  const msg: unknown = val?.message
  if (!msg || typeof msg !== 'string') return fallback
  if (msg.trimStart().startsWith('{') || msg.trimStart().startsWith('[')) return fallback
  return msg
}

export function sanitizeError(msg: string | null | undefined, fallback: string): string {
  if (!msg) return fallback
  const trimmed = msg.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return fallback
  return trimmed
}
