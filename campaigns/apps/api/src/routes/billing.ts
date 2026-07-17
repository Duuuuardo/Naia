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
              messagesPerMonth: 3,
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
