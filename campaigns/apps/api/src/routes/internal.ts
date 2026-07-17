import { Elysia, t } from 'elysia'
import { db, entitlements, revokedSessions, connections, members, invites, campaigns, campaignMessages, campaignConnections, automations, automationConnections } from '@naia/db'
import { eq, and, sql, gte, asc } from 'drizzle-orm'
import { verifyServiceToken } from '@naia/vianova-auth'
import { canCreateCampaign, hasActiveSubscription } from '@naia/entitlements'
import { dayKeyInTz, todayMonthDay } from '@naia/scheduling'
import { sendWhatsAppMessage, disconnectWhatsApp } from '../lib/whatsapp-manager'
import { sendTelegramUserMessage, disconnectTelegramUser, isTelegramUserConfig } from '../lib/telegram-user-manager'
import { sanitizeErrorMessage, MediaRefSchema } from '@naia/schemas'
import { startCampaignRun, monthStart } from '../lib/campaign-runner'
import { resolveCampaignTargets } from './contacts'
import { replaceVariants } from './campaigns'
import { generateId } from '../lib/crypto'

async function requireServiceScope(headers: { authorization?: string }, scope: string): Promise<boolean> {
  const token = headers.authorization?.replace(/^Bearer /, '')
  if (!token) return false
  return verifyServiceToken(token, scope)
}

