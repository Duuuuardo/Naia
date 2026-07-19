import { createVianovaConfigClient, type ConfigMap } from '@naia/vianova-config'

export let productConfig: ConfigMap = {}

export async function loadProductConfig(): Promise<ConfigMap> {
  const baseUrl = process.env.VIANOVA_CONFIG_SERVER_URL
  const internalSecret = process.env.VIANOVA_INTERNAL_SECRET

  if (!baseUrl) {
    console.warn('[config] VIANOVA_CONFIG_SERVER_URL not set, using empty config')
    productConfig = {}
    return productConfig
  }

  const environment =
    process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'staging' ? 'staging' : 'development'

  const client = createVianovaConfigClient({ baseUrl, internalSecret })
  productConfig = await client.get('crm', environment)
  console.log(`[config] loaded crm/${environment}`)
  return productConfig
}

export function getConfigValue<T>(key: string, fallback: T): T {
  const keys = key.split('.')
  let value: unknown = productConfig

  for (const k of keys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fallback
    }
    value = (value as Record<string, unknown>)[k]
  }

  return (value as T) ?? fallback
}
