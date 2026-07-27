import { createCrmClient } from '@crm/client'

function requireEnv(name: string): string {
  const value = typeof window !== 'undefined' ? import.meta.env?.[name] : process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[crm/web] ${name} is required`)
  }
  return value
}

// Browser: URL pública (baked no bundle pelo Vite).
// Server: URL interna Docker preferida; cai para CRM_API_URL.
export const API_URL =
  typeof window !== 'undefined'
    ? requireEnv('VITE_CRM_API_URL')
    : process.env.CRM_API_INTERNAL_URL || requireEnv('CRM_API_URL')

export function apiClient(token?: string) {
  return createCrmClient(API_URL, token)
}
