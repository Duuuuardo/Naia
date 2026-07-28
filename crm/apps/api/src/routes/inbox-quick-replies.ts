import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { files, quickReplies, type QuickReply } from '@crm/db/schema'
import { eq, and, or, ilike, asc, inArray } from 'drizzle-orm'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { isSuperadmin } from '../lib/superadmin'

// Anexo de resposta rápida já resolvido (o que o composer precisa para virar
// anexo da mensagem). Espelha ComposerAttachment do web.
type ResolvedAttachment = {
  fileId: string
  filename: string
  kind: 'image' | 'video' | 'audio' | 'document'
  storageKey: string
}

// Normaliza o atalho: sem '/' inicial, minúsculo, sem espaços nas pontas.
// O composer dispara por "/saudacao"; no banco fica só "saudacao".
function normalizeShortcut(shortcut: string): string {
  return shortcut.trim().replace(/^\/+/, '').toLowerCase()
}

// Valida ids de arquivo do body: precisam existir, estar prontos e ser do mesmo
// workspace. Retorna os ids válidos na ordem enviada (ignora duplicatas), ou
// null se algum id for inválido (para o handler responder 400).
async function validateAttachmentFileIds(
  workspaceId: string,
  fileIds: string[],
): Promise<string[] | null> {
  const unique = [...new Set(fileIds)]
  if (unique.length === 0) return []
  const found = await db
    .select({ id: files.id, status: files.status })
    .from(files)
    .where(and(inArray(files.id, unique), eq(files.workspaceId, workspaceId)))
  if (found.length !== unique.length || found.some((f) => f.status !== 'ready')) return null
  return unique
}

// Resolve os attachmentFileIds de várias respostas em um único query. Arquivos
// que já não existem/não estão prontos somem silenciosamente (a resposta
// continua utilizável só com o texto).
async function resolveAttachments(
  workspaceId: string,
  rows: QuickReply[],
): Promise<Map<string, ResolvedAttachment[]>> {
  const allIds = [...new Set(rows.flatMap((r) => r.attachmentFileIds))]
  const byId = new Map<string, ResolvedAttachment>()
  if (allIds.length > 0) {
    const found = await db
      .select()
      .from(files)
      .where(and(inArray(files.id, allIds), eq(files.workspaceId, workspaceId), eq(files.status, 'ready')))
    for (const f of found) {
      byId.set(f.id, { fileId: f.id, filename: f.filename, kind: f.kind, storageKey: f.storageKey })
    }
  }
  const result = new Map<string, ResolvedAttachment[]>()
  for (const r of rows) {
    result.set(
      r.id,
      r.attachmentFileIds.map((id) => byId.get(id)).filter((a): a is ResolvedAttachment => a !== undefined),
    )
  }
  return result
}

