import { createNaiaClient } from '@naia/client'

function requireEnv(name: string): string {
  const value =
    typeof window !== 'undefined' ? import.meta.env?.[name] : process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[naia/web] ${name} is required`)
  }
  return value
}

export const API_URL =
  typeof window !== 'undefined'
    ? requireEnv('VITE_NAIA_API_URL')
    : (process.env.NAIA_API_INTERNAL_URL || requireEnv('NAIA_API_URL'))

export function apiClient(token?: string) {
  return createNaiaClient(API_URL, token)
}
