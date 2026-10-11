
const PERMANENT_PATTERNS = [
  /could not find the input entity/i,
  /PEER_ID_INVALID/,
  /USER_ID_INVALID/,
  /PHONE_NUMBER_INVALID/,
  /USERNAME_INVALID/,
  /USERNAME_NOT_OCCUPIED/,
  /USER_NOT_MUTUAL_CONTACT/,
  /USER_PRIVACY_RESTRICTED/,
  /USER_IS_BLOCKED/,
  /BOT_GROUPS_BLOCKED/,
  /CHAT_WRITE_FORBIDDEN/,
  /USER_NOT_PARTICIPANT/,
  /CHANNEL_PRIVATE/,
  /USER_DELETED/,
  /INPUT_USER_DEACTIVATED/,
]

const RATE_LIMIT_PATTERNS = [/FLOOD_WAIT/, /FLOOD_PREMIUM_WAIT/, /SLOW_MODE_WAIT/]

export function isRetryableProviderError(err: unknown): boolean {
  const parts = [err instanceof Error ? err.message : String(err)]
  const rpcCode = (err as { errorMessage?: unknown })?.errorMessage
  if (typeof rpcCode === 'string') parts.push(rpcCode)
  const text = parts.join(' ')

  if (RATE_LIMIT_PATTERNS.some((p) => p.test(text))) return true
  return !PERMANENT_PATTERNS.some((p) => p.test(text))
}
