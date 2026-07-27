import { Elysia, t } from 'elysia'
import { verifyUserToken, verifyServiceToken, type VianovaUser } from '@naia/vianova-auth'
import { db } from '@crm/db'
import { revokedSessions, entitlements } from '@crm/db/schema'
import { eq } from 'drizzle-orm'

// Valida um service token do Vianova (assinado por JWKS, aud = naia-crm) com o
// scope exigido. Token vem no header Authorization: Bearer.
async function requireServiceScope(authHeader: string | undefined, scope: string): Promise<boolean> {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!token) return false
  return verifyServiceToken(token, scope)
}

// Auth plugin para management panel: Vianova OIDC + single sign-out via revoked_sessions.
// Adiciona 'user' (VianovaUser | null) ao context.
export const authManagementPlugin = new Elysia({ name: 'auth-management' }).derive(
  { as: 'global' },
  async ({ headers, cookie }) => {
    let token: string | undefined
    const authHeader = headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
    if (!token && cookie.crm_session) {
      token = cookie.crm_session.value as string
    }

    if (!token) return { user: null as VianovaUser | null, rawToken: null as string | null }

    const user = await verifyUserToken(token)
    if (!user) return { user: null as VianovaUser | null, rawToken: null as string | null }

    // Single sign-out: sid revogado?
    const [revoked] = await db
      .select({ sid: revokedSessions.sid })
      .from(revokedSessions)
      .where(eq(revokedSessions.sid, user.sid))
      .limit(1)

    if (revoked) return { user: null as VianovaUser | null, rawToken: null as string | null }

    return { user: user as VianovaUser | null, rawToken: token as string | null }
  },
)

// Internal endpoints (Vianova service-to-service)
// Endpoints service-to-service do Vianova. Contrato definido em
// vianova/apps/api/src/lib/product-sync.ts — não alterar sem alinhar lá.
export const internalEndpoints = new Elysia({ name: 'internal' })
  // Single sign-out: Vianova envia { user_id, session_ids }. Insere cada sid
  // em revoked_sessions para invalidar as sessões Vianova do painel de gestão.
  .post(
    '/internal/session-revoked',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers.authorization, 'service:sessions:revoke')
      if (!ok) {
        set.status = 401
        return { message: 'Não autorizado.' }
      }
      try {
        for (const sid of body.session_ids) {
          await db.insert(revokedSessions).values({ sid }).onConflictDoNothing()
        }
        return { revoked: true as const }
      } catch (error) {
        console.error('[internal] session revocation failed:', error)
        set.status = 500
        return { message: 'Falha ao revogar sessões.' }
      }
    },
    {
      body: t.Object({
        user_id: t.String(),
        session_ids: t.Array(t.String()),
      }),
    },
  )
  // Sync de entitlements: Vianova envia { workspace_id, product_slug, tier,
  // status, limits }. limits vem do plano somado aos add-ons ativos (chaves
  // agents/connections/activeConversations/managersLimit); -1 = ilimitado
  // (Scale). managersLimit chega dentro de limits (prioridade); o campo
  // top-level é legado e opcional. Ausente = mantém o valor atual
  // (default 2 no insert).
  .post(
    '/internal/entitlements',
    async ({ headers, body, set }) => {
      const ok = await requireServiceScope(headers.authorization, 'service:entitlements:write')
      if (!ok) {
        set.status = 401
        return { message: 'Não autorizado.' }
      }

      const { workspace_id, tier, status, limits } = body
      const agentsLimit = limits.agents ?? 0
      const connectionsLimit = limits.connections ?? 0
      const activeConversationsLimit = limits.activeConversations ?? 0
      const managersLimit = limits.managersLimit ?? body.managersLimit

      try {
        await db
          .insert(entitlements)
          .values({
            workspaceId: workspace_id,
            plan: tier,
            status,
            agentsLimit,
            connectionsLimit,
            activeConversationsLimit,
            ...(managersLimit !== undefined ? { managersLimit } : {}),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: entitlements.workspaceId,
            set: {
              plan: tier,
              status,
              agentsLimit,
              connectionsLimit,
              activeConversationsLimit,
              ...(managersLimit !== undefined ? { managersLimit } : {}),
              updatedAt: new Date(),
            },
          })

        return { synced: true as const }
      } catch (error) {
        console.error('[internal] entitlements sync failed:', error)
        set.status = 500
        return { message: 'Falha ao sincronizar entitlements.' }
      }
    },
    {
      body: t.Object({
        workspace_id: t.String(),
        product_slug: t.String(),
        tier: t.String(),
        status: t.String(),
        limits: t.Record(t.String(), t.Number()),
        managersLimit: t.Optional(t.Number()),
      }),
    },
  )
