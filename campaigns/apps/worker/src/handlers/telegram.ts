import { db, connections, campaigns, campaignRuns, campaignMessages, contacts, contactIdentities } from '@naia/db'
import { eq, and, sql } from 'drizzle-orm'
import type { SendMessageJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'
import { getQueue, QUEUES } from '@naia/queue'
import { enqueueOptOutFollowup, OPTOUT_FOLLOWUP_TELEGRAM } from '../lib/followup'

/**
 * Todo Telegram é conta de usuário (MTProto): o cliente teleproto vive
 * exclusivamente no processo da API — mesmo padrão do WhatsApp/Baileys.
 * O worker nunca abre sessão própria, envia via /internal/telegram-user-send.
 */
async function sendViaUserApi(
  connectionId: string,
  target: string,
  content: string,
  media?: SendMessageJob['media'],
): Promise<{ externalMessageId: string }> {
  const apiUrl = process.env.NAIA_API_URL ?? 'http://localhost:4001'
  const secret = process.env.NAIA_INTERNAL_SECRET ?? ''

  const res = await fetch(`${apiUrl}/internal/telegram-user-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify({ connectionId, target, content, media }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    throw new Error(`API retornou status ${res.status} ao tentar enviar mensagem Telegram.`)
  }

  const data = (await res.json()) as { success: boolean; externalMessageId?: string; error?: string }
  if (!data.success) throw new Error(data.error ?? 'Falha ao enviar mensagem via API.')
  return { externalMessageId: data.externalMessageId ?? '' }
}

export async function handleTelegramSend(job: SendMessageJob): Promise<void> {
  const { campaignId, campaignMessageId, contactId, connectionId, content } = job

  // Follow-up de opt-out: melhor esforço, sem escrita no banco, falha nunca
  // propaga — um erro aqui não pode reprocessar a mensagem da campanha.
  if (job.kind === 'followup') {
    try {
      const chatId = await resolveTelegramChatId(contactId)
      // MTProto não interpreta HTML — o follow-up vai como texto puro
      if (chatId) await sendViaUserApi(connectionId, chatId, content.replace(/<[^>]+>/g, ''))
    } catch (err) {
      console.warn(`[worker-telegram] follow-up de opt-out falhou (ignorado): ${sanitizeErrorMessage(err, 'erro')}`)
    }
    return
  }

  const [conn] = await db
    .select({ id: connections.id, status: connections.status })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (!conn || conn.status !== 'active') {
    await markFailed(campaignMessageId, campaignId, 'Conexão Telegram inativa ou não encontrada.', job.runId)
    return
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)

  if (!contact) {
    await markFailed(campaignMessageId, campaignId, 'Contato não encontrado.', job.runId)
    return
  }

  const tgChatId = await resolveTelegramChatId(contactId, contact.telegramChatId)

  if (!tgChatId) {
    await markFailed(campaignMessageId, campaignId, 'Contato sem Telegram chat ID ou identidade vinculada.', job.runId)
    return
  }

  if (!contact.optInStatus) {
    await markFailed(campaignMessageId, campaignId, 'Contato optou por não receber campanhas (Opt-out).', job.runId)
    return
  }

  try {
    // MTProto não interpreta HTML — remove as tags do template
    const { externalMessageId } = await sendViaUserApi(connectionId, tgChatId, content.replace(/<[^>]+>/g, ''), job.media)

    await db.update(campaignMessages).set({
      status: 'sent',
      externalMessageId,
      sentAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaignMessages.id, campaignMessageId))

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

    // Aviso de opt-out como mensagem separada, alguns segundos depois —
    // não conta na cota (não gera linha em campaign_messages).
    await enqueueOptOutFollowup(getQueue<SendMessageJob>(QUEUES.TELEGRAM_OUTBOUND), job, OPTOUT_FOLLOWUP_TELEGRAM)
  } catch (err) {
    await markFailed(campaignMessageId, campaignId, sanitizeErrorMessage(err, 'Falha ao processar envio da mensagem pelo Telegram.'), job.runId)
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

// Conclusão de run/campanha é responsabilidade do pacer — aqui só contadores.
export async function markFailed(messageId: string, campaignId: string, reason: string, runId?: string): Promise<void> {
  const cleanReason = sanitizeErrorMessage(reason, 'Falha no envio da mensagem.')
  await db.update(campaignMessages).set({
    status: 'failed',
    failureReason: cleanReason,
    updatedAt: new Date(),
  }).where(eq(campaignMessages.id, messageId))

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
