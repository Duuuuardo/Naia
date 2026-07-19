import { describe, it, expect, mock } from 'bun:test'
import { createVianovaEmailClient } from './index'

describe('createVianovaEmailClient', () => {
  it('enqueues an email via x-internal-secret', async () => {
    let capturedUrl: string | null = null
    let capturedInit: RequestInit | undefined

    const fetchMock = mock((url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return Promise.resolve(
        new Response(JSON.stringify({ enqueued: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
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
    expect(capturedUrl!).toBe('http://localhost:5000/internal/email/enqueue')
    expect(capturedInit!.method).toBe('POST')
    expect(capturedInit!.headers).toMatchObject({
      'content-type': 'application/json',
      'x-internal-secret': 'test-secret',
    })

    const body = JSON.parse(capturedInit!.body as string)
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
