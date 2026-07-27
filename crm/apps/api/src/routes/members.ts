import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { workspaceManagers } from '@crm/db/schema'
import { eq, and } from 'drizzle-orm'
import { authManagementPlugin } from '../plugins/auth-management'
import { resolveManagerAccess } from '../lib/workspace-auth'

// Managers (owner/admin) do painel de gestão — distinto dos agents do inbox.
// name/email/pictureUrl já vêm cacheados do Vianova na própria tabela.
export const membersRoutes = new Elysia({ name: 'members' })
  .use(authManagementPlugin)

  // GET /workspaces/:workspaceId/members
  .get('/workspaces/:workspaceId/members', async ({ user, params, set }) => {
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
      .from(workspaceManagers)
      .where(eq(workspaceManagers.workspaceId, params.workspaceId))
      .orderBy(workspaceManagers.createdAt)

    return { members: rows }
  })

  // PATCH /workspaces/:workspaceId/members/:managerId — trocar role (Owner apenas).
  .patch(
    '/workspaces/:workspaceId/members/:managerId',
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
      if (ctx.role !== 'owner') {
        set.status = 403
        return { message: 'Apenas o Owner pode alterar papéis.' }
      }

      const [target] = await db
        .select()
        .from(workspaceManagers)
        .where(and(eq(workspaceManagers.id, params.managerId), eq(workspaceManagers.workspaceId, params.workspaceId)))
        .limit(1)

      if (!target) {
        set.status = 404
        return { message: 'Membro não encontrado.' }
      }
      if (target.role === 'owner') {
        set.status = 400
        return { message: 'Não é possível alterar o papel do Owner.' }
      }

      await db.update(workspaceManagers).set({ role: body.role }).where(eq(workspaceManagers.id, params.managerId))
      return { message: 'Papel atualizado.' }
    },
    { body: t.Object({ role: t.Union([t.Literal('owner'), t.Literal('admin')]) }) },
  )

  // DELETE /workspaces/:workspaceId/members/:managerId — Owner remove qualquer
  // manager; qualquer manager remove a si mesmo; Owner não é removível.
  .delete('/workspaces/:workspaceId/members/:managerId', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.members) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    const [target] = await db
      .select()
      .from(workspaceManagers)
      .where(and(eq(workspaceManagers.id, params.managerId), eq(workspaceManagers.workspaceId, params.workspaceId)))
      .limit(1)

    if (!target) {
      set.status = 404
      return { message: 'Membro não encontrado.' }
    }
    if (target.role === 'owner') {
      set.status = 400
      return { message: 'O Owner não pode ser removido.' }
    }

    const isSelf = target.vianovaUserId === ctx.userId
    if (!isSelf && ctx.role !== 'owner') {
      set.status = 403
      return { message: 'Apenas o Owner pode remover outros membros.' }
    }

    await db.delete(workspaceManagers).where(eq(workspaceManagers.id, params.managerId))
    return { message: 'Membro removido.' }
  })
