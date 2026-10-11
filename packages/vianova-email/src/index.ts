export type EmailBrand = 'vianova' | 'naia'

export interface EnqueueEmailOptions {
  to: string
  subject: string
  html: string
  brand: EmailBrand
  from?: string
  replyTo?: string
  workspaceId?: string
}

export interface VianovaEmailClientOptions {
  vianovaApiUrl: string
  internalSecret: string
}

export function createVianovaEmailClient(options: VianovaEmailClientOptions) {
  return {
    async enqueue(opts: EnqueueEmailOptions): Promise<{ enqueued: boolean }> {
      const res = await fetch(`${options.vianovaApiUrl}/internal/email/enqueue`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': options.internalSecret,
        },
        body: JSON.stringify({
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          brand: opts.brand,
          from: opts.from,
          reply_to: opts.replyTo,
          workspace_id: opts.workspaceId,
          product_slug: 'naia',
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Falha ao enfileirar email: ${res.status} ${body}`)
      }

      return (await res.json()) as { enqueued: boolean }
    },
  }
}
