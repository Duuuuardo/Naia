export function resolveApiCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : undefined
  const apiHash = process.env.TELEGRAM_API_HASH
  if (!apiId || !Number.isFinite(apiId) || !apiHash) return null
  return { apiId, apiHash }
}

export function isTelegramUserConfig(config: string | null | undefined): boolean {
  try {
    return (JSON.parse(config ?? '{}') as { kind?: string }).kind === 'user'
  } catch {
    return false
  }
}
