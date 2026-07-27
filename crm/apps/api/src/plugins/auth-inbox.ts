import { Elysia, t } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { db } from '@crm/db'
import { agents, agentSessions } from '@crm/db/schema'
import { eq } from 'drizzle-orm'

const CRM_JWT_SECRET = process.env.CRM_JWT_SECRET || 'dev-secret'

export interface InboxAgent {
  id: string
  workspaceId: string
  name: string
  role: 'superadmin' | 'admin' | 'agent'
  sid: string
}

// Guard de superadmin: só o superadmin gerencia agentes, conexões, filas e
// permissões no contexto do inbox. Uso: `if (!requireSuperadmin(agent)) { set.status = 403; ... }`.
export const requireSuperadmin = (agent: InboxAgent | null): agent is InboxAgent =>
  agent?.role === 'superadmin'

// Auth plugin para inbox: CRM own JWT auth.
// Valida sessão de agente no workspace. Adiciona 'agent' (InboxAgent | null).
export const authInboxPlugin = new Elysia({ name: 'auth-inbox' })
  .use(
    jwt({
      name: 'jwtInbox',
      secret: CRM_JWT_SECRET,
      schema: t.Object({
        agentId: t.String(),
        workspaceId: t.String(),
        sid: t.String(),
      }),
    }),
  )
  .derive({ as: 'global' }, async (ctx) => {
    const { jwtInbox } = ctx
    const headers = ctx.headers as Record<string, string | undefined>
    const cookie = ctx.cookie as Record<string, any>

    // Try Authorization header first, then cookie.
    const authHeader = headers.authorization
    const token = authHeader?.replace('Bearer ', '') || cookie.crm_inbox_session?.value

    if (!token) {
      return { agent: null as InboxAgent | null }
    }

    try {
      const payload = await jwtInbox.verify(token)
      if (!payload) {
        return { agent: null as InboxAgent | null }
      }

      // Verify session exists
      const session = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sid, payload.sid))
        .limit(1)

      if (session.length === 0) {
        return { agent: null as InboxAgent | null }
      }

      // Verify agent is still activated
      const agent = await db.select().from(agents).where(eq(agents.id, payload.agentId)).limit(1)

      if (agent.length === 0 || !agent[0].activatedAt) {
        return { agent: null as InboxAgent | null }
      }

      return {
        agent: {
          id: payload.agentId,
          workspaceId: payload.workspaceId,
          name: agent[0].name,
          role: agent[0].role,
          sid: payload.sid,
        } as InboxAgent,
      }
    } catch (error) {
      console.error('[auth-inbox] token verification failed:', error)
      return { agent: null as InboxAgent | null }
    }
  })