// Canal service-to-service (Vianova → Naia). Nunca aceita o JWT de usuário —
// só token de serviço assinado pelo Vianova, verificado localmente via JWKS
// (mesmo par de chaves usado pro login, escopo diferente).
export const internalRoutes = new Elysia({ prefix: '/internal' })

  // Única forma de escrita de entitlement no banco do Naia.
  .post(
    '/entitlements',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:entitlements:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const isFree = body.tier === 'free' || body.tier === 'none'
      const limits = {
        seats: isFree ? 1 : (body.limits.seats ?? 0),
        connections: isFree ? 1 : (body.limits.connections ?? 0),
        messagesPerMonth: isFree ? 3 : (body.limits.messagesPerMonth ?? 0),
        campaignsPerMonth: isFree ? 1 : (body.limits.campaignsPerMonth ?? 0),
      }

      await db
        .insert(entitlements)
        .values({
          workspaceId: body.workspace_id,
          tier: body.tier,
          status: body.status,
          ...limits,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: entitlements.workspaceId,
          set: {
            tier: body.tier,
            status: body.status,
            ...limits,
            updatedAt: new Date(),
          },
        })

      // Se o limite de conexões diminuiu ou expirou, inativa as conexões excedentes,
      // mantendo apenas as primeiras `limits.connections` ativas.
      if (limits.connections >= 0) {
        const activeConns = await db
          .select()
          .from(connections)
          .where(and(eq(connections.workspaceId, body.workspace_id), eq(connections.status, 'active')))
          .orderBy(connections.createdAt)

        if (activeConns.length > limits.connections) {
          const toDeactivate = activeConns.slice(limits.connections)
          for (const conn of toDeactivate) {
            if (conn.channel === 'whatsapp') {
              try { await disconnectWhatsApp(conn.id) } catch { /* ignore */ }
            } else if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
              // sem logout: a sessão salva permite reconectar quando o limite voltar
              try { await disconnectTelegramUser(conn.id) } catch { /* ignore */ }
            }
            await db
              .update(connections)
              .set({ status: 'disconnected', updatedAt: new Date() })
              .where(eq(connections.id, conn.id))
          }
        }
      }

      return { synced: true as const }
    },
    {
      body: t.Object({
        workspace_id: t.String(),
        product_slug: t.String(),
        tier: t.String(),
        status: t.String(),
        limits: t.Record(t.String(), t.Number()),
      }),
    },
  )

  // Endpoint chamado pelo worker de WhatsApp para enviar mensagens usando o
  // socket Baileys que vive exclusivamente no processo da API. O worker NÃO
  // abre seu próprio socket — isso evitaria conflito de sessão entre processos.
  .post(
    '/whatsapp-send',
    async ({ body, headers, set }) => {
      const secret = process.env.NAIA_INTERNAL_SECRET
      if (secret && headers['x-internal-secret'] !== secret) {
        set.status = 401; return { success: false, error: 'Não autorizado.' }
      }
      try {
        const result = await sendWhatsAppMessage(body.connectionId, body.phone, body.content, body.media)
        return { success: true, externalMessageId: result.externalMessageId }
      } catch (err) {
        return { success: false, error: sanitizeErrorMessage(err, 'Falha interna ao processar envio de mensagem via WhatsApp.') }
      }
    },
    {
      body: t.Object({
        connectionId: t.String(),
        phone: t.String(),
        content: t.String(),
        media: t.Optional(t.Array(MediaRefSchema)),
      }),
    },
  )

  // Endpoint chamado pelo worker de Telegram para enviar mensagens usando o
  // cliente MTProto (conta de usuário) que vive exclusivamente neste processo
  // — mesmo motivo do /whatsapp-send.
  .post(
    '/telegram-user-send',
    async ({ body, headers, set }) => {
      const secret = process.env.NAIA_INTERNAL_SECRET
      if (secret && headers['x-internal-secret'] !== secret) {
        set.status = 401; return { success: false, error: 'Não autorizado.' }
      }
      try {
        const result = await sendTelegramUserMessage(body.connectionId, body.target, body.content, body.media)
        return { success: true, externalMessageId: result.externalMessageId }
      } catch (err) {
        return { success: false, error: sanitizeErrorMessage(err, 'Falha interna ao processar envio de mensagem via Telegram.') }
      }
    },
    {
      body: t.Object({
        connectionId: t.String(),
        target: t.String(),
        content: t.String(),
        media: t.Optional(t.Array(MediaRefSchema)),
      }),
    },
  )

  // Chamado pelo tick do scheduler (worker) quando next_run_at vence. Vive na
  // API porque a resolução de audiência pode expandir grupos via socket
  // Baileys, que existe só neste processo (mesmo motivo do /whatsapp-send).
  .post(
    '/campaigns/:campaignId/start-run',
    async ({ params, body, headers, set }) => {
      const secret = process.env.NAIA_INTERNAL_SECRET
      if (secret && headers['x-internal-secret'] !== secret) {
        set.status = 401; return { started: false as const, reason: 'Não autorizado.' }
      }
      try {
        const result = await startCampaignRun(params.campaignId, {
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        })
        return result
      } catch (err) {
        console.error(`[internal] erro ao iniciar run da campanha ${params.campaignId}:`, err)
        return { started: false as const, reason: sanitizeErrorMessage(err, 'Falha interna ao iniciar o run da campanha.') }
      }
    },
    {
      body: t.Object({
        scheduledFor: t.Optional(t.String()),
      }),
    },
  )

  // Avaliação diária de automação (tick do scheduler). Sempre grava
  // lastEvaluatedDate — é a guarda de idempotência contra reexecução no dia.
  .post(
    '/automations/:automationId/evaluate',
    async ({ params, headers, set }) => {
      const secret = process.env.NAIA_INTERNAL_SECRET
      if (secret && headers['x-internal-secret'] !== secret) {
        set.status = 401; return { evaluated: false as const, reason: 'Não autorizado.' }
      }

      const [automation] = await db.select().from(automations).where(eq(automations.id, params.automationId)).limit(1)
      if (!automation) { set.status = 404; return { evaluated: false as const, reason: 'Automação não encontrada.' } }

      const now = new Date()
      const today = dayKeyInTz(now, automation.timezone)
      if (automation.lastEvaluatedDate === today) {
        return { evaluated: false as const, reason: 'Já avaliada hoje.' }
      }

      const finish = async (result: { matched: number; campaignId?: string; skipReason?: string }) => {
        await db.update(automations).set({
          lastEvaluatedDate: today,
          lastResultJson: JSON.stringify(result),
          updatedAt: now,
        }).where(eq(automations.id, automation.id))
        return { evaluated: true as const, ...result }
      }

      try {
        const connRows = await db
          .select({ connection: connections })
          .from(automationConnections)
          .innerJoin(connections, eq(automationConnections.connectionId, connections.id))
          .where(eq(automationConnections.automationId, automation.id))
          .orderBy(asc(automationConnections.position))
        const activeConns = connRows.map((r) => r.connection).filter((c) => c.status === 'active')

        if (activeConns.length === 0) {
          return await finish({ matched: 0, skipReason: 'Nenhuma conexão ativa vinculada à automação.' })
        }

        const monthDay = todayMonthDay(now, automation.timezone)
        const targets = await resolveCampaignTargets(
          automation.workspaceId,
          activeConns.map((c) => c.id),
          { type: 'birthday', monthDay, timezone: automation.timezone },
        )
        const availableChannels = new Set(activeConns.map((c) => c.channel))
        const eligible = targets.filter(
          (c) =>
            c.optInStatus &&
            ((c.whatsappPhone && availableChannels.has('whatsapp')) ||
              (c.telegramChatId && availableChannels.has('telegram'))),
        )

        if (eligible.length === 0) {
          return await finish({ matched: 0 })
        }

        // Campanha de automação passa pelos mesmos gates de entitlement
        const [ent] = await db.select().from(entitlements).where(eq(entitlements.workspaceId, automation.workspaceId)).limit(1)
        if (!ent) return await finish({ matched: eligible.length, skipReason: 'Workspace sem entitlement sincronizado.' })
        const subCheck = hasActiveSubscription(ent)
        if (!subCheck.allowed) return await finish({ matched: eligible.length, skipReason: subCheck.reason })

        const [created] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(and(eq(campaigns.workspaceId, automation.workspaceId), gte(campaigns.createdAt, monthStart())))
        const campaignCheck = canCreateCampaign(ent, created?.count ?? 0)
        if (!campaignCheck.allowed) return await finish({ matched: eligible.length, skipReason: campaignCheck.reason })

        const content = (() => {
          try {
            return JSON.parse(automation.contentJson) as Array<{ body: string; mediaAssetIds?: string[] }>
          } catch {
            return []
          }
        })()
        if (content.length === 0 || !content.some((v) => v.body?.trim())) {
          return await finish({ matched: eligible.length, skipReason: 'Automação sem conteúdo de mensagem.' })
        }

        const uniqueChannels = [...new Set(activeConns.map((c) => c.channel))]
        const dateLabel = today.split('-').reverse().join('/')
        const campaignId = generateId()
        await db.insert(campaigns).values({
          id: campaignId,
          workspaceId: automation.workspaceId,
          name: `${automation.name} (${dateLabel})`,
          channel: uniqueChannels.length === 1 ? (uniqueChannels[0] as 'whatsapp' | 'telegram') : 'mixed',
          status: 'draft',
          kind: 'automation',
          automationId: automation.id,
          segmentFilter: JSON.stringify({ type: 'birthday', monthDay, timezone: automation.timezone }),
          scheduleJson: JSON.stringify({ type: 'immediate' }),
          speedJson: automation.speedJson,
          timezone: automation.timezone,
          consentAt: now,
        })
        for (let i = 0; i < activeConns.length; i++) {
          await db.insert(campaignConnections).values({ campaignId, connectionId: activeConns[i]!.id, position: i })
        }
        const variantResult = await replaceVariants(automation.workspaceId, campaignId, content)
        if (!variantResult.ok) {
          await db.delete(campaigns).where(eq(campaigns.id, campaignId))
          return await finish({ matched: eligible.length, skipReason: variantResult.message })
        }

        const runResult = await startCampaignRun(campaignId)
        return await finish({
          matched: eligible.length,
          campaignId,
          skipReason: runResult.started ? undefined : runResult.reason,
        })
      } catch (err) {
        console.error(`[internal] erro ao avaliar automação ${automation.id}:`, err)
        return await finish({
          matched: 0,
          skipReason: sanitizeErrorMessage(err, 'Falha interna ao avaliar a automação.'),
        })
      }
    },
  )

  // Base do single sign-out imediato: o Vianova avisa quais sids caíram, o
  // Naia passa a rejeitar tokens com esse `sid` sem precisar consultar o
  // Vianova de novo (ver plugins/auth.ts).
  .post(
    '/session-revoked',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:sessions:revoke')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      for (const sid of body.session_ids) {
        await db.insert(revokedSessions).values({ sid }).onConflictDoNothing()
      }

      return { revoked: body.session_ids.length }
    },
    {
      body: t.Object({
        user_id: t.String(),
        session_ids: t.Array(t.String()),
      }),
    },
  )

  // Consulta de consumo atual de recursos do workspace por serviço do ecossistema (Vianova Billing).
  .get(
    '/usage/:workspaceId',
    async ({ headers, params, set }) => {
      const okRead = await requireServiceScope(headers, 'service:entitlements:read')
      const okWrite = await requireServiceScope(headers, 'service:entitlements:write')
      const secret = process.env.NAIA_INTERNAL_SECRET
      const okSecret = secret && headers['x-internal-secret'] === secret
      if (!okRead && !okWrite && !okSecret) {
        set.status = 401; return { message: 'Não autorizado.' }
      }

      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)

      const [memberCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(members)
        .where(eq(members.workspaceId, params.workspaceId))

      const [inviteCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invites)
        .where(and(eq(invites.workspaceId, params.workspaceId), eq(invites.status, 'pending')))

      const [connectionCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(connections)
        .where(eq(connections.workspaceId, params.workspaceId))

      const [messageCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaignMessages)
        .innerJoin(campaigns, eq(campaignMessages.campaignId, campaigns.id))
        .where(and(eq(campaigns.workspaceId, params.workspaceId), gte(campaignMessages.sentAt, monthStart)))

      const [campaignCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaigns)
        .where(and(eq(campaigns.workspaceId, params.workspaceId), gte(campaigns.createdAt, monthStart)))

      return {
        usage: {
          seats: Math.max(1, (memberCount?.count ?? 0) + (inviteCount?.count ?? 0)),
          connections: connectionCount?.count ?? 0,
          messagesPerMonth: messageCount?.count ?? 0,
          campaignsPerMonth: campaignCount?.count ?? 0,
        },
      }
    },
  )

