// Biblioteca de arquivos do inbox: upload direto do browser pro MinIO via URL
// pré-assinada (presign → PUT → confirm). A API nunca recebe os bytes; o
// session-host/worker puxa do MinIO na hora de enviar ao canal.

import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { files, messages } from '@crm/db/schema'
import { eq, and, desc, ilike, sql } from 'drizzle-orm'
import type { MediaKind } from '@crm/schemas'
import { presignUpload, presignDownload, objectExists, objectSize, deleteObject } from '@crm/storage'
import { authInboxPlugin } from '../plugins/auth-inbox'

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

export const inboxFilesRoutes = new Elysia({ name: 'inbox-files' })
  .use(authInboxPlugin)

  // POST /inbox/files/presign — registra o arquivo como 'pending' e devolve a
  // URL de upload. O browser faz PUT direto no MinIO e chama /confirm.
  .post(
    '/inbox/files/presign',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const kind = kindFromMime(body.mimeType)
      const limit = SIZE_LIMITS[kind]
      if (body.sizeBytes > limit) {
        set.status = 400
        return {
          message: `Arquivo excede o limite de ${Math.round(limit / 1024 / 1024)}MB para ${kind === 'image' ? 'imagens' : 'este tipo de arquivo'}.`,
        }
      }

      const fileId = crypto.randomUUID()
      const filename = safeFilename(body.filename)
      const storageKey = `${agent.workspaceId}/${fileId}/${filename}`

      await db.insert(files).values({
        id: fileId,
        workspaceId: agent.workspaceId,
        kind,
        filename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        storageKey,
        status: 'pending',
        uploadedByAgentId: agent.id,
      })

      return {
        fileId,
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

  // POST /inbox/files/:id/confirm — confirma que o PUT aconteceu: valida o
  // objeto no storage e marca 'ready' com o tamanho real.
  .post('/inbox/files/:id/confirm', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, params.id), eq(files.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!file) {
      set.status = 404
      return { message: 'Arquivo não encontrado.' }
    }

    if (!(await objectExists(file.storageKey))) {
      set.status = 400
      return { message: 'Upload não encontrado no storage — envie o arquivo antes de confirmar.' }
    }

    const size = await objectSize(file.storageKey)
    const [updated] = await db
      .update(files)
      .set({ status: 'ready', sizeBytes: size })
      .where(eq(files.id, file.id))
      .returning()

    return { file: updated }
  })

  // GET /inbox/files?kind=&search= — biblioteca do workspace (só 'ready').
  .get(
    '/inbox/files',
    async ({ agent, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const conditions = [eq(files.workspaceId, agent.workspaceId), eq(files.status, 'ready')]
      if (query.kind) {
        conditions.push(eq(files.kind, query.kind))
      }
      if (query.search) {
        conditions.push(ilike(files.filename, `%${query.search}%`))
      }

      const rows = await db
        .select()
        .from(files)
        .where(and(...conditions))
        .orderBy(desc(files.createdAt))
        .limit(200)

      return { files: rows }
    },
    {
      query: t.Object({
        kind: t.Optional(
          t.Union([t.Literal('image'), t.Literal('video'), t.Literal('audio'), t.Literal('document')]),
        ),
        search: t.Optional(t.String({ maxLength: 120 })),
      }),
    },
  )

  // GET /inbox/files/:id/url — URL pré-assinada de leitura (preview/download).
  .get('/inbox/files/:id/url', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, params.id), eq(files.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!file) {
      set.status = 404
      return { message: 'Arquivo não encontrado.' }
    }

    return { url: presignDownload(file.storageKey), mimeType: file.mimeType, kind: file.kind }
  })

  // GET /inbox/files/attachment-url?key= — URL pré-assinada por storageKey.
  // Usada para anexos de mensagens (inclusive inbound, que não têm row em files).
  // Segurança: a key precisa pertencer ao workspace do agente (prefixo `${workspaceId}/`).
  .get('/inbox/files/attachment-url', async ({ agent, query, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const key = query.key
    if (!key.startsWith(`${agent.workspaceId}/`) || key.includes('..')) {
      set.status = 403
      return { message: 'Chave inválida.' }
    }
    if (!(await objectExists(key))) {
      set.status = 404
      return { message: 'Arquivo não encontrado.' }
    }

    return { url: presignDownload(key) }
  }, {
    query: t.Object({ key: t.String({ minLength: 1, maxLength: 512 }) }),
  })

  // DELETE /inbox/files/:id — recusa (409) se o storageKey estiver referenciado
  // em algum messages.attachments do workspace; senão remove objeto + row.
  .delete('/inbox/files/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, params.id), eq(files.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!file) {
      set.status = 404
      return { message: 'Arquivo não encontrado.' }
    }

    // Checagem simples por texto no jsonb — suficiente porque storageKey é
    // único e inclui o fileId (colisão acidental é impossível).
    const [referenced] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(sql`${messages.attachments}::text ilike ${'%' + file.storageKey + '%'}`)
      .limit(1)
    if (referenced) {
      set.status = 409
      return { message: 'Este arquivo está anexado a mensagens e não pode ser excluído.' }
    }

    await deleteObject(file.storageKey).catch(() => {})
    await db.delete(files).where(eq(files.id, file.id))
    return { message: 'Arquivo excluído.' }
  })
