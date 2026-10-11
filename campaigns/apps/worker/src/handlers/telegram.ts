import { db, connections, campaigns, campaignRuns, campaignMessages, contacts, contactIdentities, entitlements } from '@naia/db'
import { eq, and, sql } from 'drizzle-orm'
import type { SendMessageJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'
import { getQueue, getOutboundQueueName } from '@naia/queue'
import { sendTelegramUserMessage, isRetryableSendError } from '@naia/session-host-client'
import { enqueueOptOutFollowup, OPTOUT_FOLLOWUP_TELEGRAM } from '../lib/followup'
import { requeueSendingMessage, refundCredits } from '../lib/requeue'

export async function handleTelegramSend(job: SendMessageJob): Promise<void> {
  const { campaignId, campaignMessageId, contactId, connectionId, content } = job

  if (job.kind === 'followup') {
    try {
      const chatId = await resolveTelegramChatId(contactId)
      if (chatId) await sendTelegramUserMessage(connectionId, chatId, content.replace(/<[^>]+>/g, ''))
    } catch (err) {
      console.warn(`[worker-telegram] follow-up de opt-out falhou (ignorado): ${sanitizeErrorMessage(err, 'erro')}`)
    }
    return
  }

  const [campaign] = await db
    .select({ status: campaigns.status, workspaceId: campaigns.workspaceId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
  if (!campaign || campaign.status === 'cancelled') return

  if (campaign.status === 'paused') {
    await requeueSendingMessage(campaignMessageId, campaign.workspaceId)
    return
  }

  const [msg] = await db
    .select({ status: campaignMessages.status })
    .from(campaignMessages)
    .where(eq(campaignMessages.id, campaignMessageId))
    .limit(1)
  if (!msg || msg.status !== 'sending') return

  const [conn] = await db
    .select({ id: connections.id, status: connections.status })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (!conn || conn.status !== 'active') {
    await requeueSendingMessage(campaignMessageId, campaign.workspaceId)
    return
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)

  if (!contact) {
    await markFailed(campaignMessageId, campaignId, 'Contato não encontrado.', job.runId, { refundWorkspaceId: campaign.workspaceId })
    return
  }

  const tgChatId = await resolveTelegramChatId(contactId, contact.telegramChatId)

  if (!tgChatId) {
    await markFailed(campaignMessageId, campaignId, 'Contato sem Telegram chat ID ou identidade vinculada.', job.runId, { refundWorkspaceId: campaign.workspaceId })
    return
  }

  if (!contact.optInStatus) {
    await markFailed(campaignMessageId, campaignId, 'Contato optou por não receber campanhas (Opt-out).', job.runId, { refundWorkspaceId: campaign.workspaceId })
    return
  }

  try {
    const { externalMessageId } = await sendTelegramUserMessage(connectionId, tgChatId, content.replace(/<[^>]+>/g, ''), job.media, { idempotencyKey: campaignMessageId })

    const updated = await db.update(campaignMessages).set({
      status: 'sent',
      externalMessageId: externalMessageId || null,
      sentAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(campaignMessages.id, campaignMessageId), eq(campaignMessages.status, 'sending')))
      .returning({ id: campaignMessages.id })

    if (updated.length > 0) {
      await db.update(campaigns).set({
        sentCount: sql`${campaigns.sentCount} + 1`,
        updatedAt: new Date(),
      }).where(eq(campaigns.id, campaignId))

      if (job.runId) {
        await db.update(campaignRuns).set({
          sentCount: sql`${campaignRuns.sentCount} + 1`,
          updatedAt: new Date(),
        }).where(eq(campaignRuns.id, job.runId))
      }
    }
  } catch (err) {
    const clean = sanitizeErrorMessage(err, 'Falha ao processar envio da mensagem pelo Telegram.')
    if (!isRetryableSendError(err)) {
      await markFailed(campaignMessageId, campaignId, clean, job.runId)
      return
    }
    console.warn(`[worker-telegram] falha transitória na mensagem ${campaignMessageId} — BullMQ retenta: ${clean}`)
    throw err
  }

  if (!contact.isGroup) {
    try {
      const [ent] = await db.select({ tier: entitlements.tier }).from(entitlements).where(eq(entitlements.workspaceId, contact.workspaceId)).limit(1)
      const queueName = getOutboundQueueName('telegram', contact.workspaceId, ent?.tier)
      await enqueueOptOutFollowup(getQueue<SendMessageJob>(queueName), job, OPTOUT_FOLLOWUP_TELEGRAM)
    } catch (err) {
      console.warn(`[worker-telegram] follow-up de opt-out não enfileirado (ignorado): ${sanitizeErrorMessage(err, 'erro')}`)
    }
  }
}

async function resolveTelegramChatId(contactId: string, direct?: string | null): Promise<string | null> {
  if (direct) return direct
  const [contact] = await db
    .select({ telegramChatId: contacts.telegramChatId })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)
  if (contact?.telegramChatId) return contact.telegramChatId
  const [idRow] = await db
    .select({ identifier: contactIdentities.channelIdentifier })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.channelType, 'telegram')))
    .limit(1)
  return idRow?.identifier ?? null
}

export async function markFailed(
  messageId: string,
  campaignId: string,
  reason: string,
  runId?: string,
  opts?: { refundWorkspaceId?: string },
): Promise<void> {
  const cleanReason = sanitizeErrorMessage(reason, 'Falha no envio da mensagem.')

  const updated = await db.update(campaignMessages).set({
    status: 'failed',
    failureReason: cleanReason,
    updatedAt: new Date(),
  }).where(and(eq(campaignMessages.id, messageId), eq(campaignMessages.status, 'sending')))
    .returning({ id: campaignMessages.id })

  if (updated.length === 0) return

  if (opts?.refundWorkspaceId) {
    await refundCredits(opts.refundWorkspaceId, 1)
  }

  await db.update(campaigns).set({
    failedCount: sql`${campaigns.failedCount} + 1`,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, campaignId))

  if (runId) {
    await db.update(campaignRuns).set({
      failedCount: sql`${campaignRuns.failedCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaignRuns.id, runId))
  }
}
