import { Elysia, t } from 'elysia'
import { VIANOVA_API_URL, manageBillingUrl } from '@naia/vianova-auth'
import { db, entitlements, workspaces } from '@naia/db'
import { eq } from 'drizzle-orm'
import { authPlugin } from '../plugins/auth'
import { getRequiredEnv } from '../lib/env'

const VIANOVA_INTERNAL_SECRET = getRequiredEnv('VIANOVA_INTERNAL_SECRET')

export const billingRoutes = new Elysia()
  .use(authPlugin)

  .get('/billing/plans', async ({ set }) => {
    const res = await fetch(`${VIANOVA_API_URL}/products/naia/plans`)
    if (!res.ok) {
      set.status = 502
      return { message: 'Não foi possível carregar os planos no momento.' }
    }
    const data = (await res.json()) as {
      product: { slug: string; name: string; domain: string; description: string | null; icon: string | null; webUrl: string }
      plans: {
        id: string
        tier: string
        name: string
        description: string | null
        priceCents: number
        limits: Record<string, number>
        sortOrder: number
      }[]
      addons: {
        id: string
        key: string
        name: string
        description: string | null
        unitLabel: string | null
        priceCents: number
        limitsPerUnit: Record<string, number>
      }[]
    }

    if (data?.plans) {
      data.plans = data.plans.map((p) => {
        if (p.tier === 'free') {
          return {
            ...p,
            limits: {
              ...p.limits,
              creditsPerCycle: 3,
              campaignsPerMonth: 1,
            },
          }
        }
        return p
      })
    }

    return data
  })

  .get('/billing/manage-url', () => ({ url: manageBillingUrl() }))

  .get('/billing/subscription', async ({ query, set, session, rawToken }) => {
    if (!session) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    const { product_slug, workspace_id } = query as { product_slug?: string; workspace_id?: string }
    if (!product_slug || !workspace_id) {
      set.status = 400
      return { error: 'Missing required query parameters' }
    }
    try {
      const res = await fetch(`${VIANOVA_API_URL}/billing/subscription?product_slug=${product_slug}&workspace_id=${workspace_id}`, {
        headers: { authorization: `Bearer ${rawToken}` },
      })
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

  .post('/billing/checkout', async ({ body, set, session, rawToken }) => {
    if (!session) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    try {
      const [workspace] = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          ownerUserId: workspaces.ownerUserId,
          organizationId: workspaces.organizationId,
          entitlementTier: entitlements.tier,
          entitlementStatus: entitlements.status,
        })
        .from(workspaces)
        .leftJoin(entitlements, eq(entitlements.workspaceId, workspaces.id))
        .where(eq(workspaces.id, body.workspace_id))
        .limit(1)

      if (!workspace || workspace.ownerUserId !== session.userId) {
        set.status = 404
        return { message: 'Workspace não encontrado ou sem acesso para assinatura.' }
      }

      const registration = await fetch(`${VIANOVA_API_URL}/internal/billing/ensure-free-subscription`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': VIANOVA_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          product_slug: 'naia',
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          owner_user_id: workspace.ownerUserId,
          organization_id: workspace.organizationId,
          free_eligible:
            workspace.entitlementTier === 'free' && workspace.entitlementStatus === 'active',
        }),
      })
      if (!registration.ok) {
        set.status = 502
        return { message: 'Não foi possível preparar este workspace para assinatura.' }
      }

      const res = await fetch(`${VIANOVA_API_URL}/billing/checkout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${rawToken}`,
        },
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
  }, {
    body: t.Object({
      product_slug: t.Literal('naia'),
      workspace_id: t.String(),
      workspace_name: t.Optional(t.String()),
      plan_id: t.String(),
      success_url: t.Optional(t.String()),
      cancel_url: t.Optional(t.String()),
      organization_id: t.Optional(t.String()),
    }),
  })

  .post('/billing/subscriptions/:id/addons', async ({ params, body, set, session, rawToken }) => {
    if (!session) { set.status = 401; return { message: 'Não autenticado.' } }
    const res = await fetch(`${VIANOVA_API_URL}/billing/subscriptions/${encodeURIComponent(params.id)}/addons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${rawToken}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) { set.status = res.status; return res.json().catch(() => ({ message: 'Erro ao adicionar add-on.' })) }
    return res.json()
  }, {
    body: t.Object({ addon_type_id: t.String(), quantity: t.Number({ minimum: 0 }) }),
  })

  .patch('/billing/subscriptions/:id/addons/:addonTypeId', async ({ params, body, set, session, rawToken }) => {
    if (!session) { set.status = 401; return { message: 'Não autenticado.' } }
    const res = await fetch(
      `${VIANOVA_API_URL}/billing/subscriptions/${encodeURIComponent(params.id)}/addons/${encodeURIComponent(params.addonTypeId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rawToken}` },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) { set.status = res.status; return res.json().catch(() => ({ message: 'Erro ao atualizar add-on.' })) }
    return res.json()
  }, {
    body: t.Object({ quantity: t.Number({ minimum: 0 }) }),
  })
