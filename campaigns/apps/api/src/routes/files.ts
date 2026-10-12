import { Elysia, t } from 'elysia'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { getRequiredEnv } from '../lib/env'

const VIANOVA_API_URL = getRequiredEnv('VIANOVA_API_URL')
const VIANOVA_INTERNAL_SECRET = getRequiredEnv('VIANOVA_INTERNAL_SECRET')

const PRODUCT_SLUG = 'naia'

async function vianovaFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${VIANOVA_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'x-internal-secret': VIANOVA_INTERNAL_SECRET,
    },
  })
}

export const filesRoutes = new Elysia()
  .use(authPlugin)

  .post(
    '/workspaces/:workspaceId/files/upload',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!ctx.permissions.files) {
        set.status = 403
        return { message: 'Você não tem permissão para enviar arquivos neste workspace.' }
      }

      const file: File = body.file
      console.log('[naia:files:upload] received file', { name: file.name, size: file.size, type: file.type, workspaceId: params.workspaceId })

      const form = new FormData()
      form.append('file', file)
      form.append('product_slug', PRODUCT_SLUG)
      form.append('workspace_id', params.workspaceId)
      form.append('owner_user_id', ctx.userId)

      const res = await vianovaFetch('/internal/files/upload', {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => 'Erro ao enviar arquivo para o Vianova Storage.')
        console.error('[naia:files:upload] vianova error', { status: res.status, body: text })
        const data = (() => {
          try { return JSON.parse(text) } catch { return { message: text } }
        })()
        set.status = res.status === 402 ? 402 : 502
        return { message: data.message ?? 'Erro ao enviar arquivo.' }
      }

      return res.json()
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    },
  )

  .get(
    '/workspaces/:workspaceId/files',
    async ({ session, params, query, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!ctx.permissions.files) {
        set.status = 403
        return { message: 'Você não tem permissão para ver arquivos neste workspace.' }
      }

      const search = new URLSearchParams({
        product_slug: PRODUCT_SLUG,
        workspace_id: params.workspaceId,
        status: query.status ?? 'active',
        limit: String(query.limit ?? 50),
      })
      if (query.cursor) search.set('cursor', query.cursor)
      if (query.ownerUserId) search.set('owner_user_id', query.ownerUserId)

      const res = await vianovaFetch(`/internal/files?${search.toString()}`, { method: 'GET' })
      if (!res.ok) {
        set.status = 502
        return { message: 'Erro ao listar arquivos.' }
      }
      return res.json()
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        limit: t.Optional(t.Number()),
        cursor: t.Optional(t.String()),
        ownerUserId: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/workspaces/:workspaceId/files/usage',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!ctx.permissions.files) {
        set.status = 403
        return { message: 'Você não tem permissão para ver arquivos neste workspace.' }
      }

      const res = await vianovaFetch(
        `/internal/files/usage?product_slug=${PRODUCT_SLUG}&workspace_id=${encodeURIComponent(params.workspaceId)}`,
        { method: 'GET' },
      )
      if (!res.ok) {
        set.status = 502
        return { message: 'Erro ao consultar uso de storage.' }
      }
      return res.json()
    },
  )

  .delete(
    '/workspaces/:workspaceId/files/:fileId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!ctx.permissions.files) {
        set.status = 403
        return { message: 'Você não tem permissão para remover arquivos neste workspace.' }
      }

      const deleteQuery = new URLSearchParams({ product_slug: PRODUCT_SLUG, workspace_id: params.workspaceId })
      const res = await vianovaFetch(`/internal/files/${encodeURIComponent(params.fileId)}?${deleteQuery.toString()}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        set.status = 502
        return { message: 'Erro ao remover arquivo.' }
      }
      return res.json()
    },
    {
      params: t.Object({
        workspaceId: t.String(),
        fileId: t.String(),
      }),
    },
  )

  .post(
    '/workspaces/:workspaceId/files/:fileId/restore',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!ctx.permissions.files) {
        set.status = 403
        return { message: 'Você não tem permissão para restaurar arquivos neste workspace.' }
      }

      const restoreQuery = new URLSearchParams({ product_slug: PRODUCT_SLUG, workspace_id: params.workspaceId })
      const res = await vianovaFetch(`/internal/files/${encodeURIComponent(params.fileId)}/restore?${restoreQuery.toString()}`, {
        method: 'POST',
      })
      if (!res.ok) {
        set.status = 502
        return { message: 'Erro ao restaurar arquivo.' }
      }
      return res.json()
    },
    {
      params: t.Object({
        workspaceId: t.String(),
        fileId: t.String(),
      }),
    },
  )
