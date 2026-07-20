export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[crm/api] Environment variable ${name} is required`)
  }
  return value
}

export function requireEnvInProduction(name: string): string {
  if (process.env.NODE_ENV !== 'production') return process.env[name] ?? ''
  return requireEnv(name)
}
