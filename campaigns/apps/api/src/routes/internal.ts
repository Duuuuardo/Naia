import { Elysia, t } from 'elysia'
import {
  db,
  entitlements,
  revokedSessions,
  connections,
  members,
  invites,
  workspaces,
  directoryUsers,
  campaigns,
  campaignMessages,
  campaignRuns,
  campaignConnections,
  automations,
  automationConnections,
  productSettings,
  workspaceSettings,
  auditLogs,
} from '@naia/db'
import { eq, and, sql, gte, asc, desc, like } from 'drizzle-orm'
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
import { getRequiredEnv, verifySecret } from '../lib/env'
import { logAudit } from '../lib/audit'

const NAIA_INTERNAL_SECRET = getRequiredEnv('NAIA_INTERNAL_SECRET')

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
      if (!verifySecret(headers['x-internal-secret'], NAIA_INTERNAL_SECRET)) {
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
      if (!verifySecret(headers['x-internal-secret'], NAIA_INTERNAL_SECRET)) {
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
      if (!verifySecret(headers['x-internal-secret'], NAIA_INTERNAL_SECRET)) {
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
      const okSecret = verifySecret(headers['x-internal-secret'], NAIA_INTERNAL_SECRET)
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

  // ============================================================
  // Admin routes (Vianova admin panel → Naia Campaigns)
  // ============================================================

  .get(
    '/admin/workspaces',
    async ({ headers, query, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:read')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const page = query.page ?? 1
      const limit = Math.min(query.limit ?? 25, 100)
      const offset = (page - 1) * limit

      const conditions = []
      if (query.search) {
        conditions.push(
          sql`${workspaces.name} ILIKE ${`%${query.search}%`} OR ${workspaces.slug} ILIKE ${`%${query.search}%`}`,
        )
      }
      if (query.owner_user_id) conditions.push(eq(workspaces.ownerUserId, query.owner_user_id))
      if (query.organization_id) conditions.push(eq(workspaces.organizationId, query.organization_id))
      if (query.tier) conditions.push(eq(entitlements.tier, query.tier))

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [rows, countRows] = await Promise.all([
        db
          .select({
            workspace: workspaces,
            entitlement: entitlements,
            memberCount: sql<number>`count(${members.id})::int`,
            connectionCount: sql<number>`count(distinct ${connections.id})::int`,
            campaignCount: sql<number>`count(distinct ${campaigns.id})::int`,
          })
          .from(workspaces)
          .leftJoin(entitlements, eq(workspaces.id, entitlements.workspaceId))
          .leftJoin(members, eq(workspaces.id, members.workspaceId))
          .leftJoin(connections, eq(workspaces.id, connections.workspaceId))
          .leftJoin(campaigns, eq(workspaces.id, campaigns.workspaceId))
          .where(where)
          .groupBy(workspaces.id, entitlements.workspaceId)
          .orderBy(desc(workspaces.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(distinct ${workspaces.id})::int` })
          .from(workspaces)
          .leftJoin(entitlements, eq(workspaces.id, entitlements.workspaceId))
          .leftJoin(members, eq(workspaces.id, members.workspaceId))
          .leftJoin(connections, eq(workspaces.id, connections.workspaceId))
          .leftJoin(campaigns, eq(workspaces.id, campaigns.workspaceId))
          .where(where),
      ])

      return {
        workspaces: rows.map((r) => ({
          ...r.workspace,
          entitlement: r.entitlement,
          memberCount: r.memberCount,
          connectionCount: r.connectionCount,
          campaignCount: r.campaignCount,
        })),
        pagination: {
          page,
          limit,
          total: countRows[0]?.count ?? 0,
          totalPages: Math.ceil((countRows[0]?.count ?? 0) / limit),
        },
      }
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        owner_user_id: t.Optional(t.String()),
        organization_id: t.Optional(t.String()),
        tier: t.Optional(t.String()),
        page: t.Optional(t.Number({ minimum: 1 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
    },
  )

  .get(
    '/admin/workspaces/:workspaceId',
    async ({ headers, params, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:read')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      const [entitlement] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.workspaceId, params.workspaceId))
        .limit(1)

      const memberRows = await db
        .select({ member: members, user: directoryUsers })
        .from(members)
        .leftJoin(directoryUsers, eq(members.userId, directoryUsers.id))
        .where(eq(members.workspaceId, params.workspaceId))
        .orderBy(members.createdAt)

      const inviteRows = await db
        .select()
        .from(invites)
        .where(eq(invites.workspaceId, params.workspaceId))
        .orderBy(invites.createdAt)

      return {
        workspace,
        entitlement: entitlement ?? null,
        members: memberRows.map((r) => ({
          ...r.member,
          user: r.user,
        })),
        invites: inviteRows,
      }
    },
  )

  .get(
    '/admin/workspaces/:workspaceId/campaigns',
    async ({ headers, params, query, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:read')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const page = query.page ?? 1
      const limit = Math.min(query.limit ?? 25, 100)
      const offset = (page - 1) * limit

      const [rows, countRows] = await Promise.all([
        db
          .select({
            campaign: campaigns,
            runCount: sql<number>`count(distinct ${campaignRuns.id})::int`,
            messageCount: sql<number>`count(distinct ${campaignMessages.id})::int`,
          })
          .from(campaigns)
          .leftJoin(campaignRuns, eq(campaigns.id, campaignRuns.campaignId))
          .leftJoin(campaignMessages, eq(campaigns.id, campaignMessages.campaignId))
          .where(eq(campaigns.workspaceId, params.workspaceId))
          .groupBy(campaigns.id)
          .orderBy(desc(campaigns.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(eq(campaigns.workspaceId, params.workspaceId)),
      ])

      return {
        campaigns: rows.map((r) => ({
          ...r.campaign,
          runCount: r.runCount,
          messageCount: r.messageCount,
        })),
        pagination: {
          page,
          limit,
          total: countRows[0]?.count ?? 0,
          totalPages: Math.ceil((countRows[0]?.count ?? 0) / limit),
        },
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number({ minimum: 1 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
    },
  )

  .get(
    '/admin/workspaces/:workspaceId/connections',
    async ({ headers, params, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:read')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const rows = await db
        .select({
          id: connections.id,
          channel: connections.channel,
          name: connections.name,
          status: connections.status,
          lastErrorAt: connections.lastErrorAt,
          lastErrorMessage: connections.lastErrorMessage,
          createdAt: connections.createdAt,
          updatedAt: connections.updatedAt,
        })
        .from(connections)
        .where(eq(connections.workspaceId, params.workspaceId))
        .orderBy(connections.createdAt)

      return { connections: rows }
    },
  )

  // Configurações globais do produto — leitura/escrita pelo admin do Vianova.
  .get('/admin/product-settings', async ({ headers, set }) => {
    const ok = await requireServiceScope(headers, 'service:admin:read')
    if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

    const rows = await db.select().from(productSettings).orderBy(productSettings.key)
    return { settings: rows }
  })

  .patch(
    '/admin/product-settings',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const entries = Object.entries(body.settings)
      if (entries.length === 0) {
        set.status = 400
        return { message: 'Nenhuma configuração enviada.' }
      }

      const now = new Date()
      await db
        .insert(productSettings)
        .values(
          entries.map(([key, value]) => ({
            key,
            value,
            updatedByService: body.updated_by_service ?? 'vianova-admin',
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: productSettings.key,
          set: {
            value: sql`excluded.value`,
            updatedByService: body.updated_by_service ?? 'vianova-admin',
            updatedAt: now,
          },
        })

      return { updated: entries.map(([k]) => k) }
    },
    {
      body: t.Object({
        settings: t.Record(t.String(), t.Unknown()),
        updated_by_service: t.Optional(t.String()),
      }),
    },
  )

  // Configurações por workspace — overrides de product_settings.
  .get('/admin/workspaces/:workspaceId/settings', async ({ headers, params, set }) => {
    const ok = await requireServiceScope(headers, 'service:admin:read')
    if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

    const [row] = await db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, params.workspaceId))
      .limit(1)

    return { settings: row ?? { workspaceId: params.workspaceId, settings: {}, updatedByService: null, updatedAt: null } }
  })

  .patch(
    '/admin/workspaces/:workspaceId/settings',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const entries = Object.entries(body.settings)
      if (entries.length === 0) {
        set.status = 400
        return { message: 'Nenhuma configuração enviada.' }
      }

      // Merge parcial: preserva chaves existentes e atualiza/envia as novas.
      const [existing] = await db
        .select()
        .from(workspaceSettings)
        .where(eq(workspaceSettings.workspaceId, params.workspaceId))
        .limit(1)

      const merged: Record<string, unknown> = { ...(existing?.settings ?? {}) }
      for (const [k, v] of entries) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }

      const now = new Date()
      const [row] = await db
        .insert(workspaceSettings)
        .values({
          workspaceId: params.workspaceId,
          settings: merged,
          updatedByService: body.updated_by_service ?? 'vianova-admin',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceSettings.workspaceId,
          set: {
            settings: merged,
            updatedByService: body.updated_by_service ?? 'vianova-admin',
            updatedAt: now,
          },
        })
        .returning()

      return { settings: row }
    },
    {
      body: t.Object({
        settings: t.Record(t.String(), t.Unknown()),
        updated_by_service: t.Optional(t.String()),
      }),
    },
  )

  // Override manual de entitlement — usado pelo admin para desligar/reativar
  // um workspace sem depender do ciclo de billing.
  .post(
    '/admin/workspaces/:workspaceId/entitlements',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      const update: Record<string, unknown> = {}
      if (body.tier !== undefined) update.tier = body.tier
      if (body.status !== undefined) update.status = body.status
      if (body.seats !== undefined) update.seats = body.seats
      if (body.connections !== undefined) update.connections = body.connections
      if (body.credits_per_cycle !== undefined) update.creditsPerCycle = body.credits_per_cycle
      if (body.credits_balance !== undefined) update.creditsBalance = body.credits_balance
      if (body.campaigns_per_month !== undefined) update.campaignsPerMonth = body.campaigns_per_month
      if (body.automations !== undefined) update.automations = body.automations
      if (body.storage_bytes !== undefined) update.storageBytes = body.storage_bytes
      if (body.max_file_size_bytes !== undefined) update.maxFileSizeBytes = body.max_file_size_bytes
      update.updatedAt = new Date()

      const [entitlement] = await db
        .insert(entitlements)
        .values({
          workspaceId: params.workspaceId,
          tier: body.tier ?? 'free',
          status: body.status ?? 'active',
          seats: body.seats ?? 1,
          connections: body.connections ?? 1,
          creditsPerCycle: body.credits_per_cycle ?? 0,
          creditsBalance: body.credits_balance ?? 0,
          campaignsPerMonth: body.campaigns_per_month ?? 1,
          automations: body.automations ?? 0,
          storageBytes: body.storage_bytes ?? 0,
          maxFileSizeBytes: body.max_file_size_bytes ?? 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: entitlements.workspaceId,
          set: update,
        })
        .returning()

      return { entitlement }
    },
    {
      body: t.Object({
        tier: t.Optional(t.String()),
        status: t.Optional(t.String()),
        seats: t.Optional(t.Number()),
        connections: t.Optional(t.Number()),
        credits_per_cycle: t.Optional(t.Number()),
        credits_balance: t.Optional(t.Number()),
        campaigns_per_month: t.Optional(t.Number()),
        automations: t.Optional(t.Number()),
        storage_bytes: t.Optional(t.Number()),
        max_file_size_bytes: t.Optional(t.Number()),
      }),
    },
  )

  // Suspende um workspace (status de entitlement -> suspended).
  .post(
    '/admin/workspaces/:workspaceId/suspend',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      const [entitlement] = await db
        .insert(entitlements)
        .values({
          workspaceId: params.workspaceId,
          tier: 'free',
          status: 'suspended',
          seats: 1,
          connections: 0,
          creditsPerCycle: 0,
          creditsBalance: 0,
          campaignsPerMonth: 0,
          automations: 0,
          storageBytes: 0,
          maxFileSizeBytes: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: entitlements.workspaceId,
          set: { status: 'suspended', updatedAt: new Date() },
        })
        .returning()

      await logAudit({
        actorUserId: body.actor_user_id ?? 'vianova-admin',
        action: 'workspace:suspend',
        resourceType: 'workspace',
        resourceId: params.workspaceId,
        workspaceId: params.workspaceId,
        metadata: { reason: body.reason ?? null },
        ip: body.actor_ip ?? null,
        userAgent: body.actor_user_agent ?? null,
      })

      return { suspended: true as const, entitlement }
    },
    {
      body: t.Object({
        actor_user_id: t.Optional(t.String()),
        reason: t.Optional(t.String()),
        actor_ip: t.Optional(t.String()),
        actor_user_agent: t.Optional(t.String()),
      }),
    },
  )

  // Reativa um workspace suspenso (status de entitlement -> active).
  .post(
    '/admin/workspaces/:workspaceId/reactivate',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      const [entitlement] = await db
        .insert(entitlements)
        .values({
          workspaceId: params.workspaceId,
          tier: 'free',
          status: 'active',
          seats: 1,
          connections: 1,
          creditsPerCycle: 3,
          creditsBalance: 3,
          campaignsPerMonth: 1,
          automations: 0,
          storageBytes: 0,
          maxFileSizeBytes: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: entitlements.workspaceId,
          set: { status: 'active', updatedAt: new Date() },
        })
        .returning()

      await logAudit({
        actorUserId: body.actor_user_id ?? 'vianova-admin',
        action: 'workspace:reactivate',
        resourceType: 'workspace',
        resourceId: params.workspaceId,
        workspaceId: params.workspaceId,
        metadata: { reason: body.reason ?? null },
        ip: body.actor_ip ?? null,
        userAgent: body.actor_user_agent ?? null,
      })

      return { reactivated: true as const, entitlement }
    },
    {
      body: t.Object({
        actor_user_id: t.Optional(t.String()),
        reason: t.Optional(t.String()),
        actor_ip: t.Optional(t.String()),
        actor_user_agent: t.Optional(t.String()),
      }),
    },
  )

  // Transfere a titularidade de um workspace para outro usuário.
  // O novo dono precisa ser membro do workspace; o antigo dono vira admin.
  .post(
    '/admin/workspaces/:workspaceId/transfer-ownership',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      if (workspace.ownerUserId === body.new_owner_user_id) {
        set.status = 400
        return { message: 'O novo dono já é o dono atual do workspace.' }
      }

      const [newOwnerMember] = await db
        .select()
        .from(members)
        .where(and(eq(members.workspaceId, params.workspaceId), eq(members.userId, body.new_owner_user_id)))
        .limit(1)

      if (!newOwnerMember) {
        set.status = 400
        return { message: 'O novo dono deve ser um membro do workspace.' }
      }

      const previousOwnerId = workspace.ownerUserId

      await db.transaction(async (tx) => {
        await tx
          .update(members)
          .set({ role: 'owner' })
          .where(and(eq(members.workspaceId, params.workspaceId), eq(members.userId, body.new_owner_user_id)))

        if (previousOwnerId !== body.new_owner_user_id) {
          await tx
            .update(members)
            .set({ role: 'admin' })
            .where(and(eq(members.workspaceId, params.workspaceId), eq(members.userId, previousOwnerId)))
        }

        await tx
          .update(workspaces)
          .set({ ownerUserId: body.new_owner_user_id, updatedAt: new Date() })
          .where(eq(workspaces.id, params.workspaceId))
      })

      const [updatedWorkspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)

      await logAudit({
        actorUserId: body.actor_user_id ?? 'vianova-admin',
        action: 'workspace:transfer_ownership',
        resourceType: 'workspace',
        resourceId: params.workspaceId,
        workspaceId: params.workspaceId,
        metadata: { previousOwnerUserId: previousOwnerId, newOwnerUserId: body.new_owner_user_id },
        ip: body.actor_ip ?? null,
        userAgent: body.actor_user_agent ?? null,
      })

      return { transferred: true as const, workspace: updatedWorkspace }
    },
    {
      body: t.Object({
        new_owner_user_id: t.String({ minLength: 1 }),
        actor_user_id: t.Optional(t.String()),
        actor_ip: t.Optional(t.String()),
        actor_user_agent: t.Optional(t.String()),
      }),
    },
  )

  // Remove um membro do workspace. O dono não pode ser removido.
  .post(
    '/admin/workspaces/:workspaceId/members/:userId/remove',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      if (workspace.ownerUserId === params.userId) {
        set.status = 400
        return { message: 'Não é possível remover o dono do workspace. Transfira a titularidade primeiro.' }
      }

      const [member] = await db
        .select()
        .from(members)
        .where(and(eq(members.workspaceId, params.workspaceId), eq(members.userId, params.userId)))
        .limit(1)

      if (!member) { set.status = 404; return { message: 'Membro não encontrado.' } }

      await db.delete(members).where(eq(members.id, member.id))

      await logAudit({
        actorUserId: body.actor_user_id ?? 'vianova-admin',
        action: 'workspace:member:remove',
        resourceType: 'workspace_member',
        resourceId: params.userId,
        workspaceId: params.workspaceId,
        metadata: { role: member.role },
        ip: body.actor_ip ?? null,
        userAgent: body.actor_user_agent ?? null,
      })

      return { removed: true as const }
    },
    {
      body: t.Object({
        actor_user_id: t.Optional(t.String()),
        actor_ip: t.Optional(t.String()),
        actor_user_agent: t.Optional(t.String()),
      }),
    },
  )

  // Cancela um convite pendente.
  .post(
    '/admin/workspaces/:workspaceId/invites/:inviteId/cancel',
    async ({ headers, params, body, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:write')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

      const [invite] = await db
        .select()
        .from(invites)
        .where(and(eq(invites.id, params.inviteId), eq(invites.workspaceId, params.workspaceId)))
        .limit(1)

      if (!invite) { set.status = 404; return { message: 'Convite não encontrado.' } }
      if (invite.status !== 'pending') {
        set.status = 400
        return { message: 'Só é possível cancelar convites pendentes.' }
      }

      const [updatedInvite] = await db
        .update(invites)
        .set({ status: 'cancelled' })
        .where(eq(invites.id, params.inviteId))
        .returning()

      await logAudit({
        actorUserId: body.actor_user_id ?? 'vianova-admin',
        action: 'workspace:invite:cancel',
        resourceType: 'workspace_invite',
        resourceId: params.inviteId,
        workspaceId: params.workspaceId,
        metadata: { email: invite.email, role: invite.role },
        ip: body.actor_ip ?? null,
        userAgent: body.actor_user_agent ?? null,
      })

      return { cancelled: true as const, invite: updatedInvite }
    },
    {
      body: t.Object({
        actor_user_id: t.Optional(t.String()),
        actor_ip: t.Optional(t.String()),
        actor_user_agent: t.Optional(t.String()),
      }),
    },
  )

  // Audit logs de um workspace (usado pela aba "Visão geral" do admin).
  .get(
    '/admin/workspaces/:workspaceId/audit-logs',
    async ({ headers, params, query, set }) => {
      const ok = await requireServiceScope(headers, 'service:admin:read')
      if (!ok) { set.status = 401; return { message: 'Não autorizado.' } }

      const page = query.page ?? 1
      const limit = Math.min(query.limit ?? 25, 100)
      const offset = (page - 1) * limit

      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.workspaceId, params.workspaceId))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(eq(auditLogs.workspaceId, params.workspaceId)),
      ])

      return {
        logs: rows,
        pagination: {
          page,
          limit,
          total: countRows[0]?.count ?? 0,
          totalPages: Math.ceil((countRows[0]?.count ?? 0) / limit),
        },
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number({ minimum: 1 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
    },
  )

