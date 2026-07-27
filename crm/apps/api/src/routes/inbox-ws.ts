import { Elysia, t } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { db } from '@crm/db'
import { agentSessions, agents } from '@crm/db/schema'
import { eq } from 'drizzle-orm'
import { wsHub, type WsClient } from '../services/ws-hub'

const CRM_JWT_SECRET = process.env.CRM_JWT_SECRET || 'dev-secret'

// WebSocket do inbox: uma conexão por sessão de agente autenticada.
// Token vem via query (?token=) porque o browser não envia Authorization em WS.
// Cada ws mantém seu WsClient registrado no hub por workspace.
export const inboxWsRoutes = new Elysia({ name: 'inbox-ws' })
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
  .ws('/inbox/ws', {
    query: t.Object({ token: t.Optional(t.String()) }),
    async open(ws) {
      const token = ws.data.query.token
      if (!token) {
        ws.close()
        return
      }

      const payload = await ws.data.jwtInbox.verify(token)
      if (!payload) {
        ws.close()
        return
      }

      // Sessão ainda válida e agente ativado?
      const [session] = await db.select().from(agentSessions).where(eq(agentSessions.sid, payload.sid)).limit(1)
      if (!session) {
        ws.close()
        return
      }
      const [agent] = await db.select().from(agents).where(eq(agents.id, payload.agentId)).limit(1)
      if (!agent || !agent.activatedAt) {
        ws.close()
        return
      }

      const client: WsClient = {
        agentId: payload.agentId,
        workspaceId: payload.workspaceId,
        send: (data: string) => ws.send(data),
      }
      // Guarda o client no próprio ws para remover no close.
      ;(ws.data as any).__client = client
      wsHub.join(client)
      ws.send(JSON.stringify({ type: 'connected', workspaceId: payload.workspaceId }))
    },
    close(ws) {
      const client = (ws.data as any).__client as WsClient | undefined
      if (client) wsHub.leave(client)
    },
  })
