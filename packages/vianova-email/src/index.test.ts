import { describe, it, expect, mock } from 'bun:test'
import { createVianovaEmailClient } from './index'

describe('createVianovaEmailClient', () => {
  it('enqueues an email via x-internal-secret', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ enqueued: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createVianovaEmailClient({
      vianovaApiUrl: 'http://localhost:5000',
      internalSecret: 'test-secret',
    })

    const result = await client.enqueue({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      brand: 'naia',
      workspaceId: 'ws-123',
    })

    expect(result).toEqual({ enqueued: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5000/internal/email/enqueue')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-internal-secret': 'test-secret',
    })

    const body = JSON.parse(init?.body as string)
    expect(body).toMatchObject({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      brand: 'naia',
      workspace_id: 'ws-123',
      product_slug: 'naia',
    })
  })

  it('throws when enqueue fails', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createVianovaEmailClient({
      vianovaApiUrl: 'http://localhost:5000',
      internalSecret: 'wrong-secret',
    })

    await expect(
      client.enqueue({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        brand: 'naia',
      }),
    ).rejects.toThrow('Falha ao enfileirar email: 401 Unauthorized')
  })
})
