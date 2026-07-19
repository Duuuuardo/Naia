// Cliente para a central de notificações do Vianova — usado pelo worker.

import { db, workspaces } from '@naia/db'
import { eq } from 'drizzle-orm'

const VIANOVA_API_URL = () => process.env.VIANOVA_API_URL ?? 'http://localhost:5000'
const INTERNAL_SECRET = () => process.env.NAIA_INTERNAL_SECRET ?? 'change-me-internal-secret'

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
  const url = `${VIANOVA_API_URL()}/internal/notifications`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET(),
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
        send_email: input.sendEmail ?? false,
        brand: 'naia',
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[worker:vianova-notifications] erro ao criar notificação:', res.status, text)
      return null
    }

    return (await res.json()) as { id: string }
  } catch (err) {
    console.error('[worker:vianova-notifications] falha na chamada:', err)
    return null
  }
}

export async function notifyWorkspaceOwner(
  workspaceId: string,
  notification: Omit<VianovaNotificationInput, 'userId' | 'workspaceId' | 'sendEmail'>,
  preferenceKey: 'emailOnCampaignCompleted' | 'emailOnCampaignFailed' | 'emailOnCreditsExhausted' | 'emailOnConnectionDisconnected',
): Promise<void> {
  const [workspace] = await db
    .select({ ownerUserId: workspaces.ownerUserId, name: workspaces.name, notificationPreferences: workspaces.notificationPreferences })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  if (!workspace) return
  const prefs = workspace.notificationPreferences ?? {}
  await notifyVianovaUser({
    ...notification,
    userId: workspace.ownerUserId,
    workspaceId,
    workspaceName: workspace.name,
    sendEmail: prefs[preferenceKey] !== false,
  })
}
