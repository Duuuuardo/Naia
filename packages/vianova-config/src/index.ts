export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue }
export type ConfigMap = Record<string, ConfigValue>

export type VianovaConfigClientOptions = {
  baseUrl: string
  serviceToken?: string
  internalSecret?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createVianovaConfigClient({ baseUrl, serviceToken, internalSecret }: VianovaConfigClientOptions) {
  if (!serviceToken && !internalSecret) {
    throw new Error('Either serviceToken or internalSecret must be provided')
  }

  return {
    async get(product: string, environment: string): Promise<ConfigMap> {
      const url = new URL(`/config/${product}/${environment}`, baseUrl)
      const headers: Record<string, string> = {}

      if (serviceToken) {
        headers.authorization = `Bearer ${serviceToken}`
      }
      if (internalSecret) {
        headers['x-internal-secret'] = internalSecret
      }

      const maxAttempts = 30
      const delayMs = 500
      let lastError: unknown

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response: Response
        try {
          response = await fetch(url, { headers })
        } catch (err) {
          lastError = err
          if (attempt === maxAttempts) break
          console.log(`[config] waiting for config-server... (${attempt}/${maxAttempts})`)
          await sleep(delayMs)
          continue
        }

        if (!response.ok) {
          const body = await response.text()
          throw new Error(`config-server error ${response.status}: ${body}`)
        }

        const json = (await response.json()) as { config: ConfigMap }
        return json.config
      }

      throw lastError
    },
  }
}

export type VianovaConfigClient = ReturnType<typeof createVianovaConfigClient>