export const inboxQuickRepliesRoutes = new Elysia({ name: 'inbox-quick-replies' })
  .use(authInboxPlugin)

  // GET /inbox/quick-replies — lista do workspace, com busca opcional em
  // atalho, título e conteúdo.
  .get(
    '/inbox/quick-replies',
    async ({ agent, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const conditions = [eq(quickReplies.workspaceId, agent.workspaceId)]
      if (query.search) {
        const term = `%${query.search}%`
        conditions.push(
          or(
            ilike(quickReplies.shortcut, term),
            ilike(quickReplies.title, term),
            ilike(quickReplies.content, term),
          )!,
        )
      }

      const rows = await db
        .select()
        .from(quickReplies)
        .where(and(...conditions))
        .orderBy(asc(quickReplies.shortcut))
        .limit(200)

      const attachmentsById = await resolveAttachments(agent.workspaceId, rows)
      return { quickReplies: rows.map((r) => ({ ...r, attachments: attachmentsById.get(r.id) ?? [] })) }
    },
    {
      query: t.Object({ search: t.Optional(t.String()) }),
    },
  )

  // POST /inbox/quick-replies — qualquer agente cria. Atalho é único por
  // workspace (409 em conflito).
  .post(
    '/inbox/quick-replies',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const shortcut = normalizeShortcut(body.shortcut)
      if (!shortcut) {
        set.status = 400
        return { message: 'Atalho inválido.' }
      }

      const [conflict] = await db
        .select({ id: quickReplies.id })
        .from(quickReplies)
        .where(and(eq(quickReplies.workspaceId, agent.workspaceId), eq(quickReplies.shortcut, shortcut)))
        .limit(1)
      if (conflict) {
        set.status = 409
        return { message: `Já existe uma resposta rápida com o atalho /${shortcut}.` }
      }

      const attachmentFileIds = await validateAttachmentFileIds(agent.workspaceId, body.attachmentFileIds ?? [])
      if (attachmentFileIds === null) {
        set.status = 400
        return { message: 'Anexo inválido: arquivo não encontrado ou upload não confirmado.' }
      }

      const [quickReply] = await db
        .insert(quickReplies)
        .values({
          id: generateId(),
          workspaceId: agent.workspaceId,
          shortcut,
          title: body.title,
          content: body.content,
          attachmentFileIds,
          createdByAgentId: agent.id,
        })
        .returning()

      const attachmentsById = await resolveAttachments(agent.workspaceId, [quickReply])
      set.status = 201
      return { quickReply: { ...quickReply, attachments: attachmentsById.get(quickReply.id) ?? [] } }
    },
    {
      body: t.Object({
        shortcut: t.String({ minLength: 1, maxLength: 50 }),
        title: t.String({ minLength: 1, maxLength: 100 }),
        content: t.String({ minLength: 1, maxLength: 4000 }),
        attachmentFileIds: t.Optional(t.Array(t.String(), { maxItems: 10 })),
      }),
    },
  )

  // PATCH /inbox/quick-replies/:id — dono ou superadmin edita.
  .patch(
    '/inbox/quick-replies/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [existing] = await db
        .select()
        .from(quickReplies)
        .where(and(eq(quickReplies.id, params.id), eq(quickReplies.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Resposta rápida não encontrada.' }
      }
      if (existing.createdByAgentId !== agent.id && !isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas o dono ou um superadmin pode editar esta resposta rápida.' }
      }

      let shortcut: string | undefined
      if (body.shortcut !== undefined) {
        shortcut = normalizeShortcut(body.shortcut)
        if (!shortcut) {
          set.status = 400
          return { message: 'Atalho inválido.' }
        }
        if (shortcut !== existing.shortcut) {
          const [conflict] = await db
            .select({ id: quickReplies.id })
            .from(quickReplies)
            .where(and(eq(quickReplies.workspaceId, agent.workspaceId), eq(quickReplies.shortcut, shortcut)))
            .limit(1)
          if (conflict) {
            set.status = 409
            return { message: `Já existe uma resposta rápida com o atalho /${shortcut}.` }
          }
        }
      }

      let attachmentFileIds: string[] | undefined
      if (body.attachmentFileIds !== undefined) {
        const validated = await validateAttachmentFileIds(agent.workspaceId, body.attachmentFileIds)
        if (validated === null) {
          set.status = 400
          return { message: 'Anexo inválido: arquivo não encontrado ou upload não confirmado.' }
        }
        attachmentFileIds = validated
      }

      const [quickReply] = await db
        .update(quickReplies)
        .set({
          ...(shortcut !== undefined ? { shortcut } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(attachmentFileIds !== undefined ? { attachmentFileIds } : {}),
        })
        .where(eq(quickReplies.id, params.id))
        .returning()

      const attachmentsById = await resolveAttachments(agent.workspaceId, [quickReply])
      return { quickReply: { ...quickReply, attachments: attachmentsById.get(quickReply.id) ?? [] } }
    },
    {
      body: t.Object({
        shortcut: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
        title: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        content: t.Optional(t.String({ minLength: 1, maxLength: 4000 })),
        attachmentFileIds: t.Optional(t.Array(t.String(), { maxItems: 10 })),
      }),
    },
  )

  // DELETE /inbox/quick-replies/:id — dono ou superadmin exclui.
  .delete('/inbox/quick-replies/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [existing] = await db
      .select({ id: quickReplies.id, createdByAgentId: quickReplies.createdByAgentId })
      .from(quickReplies)
      .where(and(eq(quickReplies.id, params.id), eq(quickReplies.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!existing) {
      set.status = 404
      return { message: 'Resposta rápida não encontrada.' }
    }
    if (existing.createdByAgentId !== agent.id && !isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas o dono ou um superadmin pode excluir esta resposta rápida.' }
    }

    await db.delete(quickReplies).where(eq(quickReplies.id, params.id))
    return { deleted: true as const }
  })
