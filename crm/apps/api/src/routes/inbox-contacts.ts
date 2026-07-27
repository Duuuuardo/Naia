import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import {
  contacts,
  contactIdentities,
  contactTags,
  conversations,
  connections,
  messages,
  deals,
  pipelines,
  pipelineStages,
  agents,
  queues,
  tags,
  conversationTransfers,
} from '@crm/db/schema'
import { eq, and, or, ilike, desc, count, inArray, sql } from 'drizzle-orm'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { isSuperadmin } from '../lib/superadmin'

// Handle de query que aceita tanto o db global quanto uma transaction.
type DbHandle = Pick<typeof db, 'select' | 'insert' | 'delete'>

// Cor default de tags criadas automaticamente a partir de nomes.
const DEFAULT_TAG_COLOR = '#DD5973'

// Resolve os ids das tags pelos nomes no workspace, criando as que não existem.
// Exportado para reuso na importação de contatos via CSV (inbox-contacts-csv).
export async function resolveTagIds(tx: DbHandle, workspaceId: string, names: string[]): Promise<string[]> {
  const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (uniqueNames.length === 0) return []
  const existing = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.name, uniqueNames)))
  const idByName = new Map(existing.map((t) => [t.name, t.id]))
  for (const name of uniqueNames) {
    if (!idByName.has(name)) {
      const id = generateId()
      await tx.insert(tags).values({ id, workspaceId, name, color: DEFAULT_TAG_COLOR }).onConflictDoNothing()
      idByName.set(name, id)
    }
  }
  return [...idByName.values()]
}

// Nomes das tags de um contato.
async function fetchContactTagNames(tx: DbHandle, contactId: string): Promise<string[]> {
  const rows = await tx
    .select({ name: tags.name })
    .from(contactTags)
    .innerJoin(tags, eq(contactTags.tagId, tags.id))
    .where(eq(contactTags.contactId, contactId))
  return rows.map((r) => r.name)
}

// TypeBox do payload de identidade de canal (reusado em create e add).
const IdentityBody = t.Object({
  channelType: t.Union([t.Literal('whatsapp'), t.Literal('telegram')]),
  channelIdentifier: t.String({ minLength: 1, maxLength: 100 }),
  isPrimary: t.Optional(t.Boolean()),
})

