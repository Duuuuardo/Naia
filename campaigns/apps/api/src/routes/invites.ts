import { Elysia, t } from 'elysia'
import { db, invites, members, workspaces } from '@naia/db'
import { eq, and, count } from 'drizzle-orm'
import { canAddSeat } from '@naia/entitlements'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { generateId, generateToken } from '../lib/crypto'
import { getRequiredEnv } from '../lib/env'
import { createVianovaEmailClient } from '@naia/vianova-email'
import { buildWorkspaceInviteEmail } from '../lib/invite-email'

const VIANOVA_WEB_URL = getRequiredEnv('VIANOVA_WEB_URL')
const NAIA_WEB_URL = getRequiredEnv('NAIA_WEB_URL')
const VIANOVA_API_URL = getRequiredEnv('VIANOVA_API_URL')
const VIANOVA_INTERNAL_SECRET = getRequiredEnv('VIANOVA_INTERNAL_SECRET')
const emailClient = createVianovaEmailClient({
  vianovaApiUrl: VIANOVA_API_URL,
  internalSecret: VIANOVA_INTERNAL_SECRET,
})

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const inviteRoutes = new Elysia()
  .use(authPlugin)

  .get('/workspaces/:workspaceId/invites', async ({ session, params, set }) => {
    const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
    if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
    if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

    const rows = await db
      .select()
      .from(invites)
      .where(and(eq(invites.workspaceId, params.workspaceId), eq(invites.status, 'pending')))
      .orderBy(invites.createdAt)

    return { invites: rows }
  })

  .post(
    '/workspaces/:workspaceId/invites',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [memberCountResult] = await db
        .select({ count: count() })
        .from(members)
        .where(eq(members.workspaceId, params.workspaceId))

      const [pendingInvitesResult] = await db
        .select({ count: count() })
        .from(invites)
        .where(and(eq(invites.workspaceId, params.workspaceId), eq(invites.status, 'pending')))

      const projectedSeats = (memberCountResult?.count ?? 0) + (pendingInvitesResult?.count ?? 0)
      const check = canAddSeat(ctx.entitlements, projectedSeats)
      if (!check.allowed) {
        set.status = 403
        return { message: check.reason, upgradeUrl: `${VIANOVA_WEB_URL}/billing` }
      }

      const token = generateToken()
      const id = generateId()
      await db.insert(invites).values({
        id,
        workspaceId: params.workspaceId,
        email: body.email.toLowerCase(),
        role: body.role ?? 'member',
        invitedByUserId: ctx.userId,
        token,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })

      const [workspace] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      const inviteUrl = `${NAIA_WEB_URL}/invites/${token}`

      try {
        const email = buildWorkspaceInviteEmail({
          workspaceName: workspace?.name ?? 'seu workspace',
          inviteUrl,
        })
        await emailClient.enqueue({
          to: body.email.toLowerCase(),
          ...email,
          brand: 'naia',
          workspaceId: params.workspaceId,
        })
      } catch (error) {
        await db.delete(invites).where(eq(invites.id, id))
        console.error(`[invite] falha ao enfileirar email para workspace ${params.workspaceId}:`, error)
        set.status = 502
        return { message: 'Não foi possível enviar o convite por e-mail. Tente novamente.' }
      }

      const [invite] = await db.select().from(invites).where(eq(invites.id, id)).limit(1)
      return { invite, emailQueued: true as const }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('member')])),
      }),
    },
  )

  .delete('/workspaces/:workspaceId/invites/:inviteId', async ({ session, params, set }) => {
    const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
    if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
    if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
    if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

    await db.delete(invites).where(and(eq(invites.id, params.inviteId), eq(invites.workspaceId, params.workspaceId)))
    return { message: 'Convite revogado.' }
  })

  .post('/invites/:token/accept', async ({ session, params, set }) => {
    if (!session) { set.status = 401; return { message: 'Não autenticado.' } }

    const [invite] = await db.select().from(invites).where(eq(invites.token, params.token)).limit(1)
    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      set.status = 400
      return { message: 'Convite inválido ou expirado.' }
    }

    if (invite.email !== session.email.toLowerCase()) {
      set.status = 403
      return { message: 'Este convite foi enviado para outro email.' }
    }

    const [existingMember] = await db
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, invite.workspaceId), eq(members.userId, session.userId)))
      .limit(1)

    if (!existingMember) {
      await db.insert(members).values({
        id: generateId(),
        workspaceId: invite.workspaceId,
        userId: session.userId,
        role: invite.role,
      })
    }

    await db.update(invites).set({ status: 'accepted' }).where(eq(invites.id, invite.id))

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, invite.workspaceId)).limit(1)
    return { workspace }
  })
