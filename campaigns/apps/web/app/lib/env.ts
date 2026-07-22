export function requireEnv(name: string): string {
  const value =
    typeof window === 'undefined' ? process.env[name] : import.meta.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[naia/web] ${name} is required`)
  }
  return value
}
