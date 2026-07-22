import { Elysia, t } from 'elysia'
import { db, campaigns, campaignMessages, campaignRuns, campaignConnections, campaignVariants, campaignVariantMedia, mediaAssets, connections, contacts, entitlements } from '@naia/db'
import { eq, and, sql, desc, asc, inArray, gte } from 'drizzle-orm'
import { canCreateCampaign, canUseSpeed, defaultSpeedPreset, hasActiveSubscription } from '@naia/entitlements'
import { getQueue, QUEUES, defaultJobOptions } from '@naia/queue'
import { ScheduleSchema, SpeedSchema, type PacerJob, type Schedule, type Speed, type SpeedChannel } from '@naia/schemas'
import { computeNextRunAt, DEFAULT_TIMEZONE } from '@naia/scheduling'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { startCampaignRun, parseSchedule } from '../lib/campaign-runner'
import { generateId } from '../lib/crypto'

const VariantInput = t.Object({
  body: t.String({ minLength: 1 }),
  mediaAssetIds: t.Optional(t.Array(t.String())),
})

function cycleStart(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

async function getMonthlyCampaignCount(workspaceId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, workspaceId), gte(campaigns.createdAt, cycleStart())))
  return result?.count ?? 0
}

async function getCreditsBalance(workspaceId: string): Promise<number> {
  const [ent] = await db
    .select({ creditsBalance: entitlements.creditsBalance })
    .from(entitlements)
    .where(eq(entitlements.workspaceId, workspaceId))
    .limit(1)
  return ent?.creditsBalance ?? 0
}

/** Conexões do workspace validadas contra a seleção do usuário. */
async function loadSelectedConnections(workspaceId: string, connectionIds: string[]) {
  const rows = await db
    .select()
    .from(connections)
    .where(and(inArray(connections.id, connectionIds), eq(connections.workspaceId, workspaceId)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return connectionIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
}

function campaignChannel(channels: string[]): 'whatsapp' | 'telegram' | 'mixed' {
  const unique = [...new Set(channels)]
  return unique.length === 1 ? (unique[0] as 'whatsapp' | 'telegram') : 'mixed'
}

/** Substitui variantes (e vínculos de mídia) da campanha transacionalmente.
 * Exportada: o evaluate de automações materializa contentJson em variantes. */
export async function replaceVariants(
  workspaceId: string,
  campaignId: string,
  variants: Array<{ body: string; mediaAssetIds?: string[] }>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const allMediaIds = [...new Set(variants.flatMap((v) => v.mediaAssetIds ?? []))]
  if (allMediaIds.length > 0) {
    const found = await db
      .select({ id: mediaAssets.id, status: mediaAssets.status })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, allMediaIds), eq(mediaAssets.workspaceId, workspaceId)))
    const readyIds = new Set(found.filter((m) => m.status === 'ready').map((m) => m.id))
    const missing = allMediaIds.filter((id) => !readyIds.has(id))
    if (missing.length > 0) {
      return { ok: false, message: 'Uma ou mais mídias anexadas não existem ou ainda não terminaram o upload.' }
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(campaignVariants).where(eq(campaignVariants.campaignId, campaignId))
    for (let i = 0; i < variants.length; i++) {
      const variantId = generateId()
      await tx.insert(campaignVariants).values({
        id: variantId,
        campaignId,
        position: i,
        body: variants[i]!.body,
      })
      const mediaIds = variants[i]!.mediaAssetIds ?? []
      for (let m = 0; m < mediaIds.length; m++) {
        await tx.insert(campaignVariantMedia).values({
          variantId,
          mediaAssetId: mediaIds[m]!,
          position: m,
        })
      }
    }
  })
  return { ok: true }
}

