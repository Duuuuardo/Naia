import { createVianovaConfigClient, type ConfigMap } from '@naia/vianova-config'

export let productConfig: ConfigMap = {}

const isProduction = () => process.env.NODE_ENV === 'production'

export async function loadProductConfig(): Promise<ConfigMap> {
  const baseUrl = process.env.VIANOVA_CONFIG_SERVER_URL
  const internalSecret = process.env.VIANOVA_INTERNAL_SECRET

  if (!baseUrl) {
    if (isProduction()) {
      console.error('[config] VIANOVA_CONFIG_SERVER_URL is required in production')
      process.exit(1)
    }
    console.warn('[config] VIANOVA_CONFIG_SERVER_URL not set, using empty config')
    productConfig = {}
    return productConfig
  }

  if (!internalSecret) {
    console.error('[config] VIANOVA_INTERNAL_SECRET is required when VIANOVA_CONFIG_SERVER_URL is set')
    process.exit(1)
  }

  const environment =
    process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'staging' ? 'staging' : 'development'

  const client = createVianovaConfigClient({ baseUrl, internalSecret })
  productConfig = await client.get('campaigns', environment)
  console.log(`[config] loaded campaigns/${environment}`)
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
