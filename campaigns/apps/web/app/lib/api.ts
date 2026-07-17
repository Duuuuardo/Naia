import { createNaiaClient } from '@naia/client'

const apiUrl = typeof window !== 'undefined'
  ? (import.meta.env.VITE_NAIA_API_URL ?? 'http://localhost:4001')
  : (process.env.NAIA_API_URL ?? 'http://localhost:4001')

export const API_URL = apiUrl

export function apiClient(token: string) {
  return createNaiaClient(apiUrl, token)
}
