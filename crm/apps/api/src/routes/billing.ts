import { Elysia, t } from 'elysia'
import { VIANOVA_API_URL, manageBillingUrl } from '@naia/vianova-auth'
import { db } from '@crm/db'
import { workspaces, workspaceManagers, entitlements } from '@crm/db/schema'
import { eq, and } from 'drizzle-orm'
import { authManagementPlugin } from '../plugins/auth-management'
import { requireEnv } from '../lib/env'

const VIANOVA_INTERNAL_SECRET = requireEnv('VIANOVA_INTERNAL_SECRET')

// CRM nunca integra Stripe. Estas rotas encaminham catálogo, checkout e add-ons
// ao Vianova com a identidade do usuário. Gestão de assinatura ativa continua
// no portal do Vianova.
export const billingRoutes = new Elysia({ name: 'billing' })
  .use(authManagementPlugin)

  // GET /billing/plans — catálogo de planos do CRM, espelhado do Vianova.
  .get('/billing/plans', async ({ set }) => {
    const res = await fetch(`${VIANOVA_API_URL}/products/naia-crm/plans`)
    if (!res.ok) {
      set.status = 502
      return { message: 'Não foi possível carregar os planos no momento.' }
    }
    return await res.json()
  })

  // GET /billing/manage-url — "gerenciar assinatura" sempre redireciona ao Vianova.
  .get('/billing/manage-url', () => ({ url: manageBillingUrl() }))

  // GET /billing/subscription — proxy autenticado para a subscription atual.
  .get('/billing/subscription', async ({ query, set, user, rawToken }) => {
    if (!user) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    const { workspace_id } = query as { workspace_id?: string }
    if (!workspace_id) {
      set.status = 400
      return { error: 'Missing workspace_id' }
    }
    try {
      const res = await fetch(
        `${VIANOVA_API_URL}/billing/subscription?product_slug=naia-crm&workspace_id=${workspace_id}`,
        { headers: { authorization: `Bearer ${rawToken}` } },
      )
      if (!res.ok) {
        set.status = res.status
        return { error: 'Failed to fetch subscription from Vianova' }
      }
      return await res.json()
    } catch {
      set.status = 500
      return { error: 'Internal server error' }
    }
  })

  // POST /billing/checkout — proxy do checkout para o Vianova com o JWT do usuário.
  .post(
    '/billing/checkout',
    async ({ body, set, user, rawToken }) => {
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }
      try {
        // Só o owner pode iniciar assinatura.
        const [manager] = await db
          .select({ role: workspaceManagers.role })
          .from(workspaceManagers)
          .where(
            and(
              eq(workspaceManagers.workspaceId, body.workspace_id),
              eq(workspaceManagers.vianovaUserId, user.userId),
            ),
          )
          .limit(1)

        if (!manager || manager.role !== 'owner') {
          set.status = 403
          return { message: 'Apenas o owner pode gerenciar a assinatura.' }
        }

        const [workspace] = await db
          .select({
            id: workspaces.id,
            name: workspaces.name,
            plan: entitlements.plan,
            status: entitlements.status,
          })
          .from(workspaces)
          .leftJoin(entitlements, eq(entitlements.workspaceId, workspaces.id))
          .where(eq(workspaces.id, body.workspace_id))
          .limit(1)

        if (!workspace) {
          set.status = 404
          return { message: 'Workspace não encontrado.' }
        }

        // Repara workspaces antigos: garante a subscription free no Vianova.
        const registration = await fetch(`${VIANOVA_API_URL}/internal/billing/ensure-free-subscription`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': VIANOVA_INTERNAL_SECRET,
          },
          body: JSON.stringify({
            product_slug: 'naia-crm',
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            owner_user_id: user.userId,
            free_eligible: workspace.plan === 'free' && workspace.status === 'active',
          }),
        })
        if (!registration.ok) {
          set.status = 502
          return { message: 'Não foi possível preparar este workspace para assinatura.' }
        }

        const res = await fetch(`${VIANOVA_API_URL}/billing/checkout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${rawToken}` },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          set.status = res.status
          return await res.json().catch(() => ({ error: 'Billing checkout failed' }))
        }
        return await res.json()
      } catch {
        set.status = 500
        return { error: 'Internal server error' }
      }
    },
    {
      body: t.Object({
        product_slug: t.Literal('naia-crm'),
        workspace_id: t.String(),
        workspace_name: t.Optional(t.String()),
        plan_id: t.String(),
        success_url: t.Optional(t.String()),
        cancel_url: t.Optional(t.String()),
      }),
    },
  )

  // Add-ons: compra e mudança de quantidade dentro do produto.
  .post(
    '/billing/subscriptions/:id/addons',
    async ({ params, body, set, user, rawToken }) => {
      if (!user) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      const res = await fetch(`${VIANOVA_API_URL}/billing/subscriptions/${encodeURIComponent(params.id)}/addons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rawToken}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        set.status = res.status
        return res.json().catch(() => ({ message: 'Erro ao adicionar add-on.' }))
      }
      return res.json()
    },
    {
      body: t.Object({ addon_type_id: t.String(), quantity: t.Number({ minimum: 0 }) }),
    },
  )

  .patch(
    '/billing/subscriptions/:id/addons/:addonTypeId',
    async ({ params, body, set, user, rawToken }) => {
      if (!user) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      const res = await fetch(
        `${VIANOVA_API_URL}/billing/subscriptions/${encodeURIComponent(params.id)}/addons/${encodeURIComponent(params.addonTypeId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${rawToken}` },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        set.status = res.status
        return res.json().catch(() => ({ message: 'Erro ao atualizar add-on.' }))
      }
      return res.json()
    },
    {
      body: t.Object({ quantity: t.Number({ minimum: 0 }) }),
    },
  )