async function loadCampaignDetail(campaignId: string) {
  const [connRows, variantRows, mediaRows, latestRuns] = await Promise.all([
    db
      .select({ connection: connections, position: campaignConnections.position })
      .from(campaignConnections)
      .innerJoin(connections, eq(campaignConnections.connectionId, connections.id))
      .where(eq(campaignConnections.campaignId, campaignId))
      .orderBy(asc(campaignConnections.position)),
    db
      .select()
      .from(campaignVariants)
      .where(eq(campaignVariants.campaignId, campaignId))
      .orderBy(asc(campaignVariants.position)),
    db
      .select({
        variantId: campaignVariantMedia.variantId,
        position: campaignVariantMedia.position,
        asset: mediaAssets,
      })
      .from(campaignVariantMedia)
      .innerJoin(campaignVariants, eq(campaignVariantMedia.variantId, campaignVariants.id))
      .innerJoin(mediaAssets, eq(campaignVariantMedia.mediaAssetId, mediaAssets.id))
      .where(eq(campaignVariants.campaignId, campaignId)),
    db
      .select()
      .from(campaignRuns)
      .where(eq(campaignRuns.campaignId, campaignId))
      .orderBy(desc(campaignRuns.runNumber))
      .limit(1),
  ])

  const mediaByVariant = new Map<string, Array<{ position: number; asset: typeof mediaAssets.$inferSelect }>>()
  for (const row of mediaRows) {
    const list = mediaByVariant.get(row.variantId) ?? []
    list.push({ position: row.position, asset: row.asset })
    mediaByVariant.set(row.variantId, list)
  }

  return {
    connections: connRows.map((r) => ({
      id: r.connection.id,
      name: r.connection.name,
      channel: r.connection.channel,
      status: r.connection.status,
    })),
    variants: variantRows.map((v) => ({
      ...v,
      media: (mediaByVariant.get(v.id) ?? [])
        .sort((a, b) => a.position - b.position)
        .map((m) => m.asset),
    })),
    currentRun: latestRuns[0] ?? null,
  }
}

/** Canais (whatsapp/telegram) presentes nas conexões selecionadas. */
function speedChannels(conns: Array<{ channel: string }>): SpeedChannel[] {
  return [...new Set(conns.map((c) => c.channel))].filter(
    (c): c is SpeedChannel => c === 'whatsapp' || c === 'telegram',
  )
}

