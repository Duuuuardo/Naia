import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { tags as labels } from '@crm/db/schema'
import { eq, and } from 'drizzle-orm'
import { authManagementPlugin } from '../plugins/auth-management'
import { resolveManagerAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'

// Labels de conversa, configuradas por workspace (Owner/Admin).
// Lê/escreve na tabela unificada `tags` (labels foram migradas para tags).
export const labelsRoutes = new Elysia({ name: 'labels' })
  .use(authManagementPlugin)

  // GET /workspaces/:workspaceId/labels
  .get('/workspaces/:workspaceId/labels', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.settings) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    const rows = await db
      .select()
      .from(labels)
      .where(eq(labels.workspaceId, params.workspaceId))
      .orderBy(labels.createdAt)

    return { labels: rows }
  })

  // POST /workspaces/:workspaceId/labels
  .post(
    '/workspaces/:workspaceId/labels',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }
      if (!ctx.permissions.settings) {
        set.status = 403
        return { message: 'Seu papel não tem acesso a esta área do workspace.' }
      }

      const labelId = generateId()
      await db.insert(labels).values({
        id: labelId,
        workspaceId: params.workspaceId,
        name: body.name,
        color: body.color,
      })

      return { label: { id: labelId, name: body.name, color: body.color } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 40 }),
        color: t.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
      }),
    },
  )

  // PATCH /workspaces/:workspaceId/labels/:labelId
  .patch(
    '/workspaces/:workspaceId/labels/:labelId',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }
      if (!ctx.permissions.settings) {
        set.status = 403
        return { message: 'Seu papel não tem acesso a esta área do workspace.' }
      }

      await db
        .update(labels)
        .set({ name: body.name, color: body.color })
        .where(and(eq(labels.id, params.labelId), eq(labels.workspaceId, params.workspaceId)))

      return { message: 'Label atualizada.' }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 40 }),
        color: t.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
      }),
    },
  )

  // DELETE /workspaces/:workspaceId/labels/:labelId
  .delete('/workspaces/:workspaceId/labels/:labelId', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.settings) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    await db.delete(labels).where(and(eq(labels.id, params.labelId), eq(labels.workspaceId, params.workspaceId)))
    return { message: 'Label removida.' }
  })
