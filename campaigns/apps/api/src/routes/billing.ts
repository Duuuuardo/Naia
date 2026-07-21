import { Elysia } from 'elysia'
import { VIANOVA_API_URL, manageBillingUrl } from '@naia/vianova-auth'
import { authPlugin } from '../plugins/auth'

// Naia nunca integra Stripe — este arquivo só repassa o catálogo público do
// Vianova. O checkout em si (POST /billing/checkout) NÃO passa por aqui: o
// Vianova autentica essa rota pelo cookie de sessão dele (vianova_session),
// que o servidor do Naia nunca tem acesso — só o browser do usuário guarda
// esse cookie. Por isso o frontend chama o Vianova direto (cross-origin, com
// credentials), do jeito descrito em docs/architecture.md, seção "Portal de
// billing" — a única exceção documentada à regra de sempre passar pelo
// Eden Treaty do próprio Naia.
export const billingRoutes = new Elysia()
  .use(authPlugin)

  // GET /billing/plans — catálogo público de planos do Naia, espelhado do Vianova.
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

  // GET /billing/manage-url — "gerenciar assinatura" sempre redireciona ao Vianova.
  .get('/billing/manage-url', () => ({ url: manageBillingUrl() }))

  // GET /billing/subscription — proxy autenticado para a subscription atual do workspace.
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

  // POST /billing/checkout — proxy do checkout para o Vianova usando o JWT do usuário.
  // Evita a necessidade de SameSite=None no vianova_session cross-site.
  .post('/billing/checkout', async ({ body, set, session, rawToken }) => {
    if (!session) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    try {
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
  })
