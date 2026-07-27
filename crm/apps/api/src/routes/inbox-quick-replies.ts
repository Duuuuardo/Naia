import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { quickReplies } from '@crm/db/schema'
import { eq, and, or, ilike, asc } from 'drizzle-orm'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { isSuperadmin } from '../lib/superadmin'

// Normaliza o atalho: sem '/' inicial, minúsculo, sem espaços nas pontas.
// O composer dispara por "/saudacao"; no banco fica só "saudacao".
function normalizeShortcut(shortcut: string): string {
  return shortcut.trim().replace(/^\/+/, '').toLowerCase()
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

      return { quickReplies: rows }
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

      const [quickReply] = await db
        .insert(quickReplies)
        .values({
          id: generateId(),
          workspaceId: agent.workspaceId,
          shortcut,
          title: body.title,
          content: body.content,
          createdByAgentId: agent.id,
        })
        .returning()

      set.status = 201
      return { quickReply }
    },
    {
      body: t.Object({
        shortcut: t.String({ minLength: 1, maxLength: 50 }),
        title: t.String({ minLength: 1, maxLength: 100 }),
        content: t.String({ minLength: 1, maxLength: 4000 }),
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

      const [quickReply] = await db
        .update(quickReplies)
        .set({
          ...(shortcut !== undefined ? { shortcut } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
        })
        .where(eq(quickReplies.id, params.id))
        .returning()

      return { quickReply }
    },
    {
      body: t.Object({
        shortcut: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
        title: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        content: t.Optional(t.String({ minLength: 1, maxLength: 4000 })),
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
