import { db, connections, campaigns, campaignRuns, campaignMessages, contacts, contactIdentities, entitlements } from '@naia/db'
import { eq, and, sql } from 'drizzle-orm'
import type { SendMessageJob } from '@naia/schemas'
import { sanitizeErrorMessage } from '@naia/schemas'
import { getQueue, getOutboundQueueName } from '@naia/queue'
import { sendWhatsAppMessage } from '@naia/session-host-client'
import { enqueueOptOutFollowup, OPTOUT_FOLLOWUP_WHATSAPP } from '../lib/followup'

export async function handleWhatsAppSend(job: SendMessageJob): Promise<void> {
  const { campaignId, campaignMessageId, contactId, connectionId, content } = job

  // Follow-up de opt-out: melhor esforço, sem escrita no banco, falha nunca
  // propaga — um erro aqui não pode reprocessar a mensagem da campanha.
  if (job.kind === 'followup') {
    try {
      const phone = await resolveWhatsAppPhone(contactId)
      if (phone) await sendWhatsAppMessage(connectionId, phone, content)
    } catch (err) {
      console.warn(`[worker-whatsapp] follow-up de opt-out falhou (ignorado): ${sanitizeErrorMessage(err, 'erro')}`)
    }
    return
  }

  // Cancelamento no meio do run: a rota de cancel já marcou esta mensagem
  // como 'failed' — o job em trânsito não pode colocá-la na rua mesmo assim.
  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
  if (!campaign || campaign.status === 'cancelled') return

  const [conn] = await db
    .select({ id: connections.id, status: connections.status })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (!conn || conn.status !== 'active') {
    await markFailed(campaignMessageId, campaignId, 'Conexão WhatsApp inativa.', job.runId)
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

  const phone = await resolveWhatsAppPhone(contactId, contact.whatsappPhone)

  if (!phone) {
    await markFailed(campaignMessageId, campaignId, 'Contato sem número WhatsApp ou identidade vinculada.', job.runId)
    return
  }

  if (!contact.optInStatus) {
    await markFailed(campaignMessageId, campaignId, 'Contato optou por não receber campanhas (Opt-out).', job.runId)
    return
  }

  try {
    const result = await sendWhatsAppMessage(connectionId, phone, content, job.media)

    // Só 'sending' vira 'sent' — não ressuscita mensagem marcada 'failed'
    // por um cancel concorrente, e retry duplicado do BullMQ não conta 2x.
    const updated = await db.update(campaignMessages).set({
      status: 'sent',
      externalMessageId: result.externalMessageId,
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

    // Aviso de opt-out: só para contatos individuais — grupos não têm opt-out.
    if (!contact.isGroup) {
      const [ent] = await db.select({ tier: entitlements.tier }).from(entitlements).where(eq(entitlements.workspaceId, contact.workspaceId)).limit(1)
      const queueName = getOutboundQueueName('whatsapp', contact.workspaceId, ent?.tier)
      await enqueueOptOutFollowup(getQueue<SendMessageJob>(queueName), job, OPTOUT_FOLLOWUP_WHATSAPP)
    }
  } catch (err) {
    await markFailed(campaignMessageId, campaignId, sanitizeErrorMessage(err, 'Falha ao processar envio da mensagem pelo WhatsApp.'), job.runId)
  }
}

async function resolveWhatsAppPhone(contactId: string, direct?: string | null): Promise<string | null> {
  if (direct) return direct
  const [contact] = await db
    .select({ whatsappPhone: contacts.whatsappPhone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)
  if (contact?.whatsappPhone) return contact.whatsappPhone
  const [idRow] = await db
    .select({ identifier: contactIdentities.channelIdentifier })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.channelType, 'whatsapp')))
    .limit(1)
  return idRow?.identifier ?? null
}

// Conclusão de run/campanha é responsabilidade do pacer — aqui só contadores.
export async function markFailed(messageId: string, campaignId: string, reason: string, runId?: string): Promise<void> {
  const cleanReason = sanitizeErrorMessage(reason, 'Falha no envio da mensagem.')
  console.error(`[worker-whatsapp] falha na mensagem ${messageId}: ${cleanReason}`)

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
