export function requireEnv(name: string): string {
  const value = import.meta.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[naia/web] ${name} is required`)
  }
  return value
}
