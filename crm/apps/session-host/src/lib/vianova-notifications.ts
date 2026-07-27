// Cliente para a central de notificações do Vianova — avisa o owner do
// workspace quando uma sessão de canal cai (ex.: WhatsApp desconectado no
// celular). Portado do session-host do Campaigns; aqui o owner sai de
// workspace_managers (role 'owner') — o CRM não guarda ownerUserId em
// workspaces nem preferências de notificação por workspace.

import { db, workspaces, workspaceManagers } from '@crm/db'
import { eq, and } from 'drizzle-orm'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[session-host:vianova-notifications] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

const VIANOVA_API_URL = requireEnv('VIANOVA_API_URL')
const INTERNAL_SECRET = requireEnv('VIANOVA_INTERNAL_SECRET')
export const CRM_WEB_URL = requireEnv('CRM_WEB_URL')

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
  sendEmail?: boolean
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
        product_slug: 'naia-crm',
        send_email: input.sendEmail ?? false,
        // O endpoint do Vianova só aceita 'vianova' | 'naia' como brand de email.
        brand: 'naia',
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[session-host:vianova-notifications] erro ao criar notificação:', res.status, text)
      return null
    }

    return (await res.json()) as { id: string }
  } catch (err) {
    console.error('[session-host:vianova-notifications] falha na chamada:', err)
    return null
  }
}

export async function notifyWorkspaceOwner(
  workspaceId: string,
  notification: Omit<VianovaNotificationInput, 'userId' | 'workspaceId'>,
): Promise<void> {
  const [owner] = await db
    .select({ vianovaUserId: workspaceManagers.vianovaUserId })
    .from(workspaceManagers)
    .where(and(eq(workspaceManagers.workspaceId, workspaceId), eq(workspaceManagers.role, 'owner')))
    .limit(1)
  if (!owner) return

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  await notifyVianovaUser({
    ...notification,
    userId: owner.vianovaUserId,
    workspaceId,
    workspaceName: workspace?.name,
    sendEmail: notification.sendEmail ?? true,
  })
}
