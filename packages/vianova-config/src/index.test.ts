import { describe, it, expect, mock } from 'bun:test'
import { createVianovaConfigClient } from './index'

describe('createVianovaConfigClient', () => {
  it('fetches config for a product and environment', async () => {
    const config = {
      app: { name: 'Naia', url: 'http://localhost:3301' },
      features: { campaigns: true },
    }

    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ config }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createVianovaConfigClient({
      baseUrl: 'http://localhost:5100',
      serviceToken: 'test-token',
    })

    const result = await client.get('naia', 'development')

    expect(result).toEqual(config)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:5100/config/naia/development')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer test-token',
    })
  })

  it('throws on config-server error', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response('Forbidden', { status: 403 })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createVianovaConfigClient({
      baseUrl: 'http://localhost:5100',
      serviceToken: 'invalid-token',
    })

    await expect(client.get('naia', 'development')).rejects.toThrow(
      'config-server error 403: Forbidden',
    )
  })
})
