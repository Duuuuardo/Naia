import { db, campaigns, campaignRuns, campaignMessages } from '@naia/db'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import type { StatusWebhookJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'

async function bumpCounters(
  campaignId: string,
  runId: string | null,
  field: 'deliveredCount' | 'readCount' | 'failedCount',
): Promise<void> {
  await db.update(campaigns).set({
    [field]: sql`${campaigns[field]} + 1`,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, campaignId))

  if (runId) {
    await db.update(campaignRuns).set({
      [field]: sql`${campaignRuns[field]} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaignRuns.id, runId))
  }
}

export async function handleStatusWebhook(job: StatusWebhookJob): Promise<void> {
  const { externalMessageId, status, timestamp, reason } = job

  if (!externalMessageId) return

  const [msg] = await db
    .select()
    .from(campaignMessages)
    .where(eq(campaignMessages.externalMessageId, externalMessageId))
    .limit(1)

  if (!msg) return

  const ts = new Date(timestamp)

  if (msg.status === 'failed') return

  if (status === 'delivered') {
    const updated = await db.update(campaignMessages).set({
      deliveredAt: ts,
      updatedAt: new Date(),
      ...(msg.status !== 'read' ? { status: 'delivered' as const } : {}),
    }).where(and(eq(campaignMessages.id, msg.id), isNull(campaignMessages.deliveredAt)))
      .returning({ id: campaignMessages.id })

    if (updated.length > 0) {
      await bumpCounters(msg.campaignId, msg.runId, 'deliveredCount')
    }
  } else if (status === 'read') {
    const delivered = await db.update(campaignMessages).set({
      deliveredAt: ts,
      updatedAt: new Date(),
    }).where(and(eq(campaignMessages.id, msg.id), isNull(campaignMessages.deliveredAt)))
      .returning({ id: campaignMessages.id })
    if (delivered.length > 0) {
      await bumpCounters(msg.campaignId, msg.runId, 'deliveredCount')
    }

    const read = await db.update(campaignMessages).set({
      status: 'read',
      readAt: ts,
      updatedAt: new Date(),
    }).where(and(eq(campaignMessages.id, msg.id), isNull(campaignMessages.readAt)))
      .returning({ id: campaignMessages.id })
    if (read.length > 0) {
      await bumpCounters(msg.campaignId, msg.runId, 'readCount')
    }
  } else if (status === 'failed') {
    const cleanReason = reason ? sanitizeErrorMessage(reason, 'Falha reportada pelo gateway') : 'Falha reportada pelo gateway'
    const updated = await db.update(campaignMessages).set({
      status: 'failed',
      failureReason: cleanReason,
      updatedAt: new Date(),
    }).where(and(eq(campaignMessages.id, msg.id), inArray(campaignMessages.status, ['sending', 'sent'])))
      .returning({ id: campaignMessages.id })
    if (updated.length > 0) {
      await bumpCounters(msg.campaignId, msg.runId, 'failedCount')
    }
  }
}
