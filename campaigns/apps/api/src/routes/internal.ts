import { Elysia, t } from 'elysia'
import { db, entitlements, revokedSessions, connections, members, invites, campaigns, campaignMessages, campaignConnections, automations, automationConnections } from '@naia/db'
import { eq, and, sql, gte, asc } from 'drizzle-orm'
import { verifyServiceToken } from '@naia/vianova-auth'
import { canCreateCampaign, hasActiveSubscription } from '@naia/entitlements'
import { dayKeyInTz, todayMonthDay } from '@naia/scheduling'
import { disconnectSession } from '@naia/session-host-client'
import { isTelegramUserConfig } from '../lib/telegram-helpers'
import { sanitizeErrorMessage } from '@naia/schemas'
import { startCampaignRun } from '../lib/campaign-runner'
import { executeDueEnrollments } from '../lib/automation-engine'
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
      try {
        const ok = await requireServiceScope(headers, 'service:entitlements:write')
        if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

        const isFree = body.tier === 'free' || body.tier === 'none'
        const limits = {
          seats: isFree ? 1 : (body.limits.seats ?? 0),
          connections: isFree ? 1 : (body.limits.connections ?? 0),
          creditsPerCycle: isFree ? 3 : (body.limits.creditsPerCycle ?? 0),
          campaignsPerMonth: isFree ? 1 : (body.limits.campaignsPerMonth ?? 0),
          automations: isFree ? 0 : (body.limits.automations ?? 0),
          storageBytes: isFree ? 104_857_600 : (body.limits.storageBytes ?? 0),
          maxFileSizeBytes: isFree ? 5_242_880 : (body.limits.maxFileSizeBytes ?? 0),
        }

        // INSERT: workspace novo — concede os créditos do ciclo como saldo inicial.
        // UPDATE: só atualiza limites estáticos; saldo é gerenciado por /credits/grant.
        const inserted = await db
          .insert(entitlements)
          .values({
            workspaceId: body.workspace_id,
            tier: body.tier,
            status: body.status,
            ...limits,
            creditsBalance: limits.creditsPerCycle,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: entitlements.workspaceId,
            set: {
              tier: body.tier,
              status: body.status,
              seats: limits.seats,
              connections: limits.connections,
              creditsPerCycle: limits.creditsPerCycle,
              campaignsPerMonth: limits.campaignsPerMonth,
              automations: limits.automations,
              storageBytes: limits.storageBytes,
              maxFileSizeBytes: limits.maxFileSizeBytes,
              updatedAt: new Date(),
            },
          })
          .returning({ workspaceId: entitlements.workspaceId })

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
              const isTgUser = conn.channel === 'telegram' && isTelegramUserConfig(conn.config)
              try {
                await disconnectSession(conn.id, { channel: conn.channel as 'whatsapp' | 'telegram', logout: false })
              } catch { /* ignore */ }
              await db
                .update(connections)
                .set({ status: 'disconnected', updatedAt: new Date() })
                .where(eq(connections.id, conn.id))
            }
          }
        }

        // Se o limite de automações ativas diminuiu, desativa as mais recentes
        // e mantém as mais antigas dentro do novo teto.
        if (limits.automations >= 0) {
          const activeAutomations = await db
            .select()
            .from(automations)
            .where(and(eq(automations.workspaceId, body.workspace_id), eq(automations.active, true)))
            .orderBy(automations.createdAt)

          if (activeAutomations.length > limits.automations) {
            const toDeactivate = activeAutomations.slice(limits.automations).reverse()
            for (const automation of toDeactivate) {
              await db
                .update(automations)
                .set({ active: false, updatedAt: new Date() })
                .where(eq(automations.id, automation.id))
            }
          }
        }

        return { synced: true as const }
      } catch (err) {
        console.error('[internal/entitlements] erro ao sincronizar entitlements:', err)
        throw err
      }
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

  // Concessão de créditos — chamada pelo Vianova em invoice.paid (renovação,
  // nova assinatura, compra de pacote). Acumula sobre o saldo existente.
  .post(
    '/credits/grant',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:entitlements:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }
      if (body.amount <= 0) return { granted: true as const, credited: 0 }

      const [row] = await db
        .update(entitlements)
        .set({
          creditsBalance: sql`${entitlements.creditsBalance} + ${body.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(entitlements.workspaceId, body.workspace_id))
        .returning({ creditsBalance: entitlements.creditsBalance })

      console.log(`[credits] workspace ${body.workspace_id} +${body.amount} créditos → saldo ${row?.creditsBalance ?? '?'}`)
      return { granted: true as const, credited: body.amount }
    },
    {
      body: t.Object({
        workspace_id: t.String(),
        product_slug: t.String(),
        amount: t.Number(),
      }),
    },
  )

  // Reset de créditos — chamado pelo Vianova em estorno/chargeback ou quando a
  // subscription paga é cancelada. Zera o saldo imediatamente.
  .post(
    '/credits/reset',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:entitlements:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [row] = await db
        .update(entitlements)
        .set({
          creditsBalance: 0,
          updatedAt: new Date(),
        })
        .where(eq(entitlements.workspaceId, body.workspace_id))
        .returning({ creditsBalance: entitlements.creditsBalance })

      console.log(`[credits] workspace ${body.workspace_id} créditos zerados → saldo ${row?.creditsBalance ?? '?'}`)
      return { reset: true as const, balance: row?.creditsBalance ?? 0 }
    },
    {
      body: t.Object({
        workspace_id: t.String(),
        product_slug: t.String(),
      }),
    },
  )

  // Chamado pelo tick do scheduler (worker) quando next_run_at vence. Vive na
  // API porque a resolução de audiência pode expandir grupos via session-host.
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
      if (automation.type !== 'birthday') {
        return { evaluated: false as const, reason: 'Automação não é do fluxo diário (aniversário).' }
      }

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
          .where(and(eq(campaigns.workspaceId, automation.workspaceId), gte(campaigns.createdAt, (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d })())))
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

  // Executa os passos devidos da régua (tick do scheduler). O worker já fez o
  // claim com lease (next_step_at empurrado) — aqui roda o motor: delays,
  // add_tag e disparo dos passos de mensagem via campanha persistente do passo.
  .post(
    '/automations/:automationId/execute-steps',
    async ({ params, body, headers, set }) => {
      const secret = process.env.NAIA_INTERNAL_SECRET
      if (secret && headers['x-internal-secret'] !== secret) {
        set.status = 401; return { processed: 0, message: 'Não autorizado.' }
      }
      try {
        return await executeDueEnrollments(params.automationId, body.enrollmentIds)
      } catch (err) {
        console.error(`[internal] erro ao executar passos da automação ${params.automationId}:`, err)
        set.status = 500
        return { processed: 0, message: sanitizeErrorMessage(err, 'Falha interna ao executar passos da automação.') }
      }
    },
    {
      body: t.Object({
        enrollmentIds: t.Array(t.String(), { minItems: 1 }),
      }),
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

      const cycleStart = new Date()
      cycleStart.setDate(1)
      cycleStart.setHours(0, 0, 0, 0)

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

      const [entRow] = await db
        .select({ creditsBalance: entitlements.creditsBalance })
        .from(entitlements)
        .where(eq(entitlements.workspaceId, params.workspaceId))
        .limit(1)

      const [campaignCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaigns)
        .where(and(eq(campaigns.workspaceId, params.workspaceId), gte(campaigns.createdAt, cycleStart)))

      const [automationCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(automations)
        .where(and(eq(automations.workspaceId, params.workspaceId), eq(automations.active, true)))

      return {
        usage: {
          seats: Math.max(1, (memberCount?.count ?? 0) + (inviteCount?.count ?? 0)),
          connections: connectionCount?.count ?? 0,
          creditsBalance: entRow?.creditsBalance ?? 0,
          campaignsPerMonth: campaignCount?.count ?? 0,
          automations: automationCount?.count ?? 0,
        },
      }
    },
  )

