import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { contacts, contactIdentities, contactTags, tags } from '@crm/db/schema'
import { eq, and, or, ilike, desc, inArray, sql } from 'drizzle-orm'
import { authInboxPlugin } from '../plugins/auth-inbox'
import { generateId } from '../lib/crypto'
import { resolveTagIds } from './inbox-contacts'

// Limite de linhas por importação (acima disso → 413).
const MAX_IMPORT_ROWS = 5000

// Escapa um campo CSV: aspas viram aspas dobradas e o campo vai entre aspas
// quando contém separador (';'), aspas ou quebra de linha.
function csvField(value: string | null | undefined): string {
  const v = value ?? ''
  if (/[;"\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

// TypeBox de uma linha de importação. name fica sem minLength de propósito:
// a validação por linha (nome + ao menos um canal) é acumulada em `errors`
// em vez de derrubar a requisição inteira com 422.
const ImportRow = t.Object({
  name: t.String({ maxLength: 200 }),
  email: t.Optional(t.String({ maxLength: 200 })),
  company: t.Optional(t.String({ maxLength: 200 })),
  whatsapp: t.Optional(t.String({ maxLength: 100 })),
  telegram: t.Optional(t.String({ maxLength: 100 })),
  // Nomes de tags separados por ';'.
  tags: t.Optional(t.String()),
})

export const inboxContactsCsvRoutes = new Elysia({ name: 'inbox-contacts-csv' })
  .use(authInboxPlugin)

  // GET /inbox/contacts-export — CSV de contatos (download). Mesmos filtros
  // opcionais da listagem (search, tag, channel), mas sem o limite de 100.
  // Separador ';' (convenção do Excel pt-BR) e BOM para acentos abrirem certo.
  .get(
    '/inbox/contacts-export',
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
        .select({ id: contacts.id, name: contacts.name, email: contacts.email, company: contacts.company })
        .from(contacts)
        .where(and(...conditions))
        .orderBy(desc(contacts.createdAt))

      const contactIds = rows.map((r) => r.id)

      // Identities de todos os contatos exportados (primária primeiro — em
      // empate de canal, a primária é a que aparece na coluna).
      const identities = contactIds.length
        ? await db
            .select()
            .from(contactIdentities)
            .where(inArray(contactIdentities.contactId, contactIds))
            .orderBy(desc(contactIdentities.isPrimary))
        : []
      const identitiesByContact = new Map<string, typeof identities>()
      for (const identity of identities) {
        const list = identitiesByContact.get(identity.contactId) ?? []
        list.push(identity)
        identitiesByContact.set(identity.contactId, list)
      }

      // Tags (nomes) por contato.
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

      const channelColumn = (contactId: string, channelType: 'whatsapp' | 'telegram') =>
        (identitiesByContact.get(contactId) ?? [])
          .filter((i) => i.channelType === channelType)
          .map((i) => i.channelIdentifier)
          .join(';')

      const lines = ['nome;email;empresa;whatsapp;telegram;tags']
      for (const row of rows) {
        lines.push(
          [
            csvField(row.name),
            csvField(row.email),
            csvField(row.company),
            csvField(channelColumn(row.id, 'whatsapp')),
            csvField(channelColumn(row.id, 'telegram')),
            csvField((tagsByContact.get(row.id) ?? []).join(';')),
          ].join(';'),
        )
      }

      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = 'attachment; filename="contatos.csv"'
      return `\uFEFF${lines.join('\r\n')}`
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        tag: t.Optional(t.String()),
        channel: t.Optional(t.Union([t.Literal('whatsapp'), t.Literal('telegram')])),
      }),
    },
  )

  // POST /inbox/contacts-import — importa linhas {name, email?, company?,
  // whatsapp?, telegram?, tags?}. Dedupe por identidade (workspace + canal +
  // identificador): existindo, mode 'skip' pula e 'update' atualiza dados
  // cadastrais e acrescenta tags/identities novas; não existindo, cria o
  // contato. Cada linha roda na própria transaction — erro em uma não afeta
  // as demais e vira entrada em `errors`.
  .post(
    '/inbox/contacts-import',
    async ({ agent, body, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      if (body.rows.length > MAX_IMPORT_ROWS) {
        set.status = 413
        return { message: `Máximo de ${MAX_IMPORT_ROWS} linhas por importação.` }
      }

      const result = {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [] as { row: number; reason: string }[],
      }

      for (const [index, row] of body.rows.entries()) {
        const rowNumber = index + 1
        const name = row.name.trim()
        const channels: { channelType: 'whatsapp' | 'telegram'; channelIdentifier: string }[] = []
        if (row.whatsapp?.trim()) {
          channels.push({ channelType: 'whatsapp', channelIdentifier: row.whatsapp.trim() })
        }
        if (row.telegram?.trim()) {
          channels.push({ channelType: 'telegram', channelIdentifier: row.telegram.trim() })
        }

        if (!name) {
          result.errors.push({ row: rowNumber, reason: 'Nome é obrigatório.' })
          continue
        }
        if (channels.length === 0) {
          result.errors.push({ row: rowNumber, reason: 'Informe ao menos um canal (whatsapp ou telegram).' })
          continue
        }

        const tagNames = (row.tags ?? '')
          .split(';')
          .map((n) => n.trim())
          .filter(Boolean)

        try {
          const outcome = await db.transaction(async (tx) => {
            // Identities já cadastradas que batem com os canais da linha.
            const matchingIdentities = await tx
              .select()
              .from(contactIdentities)
              .where(
                and(
                  eq(contactIdentities.workspaceId, agent.workspaceId),
                  or(
                    ...channels.map((c) =>
                      and(
                        eq(contactIdentities.channelType, c.channelType),
                        eq(contactIdentities.channelIdentifier, c.channelIdentifier),
                      ),
                    ),
                  ),
                ),
              )

            const existingContactId = matchingIdentities[0]?.contactId

            // Contato encontrado por dedupe: pula ou atualiza.
            if (existingContactId) {
              if (body.mode === 'skip') return 'skipped' as const

              await tx
                .update(contacts)
                .set({
                  name,
                  ...(row.email !== undefined ? { email: row.email } : {}),
                  ...(row.company !== undefined ? { company: row.company } : {}),
                  updatedAt: new Date(),
                })
                .where(eq(contacts.id, existingContactId))

              // Identities novas: canais da linha ainda não vinculados a este
              // contato e que não pertencem a outro contato do workspace
              // (esses são ignorados — conflito de unique).
              const contactIdentitiesRows = await tx
                .select()
                .from(contactIdentities)
                .where(eq(contactIdentities.contactId, existingContactId))
              const ownKeys = new Set(
                contactIdentitiesRows.map((i) => `${i.channelType}:${i.channelIdentifier}`),
              )
              const takenKeys = new Set(
                matchingIdentities
                  .filter((i) => i.contactId !== existingContactId)
                  .map((i) => `${i.channelType}:${i.channelIdentifier}`),
              )
              for (const channel of channels) {
                const key = `${channel.channelType}:${channel.channelIdentifier}`
                if (ownKeys.has(key) || takenKeys.has(key)) continue
                await tx.insert(contactIdentities).values({
                  id: generateId(),
                  workspaceId: agent.workspaceId,
                  contactId: existingContactId,
                  channelType: channel.channelType,
                  channelIdentifier: channel.channelIdentifier,
                  // Nunca derruba a primária existente na importação.
                  isPrimary: false,
                })
                ownKeys.add(key)
              }

              // Tags novas (find-or-create por nome; vínculos já existentes
              // são ignorados).
              const tagIds = await resolveTagIds(tx, agent.workspaceId, tagNames)
              const linkedTagIds = new Set(
                (
                  await tx
                    .select({ tagId: contactTags.tagId })
                    .from(contactTags)
                    .where(eq(contactTags.contactId, existingContactId))
                ).map((r) => r.tagId),
              )
              for (const tagId of tagIds) {
                if (linkedTagIds.has(tagId)) continue
                await tx.insert(contactTags).values({ contactId: existingContactId, tagId })
              }

              return 'updated' as const
            }

            // Contato novo: cria cadastro, identities (primeira = primária)
            // e tags.
            const contactId = generateId()
            await tx.insert(contacts).values({
              id: contactId,
              workspaceId: agent.workspaceId,
              name,
              email: row.email,
              company: row.company,
            })
            for (const [channelIndex, channel] of channels.entries()) {
              await tx.insert(contactIdentities).values({
                id: generateId(),
                workspaceId: agent.workspaceId,
                contactId,
                channelType: channel.channelType,
                channelIdentifier: channel.channelIdentifier,
                isPrimary: channelIndex === 0,
              })
            }
            const tagIds = await resolveTagIds(tx, agent.workspaceId, tagNames)
            for (const tagId of tagIds) {
              await tx.insert(contactTags).values({ contactId, tagId })
            }

            return 'created' as const
          })

          if (outcome === 'created') result.created += 1
          else if (outcome === 'updated') result.updated += 1
          else result.skipped += 1
        } catch {
          result.errors.push({ row: rowNumber, reason: 'Erro inesperado ao importar a linha.' })
        }
      }

      return result
    },
    {
      body: t.Object({
        rows: t.Array(ImportRow, { minItems: 1 }),
        mode: t.Union([t.Literal('skip'), t.Literal('update')]),
      }),
    },
  )
