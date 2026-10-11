
import { db, campaignMessages, entitlements } from '@naia/db'
import { eq, and, sql } from 'drizzle-orm'

export async function refundCredits(workspaceId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  await db
    .update(entitlements)
    .set({ creditsBalance: sql`${entitlements.creditsBalance} + ${amount}`, updatedAt: new Date() })
    .where(eq(entitlements.workspaceId, workspaceId))
}

export async function requeueSendingMessage(messageId: string, workspaceId: string): Promise<void> {
  const requeued = await db
    .update(campaignMessages)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(and(eq(campaignMessages.id, messageId), eq(campaignMessages.status, 'sending')))
    .returning({ id: campaignMessages.id })
  if (requeued.length === 0) return
  await refundCredits(workspaceId, 1)
}
