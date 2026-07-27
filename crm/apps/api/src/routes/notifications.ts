import { Elysia, t } from 'elysia'
import { authManagementPlugin } from '../plugins/auth-management'
import { requireEnv } from '../lib/env'

const VIANOVA_API_URL = requireEnv('VIANOVA_API_URL')

function vianovaFetch(path: string, rawToken: string, init?: RequestInit) {
  return fetch(`${VIANOVA_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${rawToken}`,
      'content-type': 'application/json',
    },
  })
}

export const notificationRoutes = new Elysia()
  .use(authManagementPlugin)
  .get(
    '/notifications',
    async ({ user, rawToken, query, set }) => {
      if (!user || !rawToken) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const page = query.page ?? 1
      const productSlug = query.product_slug
      const queryString = productSlug
        ? `?page=${page}&product_slug=${encodeURIComponent(productSlug)}`
        : `?page=${page}`
      const response = await vianovaFetch(`/notifications${queryString}`, rawToken)

      if (!response.ok) {
        set.status = response.status
        return { message: 'Erro ao buscar notificações.' }
      }

      return response.json()
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        product_slug: t.Optional(t.String()),
      }),
    },
  )
  .get('/notifications/unread-count', async ({ user, rawToken, set }) => {
    if (!user || !rawToken) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const response = await vianovaFetch('/notifications/unread-count', rawToken)
    if (!response.ok) {
      set.status = response.status
      return { message: 'Erro ao buscar notificações.' }
    }

    return response.json()
  })
  .post(
    '/notifications/:id/read',
    async ({ user, rawToken, params, set }) => {
      if (!user || !rawToken) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const response = await vianovaFetch(`/notifications/${params.id}/read`, rawToken, { method: 'POST' })
      if (!response.ok) {
        set.status = response.status
        return { message: 'Erro ao marcar notificação.' }
      }

      return response.json()
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post('/notifications/read-all', async ({ user, rawToken, set }) => {
    if (!user || !rawToken) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const response = await vianovaFetch('/notifications/read-all', rawToken, { method: 'POST' })
    if (!response.ok) {
      set.status = response.status
      return { message: 'Erro ao marcar notificações.' }
    }

    return response.json()
  })
