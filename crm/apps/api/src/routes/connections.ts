import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { connections } from '@crm/db/schema'
import { eq, and, count } from 'drizzle-orm'
import { canAddConnection } from '@crm/entitlements'
import { authManagementPlugin } from '../plugins/auth-management'
import { resolveManagerAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'

// CRUD de conexões (canais de entrada). O estabelecimento da sessão real
// (QR WhatsApp, validação de token Telegram) é responsabilidade do worker —
// aqui a conexão nasce 'disconnected' e o worker atualiza o status.
export const connectionsRoutes = new Elysia({ name: 'connections' })
  .use(authManagementPlugin)

  // GET /workspaces/:workspaceId/connections
  .get('/workspaces/:workspaceId/connections', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    const rows = await db
      .select({
        id: connections.id,
        name: connections.name,
        kind: connections.kind,
        status: connections.status,
        createdAt: connections.createdAt,
      })
      .from(connections)
      .where(eq(connections.workspaceId, params.workspaceId))
      .orderBy(connections.createdAt)

    return { connections: rows }
  })

  // POST /workspaces/:workspaceId/connections — cria um canal (worker faz o resto).
  .post(
    '/workspaces/:workspaceId/connections',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }

      const [{ count: connCount }] = await db
        .select({ count: count() })
        .from(connections)
        .where(eq(connections.workspaceId, params.workspaceId))

      const check = canAddConnection(ctx.entitlements, connCount)
      if (!check.allowed) {
        set.status = 403
        return { message: check.reason, upgradeUrl: '/billing' }
      }

      const connectionId = generateId()
      await db.insert(connections).values({
        id: connectionId,
        workspaceId: params.workspaceId,
        name: body.name,
        kind: body.kind,
        status: 'disconnected',
        config: {},
      })

      // TODO: enfileirar job no worker para iniciar sessão (QR WhatsApp /
      // validação de token Telegram) — crm:session-events.

      return {
        connection: { id: connectionId, name: body.name, kind: body.kind, status: 'disconnected' },
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        kind: t.Union([t.Literal('whatsapp'), t.Literal('telegram')]),
      }),
    },
  )

  // DELETE /workspaces/:workspaceId/connections/:connectionId
  .delete('/workspaces/:workspaceId/connections/:connectionId', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    await db
      .delete(connections)
      .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))

    // TODO: enfileirar job para encerrar sessão do canal no worker.

    return { message: 'Conexão removida.' }
  })