export const campaignRoutes = new Elysia()
  .use(authPlugin)

  // GET /workspaces/:workspaceId/campaigns
  .get(
    '/workspaces/:workspaceId/campaigns',
    async ({ session, params, query, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const page = Math.max(1, query.page ?? 1)
      const limit = Math.min(100, query.limit ?? 20)
      const offset = (page - 1) * limit

      const [rows, totalResult] = await Promise.all([
        db.select().from(campaigns)
          .where(eq(campaigns.workspaceId, params.workspaceId))
          .orderBy(desc(campaigns.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(eq(campaigns.workspaceId, params.workspaceId)),
      ])

      return { campaigns: rows, total: totalResult[0]?.count ?? 0, page, limit }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number()),
        limit: t.Optional(t.Number()),
      }),
    },
  )

  // POST /workspaces/:workspaceId/campaigns — sempre cria rascunho
  .post(
    '/workspaces/:workspaceId/campaigns',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const subCheck = hasActiveSubscription(ctx.entitlements)
      if (!subCheck.allowed) { set.status = 403; return { message: subCheck.reason } }

      const createdThisMonth = await getMonthlyCampaignCount(params.workspaceId)
      const campaignCheck = canCreateCampaign(ctx.entitlements, createdThisMonth)
      if (!campaignCheck.allowed) { set.status = 403; return { message: campaignCheck.reason } }

      const conns = await loadSelectedConnections(params.workspaceId, body.connectionIds)
      if (conns.length !== body.connectionIds.length) {
        set.status = 400; return { message: 'Uma ou mais conexões selecionadas não existem neste workspace.' }
      }

      const speed: Speed = body.speed ?? { preset: defaultSpeedPreset(ctx.entitlements.tier) }
      const speedCheck = canUseSpeed(ctx.entitlements, speed, speedChannels(conns))
      if (!speedCheck.allowed) { set.status = 403; return { message: speedCheck.reason } }

      const id = generateId()
      await db.insert(campaigns).values({
        id,
        workspaceId: params.workspaceId,
        name: body.name,
        channel: campaignChannel(conns.map((c) => c.channel)),
        status: 'draft',
        segmentFilter: JSON.stringify(body.segmentFilter ?? { type: 'all' }),
        scheduleJson: JSON.stringify(body.schedule ?? { type: 'immediate' }),
        speedJson: JSON.stringify(speed),
        timezone: body.timezone ?? DEFAULT_TIMEZONE,
        applyTagOnDispatch: body.applyTagOnDispatch ?? null,
      })

      for (let i = 0; i < conns.length; i++) {
        await db.insert(campaignConnections).values({ campaignId: id, connectionId: conns[i]!.id, position: i })
      }

      const variantResult = await replaceVariants(params.workspaceId, id, body.variants)
      if (!variantResult.ok) {
        await db.delete(campaigns).where(eq(campaigns.id, id))
        set.status = 400; return { message: variantResult.message }
      }

      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
      return { campaign }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        connectionIds: t.Array(t.String(), { minItems: 1 }),
        segmentFilter: t.Optional(t.Any()),
        variants: t.Array(VariantInput, { minItems: 1 }),
        schedule: t.Optional(ScheduleSchema),
        speed: t.Optional(SpeedSchema),
        timezone: t.Optional(t.String()),
        applyTagOnDispatch: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  // GET /workspaces/:workspaceId/campaigns/:campaignId
  .get(
    '/workspaces/:workspaceId/campaigns/:campaignId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!campaign) { set.status = 404; return { message: 'Campanha não encontrada.' } }

      const detail = await loadCampaignDetail(campaign.id)
      return { campaign, ...detail }
    },
  )

  // PATCH /workspaces/:workspaceId/campaigns/:campaignId
  .patch(
    '/workspaces/:workspaceId/campaigns/:campaignId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (!['draft', 'scheduled', 'paused'].includes(existing.status)) {
        set.status = 400
        return { message: 'Apenas campanhas em rascunho, agendadas ou pausadas podem ser editadas.' }
      }

      const updates: Partial<typeof campaigns.$inferInsert> = { updatedAt: new Date() }
      if (body.name !== undefined) updates.name = body.name
      if (body.segmentFilter !== undefined) updates.segmentFilter = JSON.stringify(body.segmentFilter)
      if (body.timezone !== undefined) updates.timezone = body.timezone
      if (body.applyTagOnDispatch !== undefined) updates.applyTagOnDispatch = body.applyTagOnDispatch
      if (body.schedule !== undefined) updates.scheduleJson = JSON.stringify(body.schedule)

      let conns = await loadSelectedConnections(
        params.workspaceId,
        body.connectionIds ?? [],
      )
      if (body.connectionIds !== undefined) {
        if (conns.length !== body.connectionIds.length || conns.length === 0) {
          set.status = 400; return { message: 'Uma ou mais conexões selecionadas não existem neste workspace.' }
        }
        updates.channel = campaignChannel(conns.map((c) => c.channel))
      } else {
        const current = await db
          .select({ connection: connections })
          .from(campaignConnections)
          .innerJoin(connections, eq(campaignConnections.connectionId, connections.id))
          .where(eq(campaignConnections.campaignId, params.campaignId))
        conns = current.map((r) => r.connection)
      }

      if (body.speed !== undefined) {
        const speedCheck = canUseSpeed(ctx.entitlements, body.speed, speedChannels(conns))
        if (!speedCheck.allowed) { set.status = 403; return { message: speedCheck.reason } }
        updates.speedJson = JSON.stringify(body.speed)
      } else if (body.connectionIds !== undefined) {
        // Trocar conexões muda os canais — a velocidade salva precisa continuar
        // válida contra o piso de cada canal novo (ex: manual 2s do Telegram
        // não vale se entrar uma conexão WhatsApp).
        try {
          const stored = JSON.parse(existing.speedJson) as Speed
          const speedCheck = canUseSpeed(ctx.entitlements, stored, speedChannels(conns))
          if (!speedCheck.allowed) {
            set.status = 403
            return { message: `A velocidade salva não é compatível com as novas conexões. ${speedCheck.reason}` }
          }
        } catch {
          // speedJson ilegível: o pacer coage para 'lento' em tempo de envio
        }
      }

      // Agendamento editado em campanha agendada → recalcula a próxima execução
      if (body.schedule !== undefined && existing.status === 'scheduled') {
        updates.nextRunAt = computeNextRunAt(
          body.schedule,
          new Date(),
          body.timezone ?? existing.timezone,
          existing.occurrenceCount,
        )
      }

      await db.update(campaigns).set(updates).where(eq(campaigns.id, params.campaignId))

      if (body.connectionIds !== undefined) {
        await db.delete(campaignConnections).where(eq(campaignConnections.campaignId, params.campaignId))
        for (let i = 0; i < conns.length; i++) {
          await db.insert(campaignConnections).values({ campaignId: params.campaignId, connectionId: conns[i]!.id, position: i })
        }
      }

      if (body.variants !== undefined) {
        const variantResult = await replaceVariants(params.workspaceId, params.campaignId, body.variants)
        if (!variantResult.ok) { set.status = 400; return { message: variantResult.message } }
      }

      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, params.campaignId)).limit(1)
      return { campaign: updated }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        connectionIds: t.Optional(t.Array(t.String(), { minItems: 1 })),
        segmentFilter: t.Optional(t.Any()),
        variants: t.Optional(t.Array(VariantInput, { minItems: 1 })),
        schedule: t.Optional(ScheduleSchema),
        speed: t.Optional(SpeedSchema),
        timezone: t.Optional(t.String()),
        applyTagOnDispatch: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  // DELETE /workspaces/:workspaceId/campaigns/:campaignId
  .delete(
    '/workspaces/:workspaceId/campaigns/:campaignId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (existing.status === 'running') {
        set.status = 400
        return { message: 'Não é possível excluir uma campanha em execução. Cancele-a primeiro.' }
      }

      await db.delete(campaigns).where(eq(campaigns.id, params.campaignId))
      return { message: 'Campanha excluída.' }
    },
  )

  // POST /workspaces/:workspaceId/campaigns/:campaignId/dispatch
  // Consentimento é obrigatório: o corpo só valida com consent === true.
  .post(
    '/workspaces/:workspaceId/campaigns/:campaignId/dispatch',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      // Email não confirmado não bloqueia o login, mas bloqueia disparo —
      // conta sem email verificado no Vianova não coloca mensagens na rua.
      if (!session?.emailVerified) {
        set.status = 403
        return { message: 'Confirme o email da sua conta Vianova para disparar campanhas. Se já confirmou, saia e entre novamente.' }
      }

      const subCheck = hasActiveSubscription(ctx.entitlements)
      if (!subCheck.allowed) { set.status = 403; return { message: subCheck.reason } }

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!campaign) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (!['draft', 'scheduled'].includes(campaign.status)) {
        set.status = 400
        return { message: 'Apenas campanhas em rascunho ou agendadas podem ser disparadas.' }
      }

      const now = new Date()
      const schedule = parseSchedule(campaign.scheduleJson)
      const tz = campaign.timezone || DEFAULT_TIMEZONE

      await db.update(campaigns).set({ consentAt: now, updatedAt: now }).where(eq(campaigns.id, campaign.id))

      // 'de X em X horas' começa agora: primeiro run imediato, próximo em +X
      const firstRunNow =
        schedule.type === 'immediate' ||
        (schedule.type === 'recurring' && schedule.recurrence?.kind === 'every_x_hours')

      if (firstRunNow) {
        startCampaignRun(campaign.id).catch((err) =>
          console.error(`[dispatch] erro ao iniciar run da campanha ${campaign.id}:`, err),
        )
        return { message: 'Disparo iniciado com sucesso.' }
      }

      const nextRunAt = computeNextRunAt(schedule, now, tz, campaign.occurrenceCount)
      if (!nextRunAt) {
        set.status = 400
        return { message: 'O agendamento configurado não tem nenhuma execução futura.' }
      }

      await db.update(campaigns).set({
        status: 'scheduled',
        nextRunAt,
        updatedAt: now,
      }).where(eq(campaigns.id, campaign.id))

      return { message: 'Campanha agendada com sucesso.', nextRunAt: nextRunAt.toISOString() }
    },
    {
      body: t.Object({
        consent: t.Literal(true, {
          error: 'É necessário confirmar o consentimento do público antes de disparar.',
        }),
      }),
    },
  )

  // POST /workspaces/:workspaceId/campaigns/:campaignId/pause
  .post(
    '/workspaces/:workspaceId/campaigns/:campaignId/pause',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (!['running', 'scheduled'].includes(existing.status)) {
        set.status = 400
        return { message: 'Apenas campanhas em execução ou agendadas podem ser pausadas.' }
      }

      const now = new Date()
      await db.update(campaigns).set({ status: 'paused', updatedAt: now }).where(eq(campaigns.id, params.campaignId))
      // O pacer observa o status no próximo passo e sai sem se reagendar
      await db.update(campaignRuns).set({ status: 'paused', nextPacerAt: null, updatedAt: now })
        .where(and(eq(campaignRuns.campaignId, params.campaignId), eq(campaignRuns.status, 'running')))

      return { message: 'Campanha pausada.' }
    },
  )

  // POST /workspaces/:workspaceId/campaigns/:campaignId/resume
  .post(
    '/workspaces/:workspaceId/campaigns/:campaignId/resume',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (existing.status !== 'paused') {
        set.status = 400
        return { message: 'Apenas campanhas pausadas podem ser retomadas.' }
      }

      const now = new Date()
      const [pausedRun] = await db
        .select()
        .from(campaignRuns)
        .where(and(eq(campaignRuns.campaignId, params.campaignId), eq(campaignRuns.status, 'paused')))
        .orderBy(desc(campaignRuns.runNumber))
        .limit(1)

      const [pending] = pausedRun
        ? await db
            .select({ count: sql<number>`count(*)::int` })
            .from(campaignMessages)
            .where(and(eq(campaignMessages.runId, pausedRun.id), inArray(campaignMessages.status, ['queued', 'sending'])))
        : [{ count: 0 }]

      if (pausedRun && (pending?.count ?? 0) > 0) {
        await db.update(campaignRuns).set({ status: 'running', nextPacerAt: now, updatedAt: now })
          .where(eq(campaignRuns.id, pausedRun.id))
        await db.update(campaigns).set({ status: 'running', updatedAt: now })
          .where(eq(campaigns.id, params.campaignId))
        await getQueue<PacerJob>(QUEUES.CAMPAIGN_PACER).add(
          `pacer:${pausedRun.id}:${Date.now()}`,
          { runId: pausedRun.id, campaignId: params.campaignId, sentInBurst: 0 },
          { ...defaultJobOptions, removeOnComplete: { count: 100 } },
        )
        return { message: 'Disparo retomado.' }
      }

      // Sem run pendente: fecha o run pausado (se houver) e volta ao agendamento
      if (pausedRun) {
        await db.update(campaignRuns).set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(campaignRuns.id, pausedRun.id))
      }
      const schedule = parseSchedule(existing.scheduleJson)
      const nextRunAt = computeNextRunAt(schedule, now, existing.timezone, existing.occurrenceCount)
      await db.update(campaigns).set({
        status: nextRunAt ? 'scheduled' : 'completed',
        nextRunAt,
        completedAt: nextRunAt ? null : now,
        updatedAt: now,
      }).where(eq(campaigns.id, params.campaignId))

      return { message: nextRunAt ? 'Campanha reagendada.' : 'Campanha concluída.' }
    },
  )

  // PATCH /workspaces/:workspaceId/campaigns/:campaignId/schedule
  .patch(
    '/workspaces/:workspaceId/campaigns/:campaignId/schedule',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (!['draft', 'scheduled', 'paused', 'running'].includes(existing.status)) {
        set.status = 400
        return { message: 'O agendamento desta campanha não pode mais ser alterado.' }
      }

      const updates: Partial<typeof campaigns.$inferInsert> = {
        scheduleJson: JSON.stringify(body.schedule),
        updatedAt: new Date(),
      }
      if (body.timezone !== undefined) updates.timezone = body.timezone

      if (body.speed !== undefined) {
        const conns = await db
          .select({ connection: connections })
          .from(campaignConnections)
          .innerJoin(connections, eq(campaignConnections.connectionId, connections.id))
          .where(eq(campaignConnections.campaignId, params.campaignId))
        const speedCheck = canUseSpeed(ctx.entitlements, body.speed, speedChannels(conns.map((r) => r.connection)))
        if (!speedCheck.allowed) { set.status = 403; return { message: speedCheck.reason } }
        updates.speedJson = JSON.stringify(body.speed)
      }

      // Agendada/em execução → recalcula a próxima ocorrência com o novo plano
      if (['scheduled', 'running'].includes(existing.status)) {
        updates.nextRunAt = computeNextRunAt(
          body.schedule as Schedule,
          new Date(),
          body.timezone ?? existing.timezone,
          existing.occurrenceCount,
        )
      }

      await db.update(campaigns).set(updates).where(eq(campaigns.id, params.campaignId))
      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, params.campaignId)).limit(1)
      return { campaign: updated }
    },
    {
      body: t.Object({
        schedule: ScheduleSchema,
        timezone: t.Optional(t.String()),
        speed: t.Optional(SpeedSchema),
      }),
    },
  )

  // POST /workspaces/:workspaceId/campaigns/:campaignId/cancel
  .post(
    '/workspaces/:workspaceId/campaigns/:campaignId/cancel',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Campanha não encontrada.' } }
      if (!['running', 'scheduled', 'paused'].includes(existing.status)) {
        set.status = 400
        return { message: 'Apenas campanhas em execução, agendadas ou pausadas podem ser canceladas.' }
      }

      const now = new Date()
      await db.update(campaigns).set({
        status: 'cancelled',
        nextRunAt: null,
        completedAt: now,
        updatedAt: now,
      }).where(eq(campaigns.id, params.campaignId))

      await db.update(campaignRuns).set({
        status: 'cancelled',
        nextPacerAt: null,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(campaignRuns.campaignId, params.campaignId),
        inArray(campaignRuns.status, ['pending', 'running', 'paused']),
      ))

      await db.update(campaignMessages).set({
        status: 'failed',
        failureReason: 'Campanha cancelada',
        updatedAt: now,
      }).where(and(
        eq(campaignMessages.campaignId, params.campaignId),
        inArray(campaignMessages.status, ['queued', 'sending']),
      ))

      return { message: 'Campanha cancelada.' }
    },
  )

  // GET /workspaces/:workspaceId/campaigns/:campaignId/runs — histórico
  .get(
    '/workspaces/:workspaceId/campaigns/:campaignId/runs',
    async ({ session, params, query, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)
      if (!campaign) { set.status = 404; return { message: 'Campanha não encontrada.' } }

      const page = Math.max(1, query.page ?? 1)
      const limit = Math.min(100, query.limit ?? 20)
      const offset = (page - 1) * limit

      const [runs, totalResult] = await Promise.all([
        db.select().from(campaignRuns)
          .where(eq(campaignRuns.campaignId, params.campaignId))
          .orderBy(desc(campaignRuns.runNumber))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` })
          .from(campaignRuns)
          .where(eq(campaignRuns.campaignId, params.campaignId)),
      ])

      return { runs, total: totalResult[0]?.count ?? 0, page, limit }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number()),
        limit: t.Optional(t.Number()),
      }),
    },
  )

  // GET /workspaces/:workspaceId/campaigns/:campaignId/messages
  .get(
    '/workspaces/:workspaceId/campaigns/:campaignId/messages',
    async ({ session, params, query, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.workspaceId, params.workspaceId)))
        .limit(1)

      if (!campaign) { set.status = 404; return { message: 'Campanha não encontrada.' } }

      const page = Math.max(1, query.page ?? 1)
      const limit = Math.min(200, query.limit ?? 50)
      const offset = (page - 1) * limit

      const conditions = [eq(campaignMessages.campaignId, params.campaignId)]
      if (query.status) {
        conditions.push(eq(campaignMessages.status, query.status as never))
      }
      if (query.runId) {
        conditions.push(eq(campaignMessages.runId, query.runId))
      }

      const [messages, totalResult] = await Promise.all([
        db.select({
          message: campaignMessages,
          contactName: contacts.name,
          contactPhone: contacts.whatsappPhone,
          contactTelegram: contacts.telegramChatId,
          contactIsGroup: contacts.isGroup,
        })
          .from(campaignMessages)
          .leftJoin(contacts, eq(campaignMessages.contactId, contacts.id))
          .where(and(...conditions))
          .orderBy(desc(campaignMessages.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` })
          .from(campaignMessages)
          .where(and(...conditions)),
      ])

      return { messages, total: totalResult[0]?.count ?? 0, page, limit }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number()),
        limit: t.Optional(t.Number()),
        status: t.Optional(t.String()),
        runId: t.Optional(t.String()),
      }),
    },
  )

  // GET /workspaces/:workspaceId/usage
  .get(
    '/workspaces/:workspaceId/usage',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [connectionsCount, contactsCount, creditsBalance, campaignsThisMonth] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(connections).where(eq(connections.workspaceId, params.workspaceId)).then((r) => r[0]?.count ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.workspaceId, params.workspaceId)).then((r) => r[0]?.count ?? 0),
        getCreditsBalance(params.workspaceId),
        getMonthlyCampaignCount(params.workspaceId),
      ])

      return { connectionsCount, contactsCount, creditsBalance, campaignsThisMonth }
    },
  )

  // GET /workspaces/:workspaceId/dashboard/timeseries — envios por tempo
  .get(
    '/workspaces/:workspaceId/dashboard/timeseries',
    async ({ session, params, query, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const tz = query.tz || DEFAULT_TIMEZONE

      try {
        // sent_at é timestamp naive em UTC: AT TIME ZONE 'UTC' o transforma em
        // timestamptz, o segundo AT TIME ZONE projeta no fuso do usuário.
        const perDayRows = await db.execute(sql`
          SELECT
            to_char((cm.sent_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date,
            count(*)::int AS sent
          FROM campaign_messages cm
          INNER JOIN campaigns c ON c.id = cm.campaign_id
          WHERE c.workspace_id = ${params.workspaceId}
            AND cm.sent_at IS NOT NULL
            AND cm.sent_at >= now() - interval '30 days'
          GROUP BY 1
          ORDER BY 1
        `)

        const failedPerDayRows = await db.execute(sql`
          SELECT
            to_char((cm.updated_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date,
            count(*)::int AS failed
          FROM campaign_messages cm
          INNER JOIN campaigns c ON c.id = cm.campaign_id
          WHERE c.workspace_id = ${params.workspaceId}
            AND cm.status = 'failed'
            AND cm.updated_at >= now() - interval '30 days'
          GROUP BY 1
          ORDER BY 1
        `)

        const perHourRows = await db.execute(sql`
          SELECT
            to_char((cm.sent_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'HH24') AS hour,
            count(*)::int AS sent
          FROM campaign_messages cm
          INNER JOIN campaigns c ON c.id = cm.campaign_id
          WHERE c.workspace_id = ${params.workspaceId}
            AND cm.sent_at IS NOT NULL
            AND ((cm.sent_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date = (now() AT TIME ZONE ${tz})::date
          GROUP BY 1
          ORDER BY 1
        `)

        const failedByDate = new Map(
          (failedPerDayRows as unknown as Array<{ date: string; failed: number }>).map((r) => [r.date, r.failed]),
        )
        const perDay = (perDayRows as unknown as Array<{ date: string; sent: number }>).map((r) => ({
          date: r.date,
          sent: Number(r.sent),
          failed: Number(failedByDate.get(r.date) ?? 0),
        }))
        // Dias só com falhas (nenhum envio) também aparecem na série
        for (const [date, failed] of failedByDate) {
          if (!perDay.some((d) => d.date === date)) perDay.push({ date, sent: 0, failed: Number(failed) })
        }
        perDay.sort((a, b) => a.date.localeCompare(b.date))
        
        return {
          perDay,
          perHour: (perHourRows as unknown as Array<{ hour: string; sent: number }>).map((r) => ({
            hour: r.hour,
            sent: Number(r.sent),
          })),
          timezone: tz,
        }
      } catch (err) {
        console.error('[timeseries] erro ao consultar banco:', err)
        set.status = 500
        return { message: 'Erro ao buscar série temporal.' }
      }
    },
    {
      query: t.Object({
        tz: t.Optional(t.String()),
      }),
    },
  )

  // GET /workspaces/:workspaceId/dashboard — dados consolidados para a home do tenant
  .get(
    '/workspaces/:workspaceId/dashboard',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [
        connectionsCount,
        contactsCount,
        creditsBalance,
        campaignsThisMonth,
        activeConnectionsStats,
        optedOutContactsCount,
        totalCampaignsCount,
        recentCampaigns,
        campaignSums,
        campaignStatusGroups,
        messageStatusGroups,
        contactsList,
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(connections).where(eq(connections.workspaceId, params.workspaceId)).then((r) => r[0]?.count ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.workspaceId, params.workspaceId)).then((r) => r[0]?.count ?? 0),
        getCreditsBalance(params.workspaceId),
        getMonthlyCampaignCount(params.workspaceId),
        db.select({ channel: connections.channel, count: sql<number>`count(*)::int` }).from(connections).where(and(eq(connections.workspaceId, params.workspaceId), eq(connections.status, 'active'))).groupBy(connections.channel).then((rows) => {
          return {
            whatsapp: rows.find(r => r.channel === 'whatsapp')?.count ?? 0,
            telegram: rows.find(r => r.channel === 'telegram')?.count ?? 0,
            total: rows.reduce((acc, curr) => acc + curr.count, 0)
          }
        }),
        db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.optInStatus, false))).then((r) => r[0]?.count ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.workspaceId, params.workspaceId)).then((r) => r[0]?.count ?? 0),
        db.select().from(campaigns).where(eq(campaigns.workspaceId, params.workspaceId)).orderBy(desc(campaigns.createdAt)).limit(6),
        db.select({
          totalContactsSum: sql<number>`coalesce(sum(${campaigns.totalContacts}), 0)::int`,
          sentCount: sql<number>`coalesce(sum(${campaigns.sentCount}), 0)::int`,
          deliveredCount: sql<number>`coalesce(sum(${campaigns.deliveredCount}), 0)::int`,
          readCount: sql<number>`coalesce(sum(${campaigns.readCount}), 0)::int`,
          failedCount: sql<number>`coalesce(sum(${campaigns.failedCount}), 0)::int`,
        }).from(campaigns).where(eq(campaigns.workspaceId, params.workspaceId)).then((r) => r[0] ?? { totalContactsSum: 0, sentCount: 0, deliveredCount: 0, readCount: 0, failedCount: 0 }),
        db.select({
          status: campaigns.status,
          count: sql<number>`count(*)::int`,
        }).from(campaigns).where(eq(campaigns.workspaceId, params.workspaceId)).groupBy(campaigns.status),
        db.select({
          status: campaignMessages.status,
          count: sql<number>`count(*)::int`,
        }).from(campaignMessages).innerJoin(campaigns, eq(campaignMessages.campaignId, campaigns.id)).where(eq(campaigns.workspaceId, params.workspaceId)).groupBy(campaignMessages.status),
        // Agregado no banco: extrai UF do custom_fields por regex (nunca
        // lança em JSON inválido, ao contrário do cast ::jsonb) e o DDD do
        // telefone, sem trazer a base de contatos inteira pra memória.
        db.execute(sql`
          SELECT
            upper(trim(substring(custom_fields from '"(?:estado|uf|state)"\\s*:\\s*"([^"]*)"'))) AS "customUf",
            CASE
              WHEN digits LIKE '55%' AND length(digits) >= 12 THEN substring(digits, 3, 2)
              WHEN length(digits) IN (10, 11) THEN substring(digits, 1, 2)
            END AS ddd,
            count(*)::int AS c
          FROM (
            SELECT custom_fields, regexp_replace(coalesce(whatsapp_phone, ''), '\\D', '', 'g') AS digits
            FROM contacts
            WHERE workspace_id = ${params.workspaceId}
          ) t
          GROUP BY 1, 2
        `) as unknown as Promise<Array<{ customUf: string | null; ddd: string | null; c: number }>>,
      ])

      const campaignsByStatus: Record<string, number> = { draft: 0, scheduled: 0, running: 0, paused: 0, completed: 0, cancelled: 0, failed: 0 }
      for (const row of campaignStatusGroups) {
        campaignsByStatus[row.status] = row.count
      }

      const messagesByStatus: Record<string, number> = { queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 }
      for (const row of messageStatusGroups) {
        messagesByStatus[row.status] = row.count
      }

      // Tabela explícita DDD→UF (plano ANATEL). Faixas sobrepostas do código
      // anterior mapeavam AL/PB/RN/CE/PI pra PE e RR/AP pra AM.
      const DDD_UF: Record<number, string> = {
        11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
        21: 'RJ', 22: 'RJ', 24: 'RJ',
        27: 'ES', 28: 'ES',
        31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
        41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR',
        47: 'SC', 48: 'SC', 49: 'SC',
        51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
        61: 'DF', 62: 'GO', 63: 'TO', 64: 'GO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO',
        71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA',
        79: 'SE',
        81: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 86: 'PI', 87: 'PE', 88: 'CE', 89: 'PI',
        91: 'PA', 92: 'AM', 93: 'PA', 94: 'PA', 95: 'RR', 96: 'AP', 97: 'AM', 98: 'MA', 99: 'MA',
      }

      const contactsByStateUF: Record<string, number> = {}
      for (const row of contactsList) {
        const uf = row.customUf || (row.ddd ? DDD_UF[Number(row.ddd)] : undefined) || 'Outros/Intl'
        contactsByStateUF[uf] = (contactsByStateUF[uf] || 0) + Number(row.c)
      }

      return {
        usage: { connectionsCount, contactsCount, creditsBalance, campaignsThisMonth },
        summary: {
          totalCampaigns: totalCampaignsCount,
          totalContacts: contactsCount,
          optedOutContacts: optedOutContactsCount,
          activeConnections: activeConnectionsStats.total,
          activeWaConnections: activeConnectionsStats.whatsapp,
          activeTgConnections: activeConnectionsStats.telegram,
          totalContactsSum: campaignSums.totalContactsSum,
          sentCount: campaignSums.sentCount,
          deliveredCount: campaignSums.deliveredCount,
          readCount: campaignSums.readCount,
          failedCount: campaignSums.failedCount,
        },
        campaignsByStatus,
        messagesByStatus,
        contactsByStateUF,
        recentCampaigns,
      }
    },
  )
