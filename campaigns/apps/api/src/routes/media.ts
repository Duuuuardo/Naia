
import { Elysia, t } from 'elysia'
import { db, mediaAssets, campaignVariantMedia } from '@naia/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { MediaKind } from '@naia/schemas'
import { presignUpload, presignDownload, objectExists, objectSize, deleteObject } from '@naia/storage'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'

const SIZE_LIMITS: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  document: 50 * 1024 * 1024,
}

function kindFromMime(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'arquivo'
}

export const mediaRoutes = new Elysia()
  .use(authPlugin)

  .post(
    '/workspaces/:workspaceId/media/presign',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const kind = kindFromMime(body.mimeType)
      const limit = SIZE_LIMITS[kind]
      if (body.sizeBytes > limit) {
        set.status = 400
        return { message: `Arquivo excede o limite de ${Math.round(limit / 1024 / 1024)}MB para ${kind === 'image' ? 'imagens' : 'este tipo de mídia'}.` }
      }

      const assetId = generateId()
      const filename = safeFilename(body.filename)
      const storageKey = `${params.workspaceId}/${assetId}/${filename}`

      await db.insert(mediaAssets).values({
        id: assetId,
        workspaceId: params.workspaceId,
        kind,
        filename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        storageKey,
        status: 'pending',
      })

      return {
        assetId,
        kind,
        storageKey,
        uploadUrl: presignUpload(storageKey, body.mimeType),
      }
    },
    {
      body: t.Object({
        filename: t.String({ minLength: 1 }),
        mimeType: t.String({ minLength: 1 }),
        sizeBytes: t.Integer({ minimum: 1 }),
      }),
    },
  )

  .post(
    '/workspaces/:workspaceId/media/:assetId/confirm',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [asset] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, params.assetId), eq(mediaAssets.workspaceId, params.workspaceId)))
        .limit(1)
      if (!asset) { set.status = 404; return { message: 'Mídia não encontrada.' } }

      if (!(await objectExists(asset.storageKey))) {
        set.status = 400
        return { message: 'Upload não encontrado no storage — envie o arquivo antes de confirmar.' }
      }

      const size = await objectSize(asset.storageKey)
      const limit = SIZE_LIMITS[asset.kind]
      if (size > limit) {
        await deleteObject(asset.storageKey).catch(() => {})
        set.status = 400
        return { message: `Arquivo excede o limite de ${Math.round(limit / 1024 / 1024)}MB para ${asset.kind === 'image' ? 'imagens' : 'este tipo de mídia'}.` }
      }
      await db.update(mediaAssets).set({ status: 'ready', sizeBytes: size }).where(eq(mediaAssets.id, asset.id))

      const [updated] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id)).limit(1)
      return { asset: updated }
    },
  )

  .get(
    '/workspaces/:workspaceId/media',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const assets = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.workspaceId, params.workspaceId), eq(mediaAssets.status, 'ready')))
        .orderBy(desc(mediaAssets.createdAt))
        .limit(200)

      return { assets }
    },
  )

  .get(
    '/workspaces/:workspaceId/media/:assetId/url',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [asset] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, params.assetId), eq(mediaAssets.workspaceId, params.workspaceId)))
        .limit(1)
      if (!asset) { set.status = 404; return { message: 'Mídia não encontrada.' } }

      return { url: presignDownload(asset.storageKey), mimeType: asset.mimeType, kind: asset.kind }
    },
  )

  .delete(
    '/workspaces/:workspaceId/media/:assetId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.campaigns) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [asset] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, params.assetId), eq(mediaAssets.workspaceId, params.workspaceId)))
        .limit(1)
      if (!asset) { set.status = 404; return { message: 'Mídia não encontrada.' } }

      const [refs] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaignVariantMedia)
        .where(eq(campaignVariantMedia.mediaAssetId, asset.id))
      if ((refs?.count ?? 0) > 0) {
        set.status = 400
        return { message: 'Esta mídia está anexada a uma campanha — remova o anexo antes de excluí-la.' }
      }

      await deleteObject(asset.storageKey).catch(() => {})
      await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id))
      return { message: 'Mídia excluída.' }
    },
  )
