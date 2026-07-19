import { Elysia, t } from 'elysia'
import { authPlugin } from '../plugins/auth'

const VIANOVA_API_URL = () => process.env.VIANOVA_API_URL ?? 'http://localhost:5000'

async function vianovaFetch(path: string, rawToken: string, init?: RequestInit) {
  const url = `${VIANOVA_API_URL()}${path}`
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${rawToken}`,
      'content-type': 'application/json',
    },
  })
}

export const notificationRoutes = new Elysia()
  .use(authPlugin)

  // Proxy para a central de notificações do Vianova. O Naia web consome essas
  // rotas via Eden Treaty; a API repassa a requisição usando o JWT do usuário
  // como cookie de sessão do Vianova.
  .get(
    '/notifications',
    async ({ session, rawToken, query, set }) => {
      if (!session || !rawToken) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const page = query.page ?? 1
      const productSlug = query.product_slug
      const queryString = productSlug ? `?page=${page}&product_slug=${encodeURIComponent(productSlug)}` : `?page=${page}`
      const res = await vianovaFetch(`/notifications${queryString}`, rawToken)
      if (!res.ok) {
        set.status = res.status
        return { message: 'Erro ao buscar notificações.' }
      }
      return res.json()
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        product_slug: t.Optional(t.String()),
      }),
    },
  )

  .get('/notifications/unread-count', async ({ session, rawToken, set }) => {
    if (!session || !rawToken) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const res = await vianovaFetch('/notifications/unread-count', rawToken)
    if (!res.ok) {
      set.status = res.status
      return { message: 'Erro ao buscar notificações.' }
    }
    return res.json()
  })

  .post(
    '/notifications/:id/read',
    async ({ session, rawToken, params, set }) => {
      if (!session || !rawToken) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const res = await vianovaFetch(`/notifications/${params.id}/read`, rawToken, { method: 'POST' })
      if (!res.ok) {
        set.status = res.status
        return { message: 'Erro ao marcar notificação.' }
      }
      return res.json()
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  .post('/notifications/read-all', async ({ session, rawToken, set }) => {
    if (!session || !rawToken) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const res = await vianovaFetch('/notifications/read-all', rawToken, { method: 'POST' })
    if (!res.ok) {
      set.status = res.status
      return { message: 'Erro ao marcar notificações.' }
    }
    return res.json()
  })