export const inboxContactsRoutes = new Elysia({ name: 'inbox-contacts' })
  .use(authInboxPlugin)

  // GET /inbox/contacts — lista com identity primária, busca e filtros.
  // search casa nome/email/empresa; tag filtra por nome em contact_tags;
  // channel exige identity daquele canal. Limite fixo de 100 (paginação simples).
  .get(
    '/inbox/contacts',
    async ({ agent, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const conditions = [eq(contacts.workspaceId, agent.workspaceId)]
      if (query.search) {
        const term = `%${query.search}%`
        conditions.push(
          or(ilike(contacts.name, term), ilike(contacts.email, term), ilike(contacts.company, term))!,
        )
      }
      if (query.tag) {
        conditions.push(
          sql`exists (select 1 from contact_tags ct join tags tg on tg.id = ct.tag_id where ct.contact_id = ${contacts.id} and tg.workspace_id = ${agent.workspaceId} and tg.name = ${query.tag})`,
        )
      }
      if (query.channel) {
        conditions.push(
          sql`exists (select 1 from contact_identities ci where ci.contact_id = ${contacts.id} and ci.channel_type = ${query.channel})`,
        )
      }

      const rows = await db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          company: contacts.company,
          avatarUrl: contacts.avatarUrl,
          createdAt: contacts.createdAt,
          primaryChannelType: contactIdentities.channelType,
          primaryChannelIdentifier: contactIdentities.channelIdentifier,
        })
        .from(contacts)
        .leftJoin(
          contactIdentities,
          and(eq(contactIdentities.contactId, contacts.id), eq(contactIdentities.isPrimary, true)),
        )
        .where(and(...conditions))
        .orderBy(desc(contacts.createdAt))
        .limit(100)

      // Tags (nomes) de cada contato listado.
      const contactIds = rows.map((r) => r.id)
      const tagRows = contactIds.length
        ? await db
            .select({ contactId: contactTags.contactId, name: tags.name })
            .from(contactTags)
            .innerJoin(tags, eq(contactTags.tagId, tags.id))
            .where(inArray(contactTags.contactId, contactIds))
        : []
      const tagsByContact = new Map<string, string[]>()
      for (const tr of tagRows) {
        const list = tagsByContact.get(tr.contactId) ?? []
        list.push(tr.name)
        tagsByContact.set(tr.contactId, list)
      }

      return { contacts: rows.map((r) => ({ ...r, tags: tagsByContact.get(r.id) ?? [] })) }
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        tag: t.Optional(t.String()),
        channel: t.Optional(t.Union([t.Literal('whatsapp'), t.Literal('telegram')])),
      }),
    },
  )

  // GET /inbox/contacts/:id — ficha completa: identities, tags, customFields,
  // deals (com funil/estágio) e contagens de conversas/deals.
  .get('/inbox/contacts/:id', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, params.id), eq(contacts.workspaceId, agent.workspaceId)))
      .limit(1)
    if (!contact) {
      set.status = 404
      return { message: 'Contato não encontrado.' }
    }

    const identities = await db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, contact.id))
      .orderBy(desc(contactIdentities.isPrimary), contactIdentities.createdAt)

    const contactDeals = await db
      .select({
        id: deals.id,
        title: deals.title,
        status: deals.status,
        valueCents: deals.valueCents,
        currency: deals.currency,
        closedAt: deals.closedAt,
        createdAt: deals.createdAt,
        pipelineId: pipelines.id,
        pipelineName: pipelines.name,
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        stageKind: pipelineStages.kind,
      })
      .from(deals)
      .innerJoin(pipelines, eq(deals.pipelineId, pipelines.id))
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(eq(deals.contactId, contact.id))
      .orderBy(desc(deals.createdAt))

    const [{ value: conversationCount }] = await db
      .select({ value: count() })
      .from(conversations)
      .where(eq(conversations.contactId, contact.id))

    const contactTagNames = await fetchContactTagNames(db, contact.id)

    return {
      contact: { ...contact, tags: contactTagNames },
      identities,
      deals: contactDeals,
      counts: { conversations: conversationCount, deals: contactDeals.length },
    }
  })

  // POST /inbox/contacts — qualquer agente cria. Exige ao menos uma identity;
  // se nenhuma vier marcada, a primeira vira primária. Conflito de identity
  // (unique workspace+canal+identificador) → 409.
  .post(
    '/inbox/contacts',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      // Checa conflito de identities antes de inserir.
      for (const identity of body.identities) {
        const [existing] = await db
          .select({ id: contactIdentities.id })
          .from(contactIdentities)
          .where(
            and(
              eq(contactIdentities.workspaceId, agent.workspaceId),
              eq(contactIdentities.channelType, identity.channelType),
              eq(contactIdentities.channelIdentifier, identity.channelIdentifier),
            ),
          )
          .limit(1)
        if (existing) {
          set.status = 409
          return {
            message: `Já existe um contato com ${identity.channelType} ${identity.channelIdentifier} neste workspace.`,
          }
        }
      }

      const hasPrimary = body.identities.some((i) => i.isPrimary)

      const created = await db.transaction(async (tx) => {
        const contactId = generateId()
        const [contact] = await tx
          .insert(contacts)
          .values({
            id: contactId,
            workspaceId: agent.workspaceId,
            name: body.name,
            email: body.email,
            company: body.company,
          })
          .returning()

        // Tags por nome: cria as que não existem e vincula ao contato.
        const tagIds = await resolveTagIds(tx, agent.workspaceId, body.tags ?? [])
        for (const tagId of tagIds) {
          await tx.insert(contactTags).values({ contactId, tagId })
        }

        const identities = []
        for (const [index, identity] of body.identities.entries()) {
          const [row] = await tx
            .insert(contactIdentities)
            .values({
              id: generateId(),
              workspaceId: agent.workspaceId,
              contactId,
              channelType: identity.channelType,
              channelIdentifier: identity.channelIdentifier,
              // Sem primária explícita, a primeira identity assume.
              isPrimary: hasPrimary ? (identity.isPrimary ?? false) : index === 0,
            })
            .returning()
          identities.push(row)
        }

        return { contact: { ...contact, tags: body.tags ?? [] }, identities }
      })

      set.status = 201
      return created
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 200 }),
        email: t.Optional(t.String({ maxLength: 200 })),
        company: t.Optional(t.String({ maxLength: 200 })),
        identities: t.Array(IdentityBody, { minItems: 1 }),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )

  // POST /inbox/contacts/:id/block — qualquer agente bloqueia. Efeito: inbound
  // do contato é descartado no worker e outbound retorna 409.
  .post('/inbox/contacts/:id/block', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [contact] = await db
      .update(contacts)
      .set({ blocked: true, blockedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contacts.id, params.id), eq(contacts.workspaceId, agent.workspaceId)))
      .returning()
    if (!contact) {
      set.status = 404
      return { message: 'Contato não encontrado.' }
    }

    return { contact }
  })

  // POST /inbox/contacts/:id/unblock — remove o bloqueio.
  .post('/inbox/contacts/:id/unblock', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    const [contact] = await db
      .update(contacts)
      .set({ blocked: false, blockedAt: null, updatedAt: new Date() })
      .where(and(eq(contacts.id, params.id), eq(contacts.workspaceId, agent.workspaceId)))
      .returning()
    if (!contact) {
      set.status = 404
      return { message: 'Contato não encontrado.' }
    }

    return { contact }
  })

  // PATCH /inbox/contacts/:id — dados cadastrais, tags e customFields.
  .patch(
    '/inbox/contacts/:id',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const [existing] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, params.id), eq(contacts.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!existing) {
        set.status = 404
        return { message: 'Contato não encontrado.' }
      }

      // Tags: se vierem no body, substituem todos os vínculos do contato.
      if (body.tags !== undefined) {
        await db.transaction(async (tx) => {
          await tx.delete(contactTags).where(eq(contactTags.contactId, params.id))
          const tagIds = await resolveTagIds(tx, agent.workspaceId, body.tags ?? [])
          for (const tagId of tagIds) {
            await tx.insert(contactTags).values({ contactId: params.id, tagId })
          }
        })
      }

      const [contact] = await db
        .update(contacts)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.company !== undefined ? { company: body.company } : {}),
          ...(body.birthDate !== undefined ? { birthDate: body.birthDate } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.customFields !== undefined ? { customFields: body.customFields } : {}),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, params.id))
        .returning()

      const contactTagNames = await fetchContactTagNames(db, params.id)
      return { contact: { ...contact, tags: contactTagNames } }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        email: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        company: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        birthDate: t.Optional(t.Nullable(t.String())),
        avatarUrl: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.Nullable(t.String())),
        tags: t.Optional(t.Array(t.String())),
        customFields: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  )

  // POST /inbox/contacts/:id/identities — superadmin adiciona canal ao contato.
  // isPrimary=true desmarca as demais.
  .post(
    '/inbox/contacts/:id/identities',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem gerenciar identidades de contato.' }
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

      const [conflict] = await db
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, agent.workspaceId),
            eq(contactIdentities.channelType, body.channelType),
            eq(contactIdentities.channelIdentifier, body.channelIdentifier),
          ),
        )
        .limit(1)
      if (conflict) {
        set.status = 409
        return { message: 'Já existe um contato com essa identidade neste workspace.' }
      }

      const identity = await db.transaction(async (tx) => {
        if (body.isPrimary) {
          await tx
            .update(contactIdentities)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(eq(contactIdentities.contactId, params.id))
        }
        const [row] = await tx
          .insert(contactIdentities)
          .values({
            id: generateId(),
            workspaceId: agent.workspaceId,
            contactId: params.id,
            channelType: body.channelType,
            channelIdentifier: body.channelIdentifier,
            isPrimary: body.isPrimary ?? false,
          })
          .returning()
        return row
      })

      set.status = 201
      return { identity }
    },
    { body: IdentityBody },
  )

  // DELETE /inbox/contacts/:id/identities/:identityId — superadmin. Não permite
  // remover a última identity; ao remover a primária, promove a mais antiga.
  .delete('/inbox/contacts/:id/identities/:identityId', async ({ agent, params, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    if (!isSuperadmin(agent)) {
      set.status = 403
      return { message: 'Apenas superadmins podem gerenciar identidades de contato.' }
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

    const identities = await db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, params.id))
      .orderBy(contactIdentities.createdAt)

    const target = identities.find((i) => i.id === params.identityId)
    if (!target) {
      set.status = 404
      return { message: 'Identidade não encontrada.' }
    }
    if (identities.length <= 1) {
      set.status = 400
      return { message: 'Não é possível remover a última identidade do contato.' }
    }

    await db.transaction(async (tx) => {
      await tx.delete(contactIdentities).where(eq(contactIdentities.id, target.id))
      if (target.isPrimary) {
        const next = identities.find((i) => i.id !== target.id)
        if (next) {
          await tx
            .update(contactIdentities)
            .set({ isPrimary: true, updatedAt: new Date() })
            .where(eq(contactIdentities.id, next.id))
        }
      }
    })

    return { deleted: true as const }
  })

  // POST /inbox/contacts/:id/merge — superadmin funde o contato secundário
  // (otherContactId) no principal (:id): move conversas, deals e identities
  // (pulando duplicadas de canal+identificador), une as tags e apaga o
  // secundário.
  .post(
    '/inbox/contacts/:id/merge',
    async ({ agent, params, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      if (!isSuperadmin(agent)) {
        set.status = 403
        return { message: 'Apenas superadmins podem mesclar contatos.' }
      }
      if (body.otherContactId === params.id) {
        set.status = 400
        return { message: 'Não é possível mesclar um contato com ele mesmo.' }
      }

      const [primary] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, params.id), eq(contacts.workspaceId, agent.workspaceId)))
        .limit(1)
      const [secondary] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, body.otherContactId), eq(contacts.workspaceId, agent.workspaceId)))
        .limit(1)
      if (!primary || !secondary) {
        set.status = 404
        return { message: 'Contato não encontrado.' }
      }

      const merged = await db.transaction(async (tx) => {
        // Conversas e deals passam a apontar para o contato principal.
        await tx
          .update(conversations)
          .set({ contactId: primary.id, updatedAt: new Date() })
          .where(eq(conversations.contactId, secondary.id))
        await tx
          .update(deals)
          .set({ contactId: primary.id, updatedAt: new Date() })
          .where(eq(deals.contactId, secondary.id))

        // Identities: conflito de unique (workspace, canal, identificador) é
        // pulado — a duplicada do secundário é descartada.
        const primaryIdentities = await tx
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.contactId, primary.id))
        const existingKeys = new Set(
          primaryIdentities.map((i) => `${i.channelType}:${i.channelIdentifier}`),
        )
        const secondaryIdentities = await tx
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.contactId, secondary.id))

        let moved = 0
        let skipped = 0
        for (const identity of secondaryIdentities) {
          const key = `${identity.channelType}:${identity.channelIdentifier}`
          if (existingKeys.has(key)) {
            await tx.delete(contactIdentities).where(eq(contactIdentities.id, identity.id))
            skipped += 1
          } else {
            // Nunca derruba a primária do principal na mesclagem.
            await tx
              .update(contactIdentities)
              .set({ contactId: primary.id, isPrimary: false, updatedAt: new Date() })
              .where(eq(contactIdentities.id, identity.id))
            existingKeys.add(key)
            moved += 1
          }
        }

        // Tags: vínculos do secundário passam para o principal (sem duplicar);
        // demais campos ficam os do principal.
        const primaryTagIds = new Set(
          (await tx.select({ tagId: contactTags.tagId }).from(contactTags).where(eq(contactTags.contactId, primary.id))).map(
            (r) => r.tagId,
          ),
        )
        const secondaryTagRows = await tx
          .select({ tagId: contactTags.tagId })
          .from(contactTags)
          .where(eq(contactTags.contactId, secondary.id))
        for (const row of secondaryTagRows) {
          if (primaryTagIds.has(row.tagId)) {
            await tx
              .delete(contactTags)
              .where(and(eq(contactTags.contactId, secondary.id), eq(contactTags.tagId, row.tagId)))
          } else {
            await tx
              .update(contactTags)
              .set({ contactId: primary.id })
              .where(and(eq(contactTags.contactId, secondary.id), eq(contactTags.tagId, row.tagId)))
          }
        }

        const [contact] = await tx
          .update(contacts)
          .set({ updatedAt: new Date() })
          .where(eq(contacts.id, primary.id))
          .returning()

        await tx.delete(contacts).where(eq(contacts.id, secondary.id))

        const contactTagNames = await fetchContactTagNames(tx, primary.id)
        return { contact: { ...contact, tags: contactTagNames }, movedIdentities: moved, skippedIdentities: skipped }
      })

      return merged
    },
    {
      body: t.Object({ otherContactId: t.String({ minLength: 1 }) }),
    },
  )

  // GET /inbox/contacts/:id/history — todas as conversas do contato (qualquer
  // status), mais recentes primeiro, com conexão, agente, fila, contagem de
  // mensagens e transferências (com nomes).
  .get('/inbox/contacts/:id/history', async ({ agent, params, set }) => {
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

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        createdAt: conversations.createdAt,
        resolvedAt: conversations.resolvedAt,
        connectionKind: connections.kind,
        connectionName: connections.name,
        assignedAgentId: agents.id,
        assignedAgentName: agents.name,
        queueId: queues.id,
        queueName: queues.name,
      })
      .from(conversations)
      .innerJoin(connections, eq(conversations.connectionId, connections.id))
      .leftJoin(agents, eq(conversations.assignedAgentId, agents.id))
      .leftJoin(queues, eq(conversations.queueId, queues.id))
      .where(eq(conversations.contactId, contact.id))
      .orderBy(desc(conversations.createdAt))

    if (rows.length === 0) {
      return { history: [] }
    }

    const conversationIds = rows.map((r) => r.id)

    // Contagem de mensagens por conversa.
    const messageCounts = await db
      .select({ conversationId: messages.conversationId, value: count() })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .groupBy(messages.conversationId)
    const countByConversation = new Map(messageCounts.map((r) => [r.conversationId, r.value]))

    // Transferências das conversas do contato.
    const transfers = await db
      .select()
      .from(conversationTransfers)
      .where(inArray(conversationTransfers.conversationId, conversationIds))
      .orderBy(conversationTransfers.createdAt)

    // Resolve nomes de agentes/filas referenciados nas transferências.
    const agentIds = new Set<string>()
    const queueIds = new Set<string>()
    for (const tr of transfers) {
      if (tr.fromAgentId) agentIds.add(tr.fromAgentId)
      if (tr.toAgentId) agentIds.add(tr.toAgentId)
      agentIds.add(tr.transferredByAgentId)
      if (tr.fromQueueId) queueIds.add(tr.fromQueueId)
      if (tr.toQueueId) queueIds.add(tr.toQueueId)
    }
    const agentNames = new Map<string, string>()
    if (agentIds.size > 0) {
      const rowsAgents = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(inArray(agents.id, [...agentIds]))
      for (const a of rowsAgents) agentNames.set(a.id, a.name)
    }
    const queueNames = new Map<string, string>()
    if (queueIds.size > 0) {
      const rowsQueues = await db
        .select({ id: queues.id, name: queues.name })
        .from(queues)
        .where(inArray(queues.id, [...queueIds]))
      for (const q of rowsQueues) queueNames.set(q.id, q.name)
    }

    const transfersByConversation = new Map<string, typeof transfers>()
    for (const tr of transfers) {
      const list = transfersByConversation.get(tr.conversationId) ?? []
      list.push(tr)
      transfersByConversation.set(tr.conversationId, list)
    }

    const history = rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      connection: { kind: row.connectionKind, name: row.connectionName },
      assignedAgent: row.assignedAgentId
        ? { id: row.assignedAgentId, name: row.assignedAgentName }
        : null,
      queue: row.queueId ? { id: row.queueId, name: row.queueName } : null,
      messageCount: countByConversation.get(row.id) ?? 0,
      transfers: (transfersByConversation.get(row.id) ?? []).map((tr) => ({
        id: tr.id,
        fromAgent: tr.fromAgentId ? { id: tr.fromAgentId, name: agentNames.get(tr.fromAgentId) ?? null } : null,
        toAgent: tr.toAgentId ? { id: tr.toAgentId, name: agentNames.get(tr.toAgentId) ?? null } : null,
        fromQueue: tr.fromQueueId ? { id: tr.fromQueueId, name: queueNames.get(tr.fromQueueId) ?? null } : null,
        toQueue: tr.toQueueId ? { id: tr.toQueueId, name: queueNames.get(tr.toQueueId) ?? null } : null,
        note: tr.note,
        transferredBy: { id: tr.transferredByAgentId, name: agentNames.get(tr.transferredByAgentId) ?? null },
        createdAt: tr.createdAt,
      })),
    }))

    return { history }
  })
