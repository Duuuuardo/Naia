// Cliente para a central de notificações do Vianova. O Naia Campanhas envia
// notificações na conta do usuário via endpoint service-to-service, autenticado
// pelo segredo interno compartilhado (x-internal-secret).

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[api:vianova-notifications] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

const VIANOVA_API_URL = requireEnv('VIANOVA_API_URL')
const INTERNAL_SECRET = requireEnv('NAIA_INTERNAL_SECRET')

export type VianovaNotificationType = 'billing' | 'security' | 'product' | 'marketing'

export interface VianovaNotificationInput {
  userId: string
  type: VianovaNotificationType
  title: string
  body?: string
  workspaceId?: string
  workspaceName?: string
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, unknown>
}

export async function notifyVianovaUser(input: VianovaNotificationInput): Promise<{ id: string } | null> {
  const url = `${VIANOVA_API_URL}/internal/notifications`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        workspace_id: input.workspaceId,
        workspace_name: input.workspaceName,
        action_url: input.actionUrl,
        action_label: input.actionLabel,
        metadata: input.metadata,
        product_slug: 'naia',
        brand: 'naia',
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[vianova-notifications] erro ao criar notificação:', res.status, text)
      return null
    }

    return (await res.json()) as { id: string }
  } catch (err) {
    console.error('[vianova-notifications] falha na chamada:', err)
    return null
  }
}
