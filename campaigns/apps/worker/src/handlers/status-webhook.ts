import { db, campaigns, campaignRuns, campaignMessages } from '@naia/db'
import { eq, sql } from 'drizzle-orm'
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

// Conclusão de run/campanha é responsabilidade do pacer/recovery — aqui só
// transição de status da mensagem + contadores.
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

  if (status === 'delivered') {
    if (!msg.deliveredAt) {
      const updates: Partial<typeof campaignMessages.$inferInsert> = {
        deliveredAt: ts,
        updatedAt: new Date(),
      }
      if (msg.status !== 'read') {
        updates.status = 'delivered'
      }

      await db.update(campaignMessages).set(updates).where(eq(campaignMessages.id, msg.id))
      await bumpCounters(msg.campaignId, msg.runId, 'deliveredCount')
    }
  } else if (status === 'read') {
    // Se ainda não tinha sido marcada como entregue (pulou direto pra lida), garantimos a entrega
    if (!msg.deliveredAt) {
      await db.update(campaignMessages).set({
        deliveredAt: ts,
        updatedAt: new Date(),
      }).where(eq(campaignMessages.id, msg.id))
      await bumpCounters(msg.campaignId, msg.runId, 'deliveredCount')
    }

    if (!msg.readAt) {
      await db.update(campaignMessages).set({
        status: 'read',
        readAt: ts,
        updatedAt: new Date(),
      }).where(eq(campaignMessages.id, msg.id))
      await bumpCounters(msg.campaignId, msg.runId, 'readCount')
    }
  } else if (status === 'failed') {
    if (msg.status !== 'failed') {
      const cleanReason = reason ? sanitizeErrorMessage(reason, 'Falha reportada pelo gateway') : 'Falha reportada pelo gateway'
      await db.update(campaignMessages).set({
        status: 'failed',
        failureReason: cleanReason,
        updatedAt: new Date(),
      }).where(eq(campaignMessages.id, msg.id))
      await bumpCounters(msg.campaignId, msg.runId, 'failedCount')
    }
  }
}
