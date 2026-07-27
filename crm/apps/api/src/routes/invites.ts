import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { managerInvites, workspaceManagers, workspaces } from '@crm/db/schema'
import { eq, and, count } from 'drizzle-orm'
import { authManagementPlugin } from '../plugins/auth-management'
import { resolveManagerAccess } from '../lib/workspace-auth'
import { generateId, generateToken } from '../lib/crypto'
import { requireEnv } from '../lib/env'
import { emailClient } from '../lib/email'
import { buildManagerInviteEmail } from '../lib/invite-email'

const CRM_WEB_URL = requireEnv('CRM_WEB_URL')

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const invitesRoutes = new Elysia({ name: 'invites' })
  .use(authManagementPlugin)

  // GET /workspaces/:workspaceId/invites — convites pendentes.
  .get('/workspaces/:workspaceId/invites', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.members) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    const rows = await db
      .select()
      .from(managerInvites)
      .where(and(eq(managerInvites.workspaceId, params.workspaceId), eq(managerInvites.status, 'pending')))
      .orderBy(managerInvites.createdAt)

    return { invites: rows }
  })

  // POST /workspaces/:workspaceId/invites — Owner/Admin convida um manager por
  // email. Convidado precisa ter (ou criar) conta no Vianova antes de aceitar —
  // o aceite (POST /invites/:token/accept) exige sessão Vianova válida.
  .post(
    '/workspaces/:workspaceId/invites',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }
      if (!ctx.permissions.members) {
        set.status = 403
        return { message: 'Seu papel não tem acesso a esta área do workspace.' }
      }

      // Limite de managers do plano: managers atuais + convites pendentes.
      // managersLimit < 0 = ilimitado (Scale).
      const { managersLimit } = ctx.entitlements
      if (managersLimit >= 0) {
        const [managerCountResult] = await db
          .select({ count: count() })
          .from(workspaceManagers)
          .where(eq(workspaceManagers.workspaceId, params.workspaceId))

        const [pendingInvitesResult] = await db
          .select({ count: count() })
          .from(managerInvites)
          .where(and(eq(managerInvites.workspaceId, params.workspaceId), eq(managerInvites.status, 'pending')))

        const projectedManagers = (managerCountResult?.count ?? 0) + (pendingInvitesResult?.count ?? 0)
        if (projectedManagers >= managersLimit) {
          set.status = 403
          return { message: 'Limite de gerentes do plano atingido. Faça upgrade para adicionar mais.' }
        }
      }

      const token = generateToken()
      const id = generateId()
      await db.insert(managerInvites).values({
        id,
        workspaceId: params.workspaceId,
        email: body.email.toLowerCase(),
        role: body.role ?? 'admin',
        invitedByUserId: ctx.userId,
        token,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })

      const inviteUrl = `${CRM_WEB_URL}/invites/${token}`

      try {
        const email = buildManagerInviteEmail({
          workspaceName: ctx.workspace.name,
          inviteUrl,
        })
        await emailClient.enqueue({
          to: body.email.toLowerCase(),
          ...email,
          brand: 'crm',
          workspaceId: params.workspaceId,
        })
      } catch (error) {
        await db.delete(managerInvites).where(eq(managerInvites.id, id))
        console.error(`[invites] falha ao enfileirar email para workspace ${params.workspaceId}:`, error)
        set.status = 502
        return { message: 'Não foi possível enviar o convite por e-mail. Tente novamente.' }
      }

      const [invite] = await db.select().from(managerInvites).where(eq(managerInvites.id, id)).limit(1)
      return { invite, emailQueued: true as const }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('owner')])),
      }),
    },
  )

  // DELETE /workspaces/:workspaceId/invites/:inviteId — revogar convite.
  .delete('/workspaces/:workspaceId/invites/:inviteId', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.members) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    await db
      .delete(managerInvites)
      .where(and(eq(managerInvites.id, params.inviteId), eq(managerInvites.workspaceId, params.workspaceId)))
    return { message: 'Convite revogado.' }
  })

  // POST /invites/:token/accept — exige sessão Vianova ativa; email do convite
  // precisa bater com o email da sessão (não dá pra aceitar convite alheio).
  .post('/invites/:token/accept', async ({ user, params, set }) => {
    if (!user) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [invite] = await db.select().from(managerInvites).where(eq(managerInvites.token, params.token)).limit(1)
    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      set.status = 400
      return { message: 'Convite inválido ou expirado.' }
    }

    if (invite.email !== user.email.toLowerCase()) {
      set.status = 403
      return { message: 'Este convite foi enviado para outro email.' }
    }

    const [existingManager] = await db
      .select()
      .from(workspaceManagers)
      .where(and(eq(workspaceManagers.workspaceId, invite.workspaceId), eq(workspaceManagers.vianovaUserId, user.userId)))
      .limit(1)

    if (!existingManager) {
      await db.insert(workspaceManagers).values({
        id: generateId(),
        workspaceId: invite.workspaceId,
        vianovaUserId: user.userId,
        role: invite.role,
        name: user.name,
        email: user.email.toLowerCase(),
        pictureUrl: user.picture,
      })
    }

    await db.update(managerInvites).set({ status: 'accepted' }).where(eq(managerInvites.id, invite.id))

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, invite.workspaceId)).limit(1)
    return { workspace }
  })
