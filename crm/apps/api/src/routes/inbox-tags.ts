import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { contacts, contactTags, conversations, conversationTags, tags } from '@crm/db/schema'
import { eq, and, asc, count } from 'drizzle-orm'
import { authInboxPlugin, type InboxAgent } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'

// Gestão de tags (criar/editar/excluir) é a área 'labels' das permissões de
// agente: não há helper de override por workspace na API, então o guard é
// por papel — admin ou superadmin. Vincular tags a contatos/conversas é
// livre para qualquer agente.
function canManageTags(agent: InboxAgent): boolean {
  return agent.role === 'admin' || agent.role === 'superadmin'
}

export const inboxTagsRoutes = new Elysia({ name: 'inbox-tags' })
  .use(authInboxPlugin)

  // GET /inbox/tags — todas do workspace, com contagem de contatos e conversas.
  .get('/inbox/tags', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const rows = await db
      .select()
      .from(tags)
      .where(eq(tags.workspaceId, agent.workspaceId))
      .orderBy(asc(tags.name))

    // contact_tags/conversation_tags não têm workspaceId — o escopo sai do
    // join com tags.
    const contactCounts = await db
      .select({ tagId: contactTags.tagId, count: count() })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(eq(tags.workspaceId, agent.workspaceId))
      .groupBy(contactTags.tagId)
    const conversationCounts = await db
      .select({ tagId: conversationTags.tagId, count: count() })
      .from(conversationTags)
      .innerJoin(tags, eq(conversationTags.tagId, tags.id))
      .where(eq(tags.workspaceId, agent.workspaceId))
      .groupBy(conversationTags.tagId)

    const contactsByTag = new Map(contactCounts.map((r) => [r.tagId, r.count]))
    const conversationsByTag = new Map(conversationCounts.map((r) => [r.tagId, r.count]))

    return {
      tags: rows.map((tag) => ({
        ...tag,
        contactCount: contactsByTag.get(tag.id) ?? 0,
        conversationCount: conversationsByTag.get(tag.id) ?? 0,
      })),
    }
  })

  // POST /inbox/tags — cria tag. Nome é único por workspace (409 em conflito).
  .post(
    '/inbox/tags',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!canManageTags(agent)) {
        set.status = 403
        return { message: 'Apenas admins podem gerenciar tags.' }
      }

      const [conflict] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.workspaceId, agent.workspaceId), eq(tags.name, body.name)))
        .limit(1)
      if (conflict) {
        set.status = 409
        return { message: `Já existe uma tag com o nome "${body.name}".` }
      }

      const [tag] = await db
        .insert(tags)
        .values({ id: generateId(), workspaceId: agent.workspaceId, name: body.name, color: body.color })
        .returning()

      set.status = 201
      return { tag: { ...tag, contactCount: 0, conversationCount: 0 } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 40 }),
        color: t.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
      }),
    },
  )

  // PATCH /inbox/tags/:id — atualiza nome/cor.
  .patch(
    '/inbox/tags/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!canManageTags(agent)) {
        set.status = 403
        return { message: 'Apenas admins podem gerenciar tags.' }
      }

      const [existing] = await db
        .select()
        .from(tags)
        .where(and(eq(tags.id, params.id), eq(tags.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Tag não encontrada.' }
      }

      if (body.name !== undefined && body.name !== existing.name) {
        const [conflict] = await db
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.workspaceId, agent.workspaceId), eq(tags.name, body.name)))
          .limit(1)
        if (conflict) {
          set.status = 409
          return { message: `Já existe uma tag com o nome "${body.name}".` }
        }
      }

      const [tag] = await db
        .update(tags)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
        })
        .where(eq(tags.id, params.id))
        .returning()

      return { tag }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 40 })),
        color: t.Optional(t.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
      }),
    },
  )

  // DELETE /inbox/tags/:id — vínculos caem em cascade (contact_tags e
  // conversation_tags têm onDelete: cascade no tagId).
  .delete('/inbox/tags/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!canManageTags(agent)) {
      set.status = 403
      return { message: 'Apenas admins podem gerenciar tags.' }
    }

    const [existing] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.id, params.id), eq(tags.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!existing) {
      set.status = 404
      return { message: 'Tag não encontrada.' }
    }

    await db.delete(tags).where(eq(tags.id, params.id))
    return { deleted: true as const }
  })

  // PUT /inbox/contacts/:id/tags — substitui as tags do contato.
  // Qualquer agente pode vincular/desvincular.
  .put(
    '/inbox/contacts/:id/tags',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [contact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, params.id), eq(contacts.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!contact) {
        set.status = 404
        return { message: 'Contato não encontrado.' }
      }

      // Só aceita tags do próprio workspace.
      const validTags = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.workspaceId, agent.workspaceId))
      const validIds = new Set(validTags.map((t) => t.id))
      const tagIds = [...new Set(body.tagIds)].filter((id) => validIds.has(id))

      await db.delete(contactTags).where(eq(contactTags.contactId, params.id))
      if (tagIds.length > 0) {
        await db.insert(contactTags).values(tagIds.map((tagId) => ({ contactId: params.id, tagId })))
      }

      return { contactId: params.id, tagIds }
    },
    {
      body: t.Object({
        tagIds: t.Array(t.String(), { maxItems: 50 }),
      }),
    },
  )

  // PUT /inbox/conversations/:id/tags — substitui as tags da conversa.
  .put(
    '/inbox/conversations/:id/tags',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, params.id), eq(conversations.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!conversation) {
        set.status = 404
        return { message: 'Conversa não encontrada.' }
      }

      const validTags = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.workspaceId, agent.workspaceId))
      const validIds = new Set(validTags.map((t) => t.id))
      const tagIds = [...new Set(body.tagIds)].filter((id) => validIds.has(id))

      await db.delete(conversationTags).where(eq(conversationTags.conversationId, params.id))
      if (tagIds.length > 0) {
        await db
          .insert(conversationTags)
          .values(tagIds.map((tagId) => ({ conversationId: params.id, tagId })))
      }

      return { conversationId: params.id, tagIds }
    },
    {
      body: t.Object({
        tagIds: t.Array(t.String(), { maxItems: 50 }),
      }),
    },
  )
