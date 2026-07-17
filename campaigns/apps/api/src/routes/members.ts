import { Elysia, t } from 'elysia'
import { db, members, directoryUsers } from '@naia/db'
import { eq, and } from 'drizzle-orm'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'

export const memberRoutes = new Elysia()
  .use(authPlugin)

  // GET /workspaces/:workspaceId/members
  .get('/workspaces/:workspaceId/members', async ({ session, params, set }) => {
    const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
    if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
    if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

    const rows = await db
      .select({
        member: members,
        email: directoryUsers.email,
        name: directoryUsers.name,
        picture: directoryUsers.picture,
        pictureFrame: directoryUsers.pictureFrame,
      })
      .from(members)
      .leftJoin(directoryUsers, eq(members.userId, directoryUsers.id))
      .where(eq(members.workspaceId, params.workspaceId))
      .orderBy(members.createdAt)

    return {
      members: rows.map((r) => ({
        id: r.member.id,
        userId: r.member.userId,
        role: r.member.role,
        email: r.email ?? null,
        name: r.name ?? null,
        picture: r.picture ?? null,
        pictureFrame: r.pictureFrame ?? null,
        createdAt: r.member.createdAt,
      })),
    }
  })

  // PATCH /workspaces/:workspaceId/members/:memberId — trocar role (Owner apenas).
  .patch(
    '/workspaces/:workspaceId/members/:memberId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role !== 'owner') { set.status = 403; return { message: 'Apenas o Owner pode alterar papéis.' } }

      const [target] = await db
        .select()
        .from(members)
        .where(and(eq(members.id, params.memberId), eq(members.workspaceId, params.workspaceId)))
        .limit(1)

      if (!target) { set.status = 404; return { message: 'Membro não encontrado.' } }
      if (target.role === 'owner') { set.status = 400; return { message: 'Não é possível alterar o papel do Owner.' } }

      await db.update(members).set({ role: body.role }).where(eq(members.id, params.memberId))
      return { message: 'Papel atualizado.' }
    },
    { body: t.Object({ role: t.Union([t.Literal('admin'), t.Literal('member')]) }) },
  )

  // DELETE /workspaces/:workspaceId/members/:memberId — Owner pode remover qualquer membro.
  .delete(
    '/workspaces/:workspaceId/members/:memberId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [target] = await db
        .select()
        .from(members)
        .where(and(eq(members.id, params.memberId), eq(members.workspaceId, params.workspaceId)))
        .limit(1)

      if (!target) { set.status = 404; return { message: 'Membro não encontrado.' } }
      if (target.role === 'owner') { set.status = 400; return { message: 'O Owner não pode ser removido.' } }

      const isSelf = target.userId === ctx.userId
      if (!isSelf && ctx.role !== 'owner') {
        set.status = 403
        return { message: 'Apenas o Owner pode remover outros membros.' }
      }

      await db.delete(members).where(eq(members.id, params.memberId))
      return { message: 'Membro removido.' }
    },
  )
