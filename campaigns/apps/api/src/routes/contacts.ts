import { Elysia, t } from 'elysia'
import { db, contacts, contactIdentities, contactTags, campaignMessages, campaigns, connections } from '@naia/db'
import { eq, and, or, ilike, sql, inArray, arrayOverlaps } from 'drizzle-orm'
import { sanitizeErrorMessage } from '@naia/schemas'
import { matchesBirthdayToday, todayMonthDay, DEFAULT_TIMEZONE } from '@naia/scheduling'

import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { handleContactCreated, handleTagsAdded } from '../lib/automation-triggers'
import { generateId } from '../lib/crypto'
import {
  getGroupParticipants,
  resolveWhatsAppContactName,
  enrichWhatsAppContact,
  batchEnrichWhatsAppContacts,
} from '@naia/session-host-client'

async function getActiveWhatsAppConnectionForWorkspace(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(
      eq(connections.workspaceId, workspaceId),
      eq(connections.channel, 'whatsapp'),
      eq(connections.status, 'active'),
    ))
    .orderBy(connections.createdAt)
    .limit(1)
  return row?.id ?? null
}

async function pickWhatsAppConnectionId(workspaceId: string, connectionIds: string[]): Promise<string> {
  if (connectionIds.length > 0) {
    const [row] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(
        inArray(connections.id, connectionIds),
        eq(connections.channel, 'whatsapp'),
        eq(connections.status, 'active'),
      ))
      .limit(1)
    if (row) return row.id
  }
  return (await getActiveWhatsAppConnectionForWorkspace(workspaceId)) ?? connectionIds[0] ?? ''
}

/**
 * Resolve a usable WhatsApp phone number from a group participant object.
 * Modern Baileys returns participants in @lid (Linked Identity) format instead
 * of @s.whatsapp.net. When the id ends with @lid, the actual phone number lives
 * in the separate `phoneNumber` field (format: "5511999999999@s.whatsapp.net").
 */
function resolveParticipantPhone(p: { id: string; phoneNumber?: string | null; name?: string | null }): string | null {
  if (p.phoneNumber) {
    const pn = p.phoneNumber.replace(/@.*$/, '').replace(/\D/g, '')
    if (pn && pn.length >= 8 && pn.length <= 15) return pn
  }
  if (p.id && p.id.endsWith('@s.whatsapp.net')) {
    const phone = p.id.replace(/@.*$/, '').replace(/\D/g, '')
    if (phone && phone.length >= 8 && phone.length <= 15) return phone
  }
  if (p.id && p.id.endsWith('@lid')) return null
  if (p.id && !p.id.includes('@')) {
    const phone = p.id.replace(/\D/g, '')
    if (phone && phone.length >= 8 && phone.length <= 15) return phone
  }
  return null
}


function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  const rows: Array<Record<string, string>> = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values: string[] = []
    let inQuotes = false
    let current = ''
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue }
      current += ch
    }
    values.push(current.trim())

    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = values[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

export type SegmentFilter =
  | { type: 'all' }
  | { type: 'tags'; tags: string[] }
  | { type: 'custom'; field: string; value: string }
  | {
      type: 'groups'
      groupIds: string[]
      targetMode: 'group' | 'members'
      tagOnCreate?: string[]
    }
  // Aniversariantes do dia (usado pelas automações; monthDay 'MM-DD' — quando
  // ausente, o resolvedor usa o dia corrente no fuso da campanha/automação)
  | { type: 'birthday'; monthDay?: string; timezone?: string }

export function buildContactsQuery(workspaceId: string, filter: SegmentFilter) {
  if (filter.type === 'all') {
    return db.select().from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.isGroup, false)))
  }
  if (filter.type === 'tags') {
    return db.select().from(contacts).where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.isGroup, false),
        arrayOverlaps(contacts.tags, filter.tags),
      ),
    )
  }
  if (filter.type === 'custom') {
    const field = filter.field
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(field)) {
      throw new Error('Campo customizado inválido.')
    }
    return db.select().from(contacts).where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.isGroup, false),
        sql`${contacts.customFields}::jsonb->>${field} = ${filter.value}`,
      ),
    )
  }
  if (filter.type === 'groups') {
    if (!filter.groupIds || filter.groupIds.length === 0) {
      return db.select().from(contacts).where(sql`false`)
    }
    return db.select().from(contacts).where(
      and(
        eq(contacts.workspaceId, workspaceId),
        or(
          inArray(contacts.id, filter.groupIds),
          inArray(contacts.whatsappPhone, filter.groupIds),
          inArray(contacts.telegramChatId, filter.groupIds),
        ),
      ),
    )
  }
  return db.select().from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.isGroup, false)))
}

export async function resolveCampaignTargets(workspaceId: string, connectionIds: string[], filter: SegmentFilter): Promise<typeof contacts.$inferSelect[]> {
  if (filter.type === 'birthday') {
    // Formatos de birthDate são bagunçados ('YYYY-MM-DD', 'DD/MM', 'DD/MM/YYYY')
    // — comparação em código, não em SQL.
    const monthDay = filter.monthDay ?? todayMonthDay(new Date(), filter.timezone ?? DEFAULT_TIMEZONE)
    const withBirthDate = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.isGroup, false), sql`${contacts.birthDate} is not null`))
    return withBirthDate.filter((c) => matchesBirthdayToday(c.birthDate, monthDay))
  }

  if (filter.type !== 'groups') {
    return buildContactsQuery(workspaceId, filter)
  }

  // Operações de grupo precisam de um socket Baileys — usa a primeira conexão
  // WhatsApp ativa entre as selecionadas (fallback: qualquer uma do workspace).
  const connectionId = await pickWhatsAppConnectionId(workspaceId, connectionIds)

  if (!filter.groupIds || filter.groupIds.length === 0) {
    return []
  }

  const groupContacts = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        or(
          inArray(contacts.id, filter.groupIds),
          inArray(contacts.whatsappPhone, filter.groupIds),
          inArray(contacts.telegramChatId, filter.groupIds),
        ),
      ),
    )

  const groupContactsMap = new Map<string, typeof contacts.$inferSelect>()
  for (const gc of groupContacts) {
    groupContactsMap.set(gc.id, gc)
    if (gc.whatsappPhone) groupContactsMap.set(gc.whatsappPhone, gc)
    if (gc.telegramChatId) groupContactsMap.set(gc.telegramChatId, gc)
  }

  if (filter.targetMode === 'group') {
    const result: typeof contacts.$inferSelect[] = []
    for (const gId of filter.groupIds) {
      let gc = groupContactsMap.get(gId)
      let avatarUrl: string | null = gc?.avatarUrl || null
      let groupName = gc?.name || `Grupo ${gId}`
      if (gId.endsWith('@g.us')) {
        try {
          const enriched = await enrichWhatsAppContact(connectionId, gId, groupName)
          if (enriched.avatarUrl) avatarUrl = enriched.avatarUrl
          if (enriched.name && enriched.name !== `Contato +${gId}`) groupName = enriched.name
        } catch {}
      }
      if (!gc && (gId.endsWith('@g.us') || gId.includes('@'))) {
        const newId = generateId()
        const newGroupContact = {
          id: newId,
          workspaceId,
          name: groupName,
          telegramChatId: !gId.endsWith('@g.us') ? gId : null,
          whatsappPhone: gId.endsWith('@g.us') ? gId : null,
          email: null,
          birthDate: null,
          company: null,
          notes: null,
          tags: ['grupo'],
          customFields: '{}',
          avatarUrl: avatarUrl || null,
          isGroup: true,
          optInStatus: true,
          optInAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await db.insert(contacts).values(newGroupContact).onConflictDoNothing()
        gc = newGroupContact
        groupContactsMap.set(gId, gc)
      } else if (gc && (gc.avatarUrl !== avatarUrl || gc.name !== groupName)) {
        await db.update(contacts).set({ name: groupName, avatarUrl: avatarUrl, updatedAt: new Date() }).where(eq(contacts.id, gc.id))
        gc = { ...gc, name: groupName, avatarUrl: avatarUrl }
        groupContactsMap.set(gId, gc)
      }
      if (gc) result.push(gc)
    }
    return result
  }

  // targetMode === 'members': expand group members into individual contacts
  const membersMap = new Map<string, typeof contacts.$inferSelect>()

  for (const gId of filter.groupIds) {
    const gContact = groupContactsMap.get(gId)
    let participantsList: Array<{ id: string; phoneNumber?: string | null; name?: string | null }> = []

    const whatsappGroupJid = gContact?.whatsappPhone || (gId.endsWith('@g.us') ? gId : null)
    if (whatsappGroupJid) {
      participantsList = await getGroupParticipants(connectionId, whatsappGroupJid)
    }
    if (participantsList.length === 0 && gContact) {
      try {
        const meta = JSON.parse(gContact.customFields)
        if (meta.participants) {
          participantsList = typeof meta.participants === 'string' ? JSON.parse(meta.participants) : meta.participants
        }
      } catch {}
    }

    const enrichedMap = await batchEnrichWhatsAppContacts(
      connectionId,
      participantsList.map((p) => {
        const phone = resolveParticipantPhone(p)
        const id = (p.id && !p.id.endsWith('@lid'))
          ? p.id
          : (phone ? `${phone}@s.whatsapp.net` : p.id)
        return { id: id || phone || p.id || '', name: p.name, avatarUrl: (p as any).avatarUrl || null }
      }).filter(x => x.id)
    )

    for (const p of participantsList) {
      if (!p.id || p.id.endsWith('@g.us')) continue
      const phone = resolveParticipantPhone(p)
      if (!phone) continue

      const normalizedJid = p.id.endsWith('@lid') ? `${phone}@s.whatsapp.net` : p.id
      const enriched = enrichedMap.get(normalizedJid) || enrichedMap.get(p.id) || enrichedMap.get(`${phone}@s.whatsapp.net`)
      const isGenericName = (name: string) => !name || name.startsWith('Contato +') || name.startsWith('Contato ') || name.startsWith('Membro ') || name === phone || name === `+${phone}`
      const resolvedName = enriched?.name && !isGenericName(enriched.name)
        ? enriched.name
        : await resolveWhatsAppContactName(connectionId, p.id, p.name || null)
      const avatarUrl = enriched?.avatarUrl || (p as any).avatarUrl || null

      let [existing] = await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, workspaceId),
            eq(contacts.whatsappPhone, phone),
            eq(contacts.isGroup, false),
          ),
        )
        .limit(1)

      if (existing) {
        const nameUpdate = isGenericName(existing.name) && !isGenericName(resolvedName) ? resolvedName : existing.name
        const avatarUpdate = avatarUrl || existing.avatarUrl || null
        if (nameUpdate !== existing.name || avatarUpdate !== existing.avatarUrl) {
          await db.update(contacts).set({ name: nameUpdate, avatarUrl: avatarUpdate, updatedAt: new Date() }).where(eq(contacts.id, existing.id))
          existing = { ...existing, name: nameUpdate, avatarUrl: avatarUpdate }
        }
        membersMap.set(existing.id, existing)
      } else {
        const newId = generateId()
        const newContact = {
          id: newId,
          workspaceId,
          name: resolvedName,
          telegramChatId: null,
          whatsappPhone: phone,
          email: null,
          birthDate: null,
          company: null,
          notes: null,
          tags: ['origem:grupo', ...(filter.tagOnCreate || [])],
          customFields: '{}',
          avatarUrl: avatarUrl || null,
          isGroup: false,
          optInStatus: true,
          optInAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await db.insert(contacts).values(newContact)
        await db.insert(contactIdentities).values({
          id: generateId(),
          workspaceId,
          contactId: newId,
          channelType: 'whatsapp',
          channelIdentifier: phone,
          isPrimary: true,
        }).onConflictDoNothing()

        membersMap.set(newId, newContact)
      }
    }
  }

  return Array.from(membersMap.values())
}


type ImportResult = { imported: number; skipped: number; failed: number; errors: string[] }

/** Pipeline de import compartilhado entre /import (CSV colado), /import-file
 * (upload csv/xlsx) e o público manual do wizard. */
async function importContactRows(
  workspaceId: string,
  rows: Array<Record<string, string>>,
  opts: { onDuplicate: 'skip' | 'update'; extraTags?: string[] },
): Promise<ImportResult> {
  const onDuplicate = opts.onDuplicate
  const extraTags = opts.extraTags ?? []
  let imported = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const name = row.name ?? row.nome ?? row.Name ?? ''
      const telegramChatId = row.telegram_chat_id ?? row.telegram ?? null
      const whatsappPhone = row.whatsapp_phone ?? row.whatsapp ?? row.phone ?? row.telefone ?? null
      const rawOpt = (row.opt_in ?? row.opt_out ?? '').toLowerCase().trim()
      const optIn = !['false', '0', 'no', 'nao', 'não', 'optout', 'opt-out'].includes(rawOpt)
      const tags = [
        ...(row.tags ? row.tags.split('|').map((t) => t.trim()).filter(Boolean) : []),
        ...extraTags,
      ]

      if (!name) { failed++; errors.push('Linha ignorada: nome vazio'); continue }
      if (!telegramChatId && !whatsappPhone) { failed++; errors.push(`${name}: sem identificador de canal`); continue }

      const customFields: Record<string, string> = {}
      const knownCols = new Set(['name', 'nome', 'telegram_chat_id', 'telegram', 'whatsapp_phone', 'whatsapp', 'phone', 'telefone', 'opt_in', 'tags'])
      for (const [k, v] of Object.entries(row)) {
        if (!knownCols.has(k) && v) customFields[k] = v
      }

      if (whatsappPhone) {
        const [existing] = await db
          .select({ id: contacts.id, tags: contacts.tags })
          .from(contacts)
          .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.whatsappPhone, whatsappPhone)))
          .limit(1)

        if (existing) {
          if (onDuplicate === 'skip') { skipped++; continue }
          const addedTags = tags.filter((tag) => !existing.tags.includes(tag))
          await db.update(contacts).set({
            name,
            telegramChatId: telegramChatId ?? undefined,
            tags,
            customFields: JSON.stringify(customFields),
            optInStatus: optIn,
            optInAt: optIn ? new Date() : undefined,
            updatedAt: new Date(),
          }).where(eq(contacts.id, existing.id))

          await db.insert(contactIdentities).values({
            id: generateId(),
            workspaceId,
            contactId: existing.id,
            channelType: 'whatsapp',
            channelIdentifier: whatsappPhone,
            isPrimary: true,
          }).onConflictDoNothing()

          if (telegramChatId) {
            await db.insert(contactIdentities).values({
              id: generateId(),
              workspaceId,
              contactId: existing.id,
              channelType: 'telegram',
              channelIdentifier: telegramChatId,
              isPrimary: true,
            }).onConflictDoNothing()
          }

          if (addedTags.length > 0) await handleTagsAdded(workspaceId, [existing.id], addedTags)
          imported++
          continue
        }
      }

      const newId = generateId()
      await db.insert(contacts).values({
        id: newId,
        workspaceId,
        name,
        telegramChatId: telegramChatId || null,
        whatsappPhone: whatsappPhone || null,
        tags,
        customFields: JSON.stringify(customFields),
        optInStatus: optIn,
        optInAt: optIn ? new Date() : null,
      })

      if (whatsappPhone) {
        await db.insert(contactIdentities).values({
          id: generateId(),
          workspaceId,
          contactId: newId,
          channelType: 'whatsapp',
          channelIdentifier: whatsappPhone,
          isPrimary: true,
        }).onConflictDoNothing()
      }
      if (telegramChatId) {
        await db.insert(contactIdentities).values({
          id: generateId(),
          workspaceId,
          contactId: newId,
          channelType: 'telegram',
          channelIdentifier: telegramChatId,
          isPrimary: true,
        }).onConflictDoNothing()
      }

      // Gatilhos de automação: contato novo + tags que vieram no import
      await handleContactCreated(workspaceId, newId)
      if (tags.length > 0) await handleTagsAdded(workspaceId, [newId], tags)

      imported++
    } catch (err) {
      failed++
      errors.push(`Erro ao importar linha: ${sanitizeErrorMessage(err, 'Dado no formato incorreto ou conflito de registro no banco')}`)
    }
  }

  return { imported, skipped, failed, errors }
}

/**
 * Garante a tag em todos os contatos com os identificadores dados — inclusive
 * os que o import pulou por duplicidade. Essencial quando a tag é a audiência
 * de uma campanha (arquivo/manual): contato existente também precisa entrar.
 */
async function applyTagToIdentifiers(
  workspaceId: string,
  tag: string,
  identifiers: { phones: string[]; telegramIds: string[] },
): Promise<void> {
  const notTagged = sql`NOT (${contacts.tags} @> ARRAY[${tag}]::text[])`
  const taggedIds: string[] = []
  if (identifiers.phones.length > 0) {
    const rows = await db
      .update(contacts)
      .set({ tags: sql`array_append(${contacts.tags}, ${tag})`, updatedAt: new Date() })
      .where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.whatsappPhone, identifiers.phones), notTagged))
      .returning({ id: contacts.id })
    taggedIds.push(...rows.map((r) => r.id))
  }
  if (identifiers.telegramIds.length > 0) {
    const rows = await db
      .update(contacts)
      .set({ tags: sql`array_append(${contacts.tags}, ${tag})`, updatedAt: new Date() })
      .where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.telegramChatId, identifiers.telegramIds), notTagged))
      .returning({ id: contacts.id })
    taggedIds.push(...rows.map((r) => r.id))
  }
  if (taggedIds.length > 0) await handleTagsAdded(workspaceId, taggedIds, [tag])
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export const contactRoutes = new Elysia()
  .use(authPlugin)

  // GET /workspaces/:workspaceId/contacts
  .get(
    '/workspaces/:workspaceId/contacts',
    async ({ session, params, query, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const page = Math.max(1, query.page ?? 1)
      const limit = Math.min(100, query.limit ?? 50)
      const offset = (page - 1) * limit

      const conditions = [eq(contacts.workspaceId, params.workspaceId)]

      if (query.search) {
        conditions.push(ilike(contacts.name, `%${query.search}%`))
      }
      if (query.tag) {
        conditions.push(sql`${contacts.tags} @> ARRAY[${query.tag}]::text[]`)
      }
      if (query.channel === 'telegram') {
        conditions.push(sql`${contacts.telegramChatId} IS NOT NULL`)
      }
      if (query.channel === 'whatsapp') {
        conditions.push(sql`${contacts.whatsappPhone} IS NOT NULL`)
      }
      if (query.isGroup !== undefined) {
        conditions.push(eq(contacts.isGroup, query.isGroup === 'true'))
      }

      const [rows, totalResult] = await Promise.all([
        db.select().from(contacts).where(and(...conditions)).limit(limit).offset(offset).orderBy(contacts.createdAt),
        db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(and(...conditions)),
      ])

      const contactIds = rows.map((r) => r.id)
      const identitiesMap = new Map<string, typeof contactIdentities.$inferSelect[]>()
      if (contactIds.length > 0) {
        const idRows = await db
          .select()
          .from(contactIdentities)
          .where(and(inArray(contactIdentities.contactId, contactIds), eq(contactIdentities.workspaceId, params.workspaceId)))
        for (const row of idRows) {
          const list = identitiesMap.get(row.contactId) ?? []
          list.push(row)
          identitiesMap.set(row.contactId, list)
        }
      }

      const contactsWithIdentities = rows.map((r) => ({
        ...r,
        identities: identitiesMap.get(r.id) ?? [],
      }))

      return {
        contacts: contactsWithIdentities,
        total: totalResult[0]?.count ?? 0,
        page,
        limit,
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number()),
        limit: t.Optional(t.Number()),
        search: t.Optional(t.String()),
        tag: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        isGroup: t.Optional(t.String()),
      }),
    },
  )


  // GET /workspaces/:workspaceId/contacts/tags
  .get(
    '/workspaces/:workspaceId/contacts/tags',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const tagRows = await db
        .select()
        .from(contactTags)
        .where(eq(contactTags.workspaceId, params.workspaceId))

      const contactRows = await db
        .select({ tags: contacts.tags })
        .from(contacts)
        .where(eq(contacts.workspaceId, params.workspaceId))

      const tagSet = new Set<string>()
      for (const row of contactRows) {
        for (const tag of row.tags) tagSet.add(tag)
      }
      for (const row of tagRows) {
        tagSet.add(row.name)
      }

      const map = new Map<string, { id: string; name: string; color: string; description: string | null; isCustom: boolean }>()
      for (const t of tagRows) {
        map.set(t.name, { id: t.id, name: t.name, color: t.color, description: t.description, isCustom: true })
      }
      for (const name of tagSet) {
        if (!map.has(name)) {
          map.set(name, { id: `tag_${name}`, name, color: '#3b82f6', description: null, isCustom: false })
        }
      }

      return {
        tags: [...tagSet].sort(),
        items: Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)),
      }
    },
  )

  // POST /workspaces/:workspaceId/contacts/tags
  .post(
    '/workspaces/:workspaceId/contacts/tags',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const id = generateId()
      const name = body.name.trim()
      const [existing] = await db
        .select()
        .from(contactTags)
        .where(and(eq(contactTags.workspaceId, params.workspaceId), eq(contactTags.name, name)))
        .limit(1)

      if (existing) {
        const updated = await db
          .update(contactTags)
          .set({ color: body.color ?? existing.color, description: body.description ?? existing.description, updatedAt: new Date() })
          .where(eq(contactTags.id, existing.id))
          .returning()
        return { tag: updated[0] }
      }

      const [tag] = await db
        .insert(contactTags)
        .values({
          id,
          workspaceId: params.workspaceId,
          name,
          color: body.color ?? '#3b82f6',
          description: body.description ?? null,
        })
        .returning()

      return { tag }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        color: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  // PATCH /workspaces/:workspaceId/contacts/tags/:tagId
  .patch(
    '/workspaces/:workspaceId/contacts/tags/:tagId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(contactTags)
        .where(and(eq(contactTags.id, params.tagId), eq(contactTags.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Tag não encontrada.' } }

      const oldName = existing.name
      const newName = body.name ? body.name.trim() : existing.name

      const [updated] = await db
        .update(contactTags)
        .set({
          name: newName,
          color: body.color !== undefined ? body.color : existing.color,
          description: body.description !== undefined ? body.description : existing.description,
          updatedAt: new Date(),
        })
        .where(eq(contactTags.id, params.tagId))
        .returning()

      if (newName !== oldName) {
        await db.execute(sql`
          UPDATE contacts
          SET tags = array_replace(tags, ${oldName}, ${newName}), updated_at = NOW()
          WHERE workspace_id = ${params.workspaceId} AND ${oldName} = ANY(tags)
        `)
      }

      return { tag: updated }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        color: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  // DELETE /workspaces/:workspaceId/contacts/tags/:tagId
  .delete(
    '/workspaces/:workspaceId/contacts/tags/:tagId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(contactTags)
        .where(and(eq(contactTags.id, params.tagId), eq(contactTags.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Tag não encontrada.' } }

      await db.delete(contactTags).where(eq(contactTags.id, params.tagId))

      await db.execute(sql`
        UPDATE contacts
        SET tags = array_remove(tags, ${existing.name}), updated_at = NOW()
        WHERE workspace_id = ${params.workspaceId} AND ${existing.name} = ANY(tags)
      `)

      return { ok: true }
    },
  )


  // POST /workspaces/:workspaceId/contacts
  .post(
    '/workspaces/:workspaceId/contacts',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      if (!body.telegramChatId && !body.whatsappPhone && (!body.identities || body.identities.length === 0)) {
        set.status = 400
        return { message: 'Contato deve ter pelo menos um identificador de canal (Telegram, WhatsApp ou outro canal).' }
      }

      const isGenericName = (name: string) => !name || name.startsWith('Contato +') || name.startsWith('Contato ') || name.startsWith('Membro ')
      let finalName = body.name
      let finalAvatarUrl = body.avatarUrl ?? null
      if (body.whatsappPhone && (!finalAvatarUrl || isGenericName(finalName))) {
        try {
          const connectionId = await getActiveWhatsAppConnectionForWorkspace(params.workspaceId)
          if (connectionId) {
            const enriched = await enrichWhatsAppContact(connectionId, body.whatsappPhone, finalName)
            if (enriched.avatarUrl && !finalAvatarUrl) finalAvatarUrl = enriched.avatarUrl
            if (isGenericName(finalName) && enriched.name && !isGenericName(enriched.name)) finalName = enriched.name
          }
        } catch {}
      }

      const id = generateId()
      await db.insert(contacts).values({
        id,
        workspaceId: params.workspaceId,
        name: finalName,
        telegramChatId: body.telegramChatId ?? null,
        whatsappPhone: body.whatsappPhone ?? null,
        email: body.email ?? null,
        birthDate: body.birthDate ?? null,
        company: body.company ?? null,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        customFields: JSON.stringify(body.customFields ?? {}),
        avatarUrl: finalAvatarUrl,
        optInStatus: body.optInStatus ?? true,
        optInAt: (body.optInStatus ?? true) ? new Date() : null,
      })


      if (body.telegramChatId) {
        await db.insert(contactIdentities).values({
          id: generateId(),
          workspaceId: params.workspaceId,
          contactId: id,
          channelType: 'telegram',
          channelIdentifier: body.telegramChatId,
          isPrimary: true,
        }).onConflictDoNothing()
      }
      if (body.whatsappPhone) {
        await db.insert(contactIdentities).values({
          id: generateId(),
          workspaceId: params.workspaceId,
          contactId: id,
          channelType: 'whatsapp',
          channelIdentifier: body.whatsappPhone,
          isPrimary: true,
        }).onConflictDoNothing()
      }
      if (body.identities && Array.isArray(body.identities)) {
        for (const identity of body.identities) {
          if (identity.channelType && identity.channelIdentifier) {
            await db.insert(contactIdentities).values({
              id: generateId(),
              workspaceId: params.workspaceId,
              contactId: id,
              channelType: identity.channelType as never,
              channelIdentifier: identity.channelIdentifier,
              isPrimary: identity.isPrimary ?? false,
            }).onConflictDoNothing()
          }
        }
      }

      // Gatilhos de automação: contato novo + tags definidas no cadastro
      await handleContactCreated(params.workspaceId, id)
      if (body.tags && body.tags.length > 0) await handleTagsAdded(params.workspaceId, [id], body.tags)

      const [contact] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
      const identities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, id))
      return { contact: { ...contact, identities } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        telegramChatId: t.Optional(t.Nullable(t.String())),
        whatsappPhone: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        birthDate: t.Optional(t.Nullable(t.String())),
        company: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.Nullable(t.String())),
        avatarUrl: t.Optional(t.Nullable(t.String())),
        tags: t.Optional(t.Array(t.String())),
        customFields: t.Optional(t.Record(t.String(), t.String())),
        optInStatus: t.Optional(t.Boolean()),
        identities: t.Optional(t.Array(t.Object({
          channelType: t.String(),
          channelIdentifier: t.String(),
          isPrimary: t.Optional(t.Boolean()),
        }))),
      }),
    },
  )


  // GET /workspaces/:workspaceId/contacts/:contactId
  .get(
    '/workspaces/:workspaceId/contacts/:contactId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, params.contactId), eq(contacts.workspaceId, params.workspaceId)))
        .limit(1)

      if (!contact) { set.status = 404; return { message: 'Contato não encontrado.' } }

      const identities = await db
        .select()
        .from(contactIdentities)
        .where(and(eq(contactIdentities.contactId, contact.id), eq(contactIdentities.workspaceId, params.workspaceId)))

      return { contact: { ...contact, identities } }
    },
  )

  // PATCH /workspaces/:workspaceId/contacts/:contactId
  .patch(
    '/workspaces/:workspaceId/contacts/:contactId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, params.contactId), eq(contacts.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Contato não encontrado.' } }

      const updates: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() }
      if (body.name !== undefined) updates.name = body.name
      if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl
      if (body.telegramChatId !== undefined) updates.telegramChatId = body.telegramChatId
      if (body.whatsappPhone !== undefined) updates.whatsappPhone = body.whatsappPhone
      if (body.email !== undefined) updates.email = body.email
      if (body.birthDate !== undefined) updates.birthDate = body.birthDate
      if (body.company !== undefined) updates.company = body.company
      if (body.notes !== undefined) updates.notes = body.notes
      if (body.tags !== undefined) updates.tags = body.tags
      if (body.customFields !== undefined) updates.customFields = JSON.stringify(body.customFields)
      if (body.optInStatus !== undefined && !existing.isGroup) {
        updates.optInStatus = body.optInStatus
        if (body.optInStatus && !existing.optInStatus) updates.optInAt = new Date()
      }


      await db.update(contacts).set(updates).where(eq(contacts.id, params.contactId))

      // Tags novas acionam automações (tag_added) e o freio de mão das réguas
      if (body.tags !== undefined) {
        const addedTags = body.tags.filter((tag) => !existing.tags.includes(tag))
        if (addedTags.length > 0) await handleTagsAdded(params.workspaceId, [params.contactId], addedTags)
      }

      if (body.telegramChatId) {
        const [existingTg] = await db
          .select()
          .from(contactIdentities)
          .where(and(eq(contactIdentities.contactId, params.contactId), eq(contactIdentities.channelType, 'telegram')))
          .limit(1)
        if (existingTg) {
          await db.update(contactIdentities).set({ channelIdentifier: body.telegramChatId, updatedAt: new Date() }).where(eq(contactIdentities.id, existingTg.id))
        } else {
          await db.insert(contactIdentities).values({
            id: generateId(),
            workspaceId: params.workspaceId,
            contactId: params.contactId,
            channelType: 'telegram',
            channelIdentifier: body.telegramChatId,
            isPrimary: true,
          }).onConflictDoNothing()
        }
      }
      if (body.whatsappPhone) {
        const [existingWa] = await db
          .select()
          .from(contactIdentities)
          .where(and(eq(contactIdentities.contactId, params.contactId), eq(contactIdentities.channelType, 'whatsapp')))
          .limit(1)
        if (existingWa) {
          await db.update(contactIdentities).set({ channelIdentifier: body.whatsappPhone, updatedAt: new Date() }).where(eq(contactIdentities.id, existingWa.id))
        } else {
          await db.insert(contactIdentities).values({
            id: generateId(),
            workspaceId: params.workspaceId,
            contactId: params.contactId,
            channelType: 'whatsapp',
            channelIdentifier: body.whatsappPhone,
            isPrimary: true,
          }).onConflictDoNothing()
        }
      }

      const [updated] = await db.select().from(contacts).where(eq(contacts.id, params.contactId)).limit(1)
      const identities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, params.contactId))
      return { contact: { ...updated, identities } }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        telegramChatId: t.Optional(t.Nullable(t.String())),
        whatsappPhone: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        birthDate: t.Optional(t.Nullable(t.String())),
        company: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.Nullable(t.String())),
        avatarUrl: t.Optional(t.Nullable(t.String())),
        tags: t.Optional(t.Array(t.String())),
        customFields: t.Optional(t.Record(t.String(), t.String())),
        optInStatus: t.Optional(t.Boolean()),
      }),
    },
  )

  // POST /workspaces/:workspaceId/contacts/merge — Unificar/mesclar contatos sob um perfil canônico
  .post(
    '/workspaces/:workspaceId/contacts/merge',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      if (!body.sourceContactIds || body.sourceContactIds.length === 0) {
        set.status = 400
        return { message: 'Nenhum contato de origem selecionado para unificação.' }
      }

      if (body.sourceContactIds.includes(body.targetContactId)) {
        set.status = 400
        return { message: 'O contato canônico principal não pode estar na lista de contatos a serem mesclados.' }
      }

      const [target] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, body.targetContactId), eq(contacts.workspaceId, params.workspaceId)))
        .limit(1)

      if (!target) {
        set.status = 404
        return { message: 'Contato principal não encontrado.' }
      }

      const sources = await db
        .select()
        .from(contacts)
        .where(and(inArray(contacts.id, body.sourceContactIds), eq(contacts.workspaceId, params.workspaceId)))

      if (sources.length === 0) {
        set.status = 400
        return { message: 'Nenhum dos contatos de origem foi encontrado neste workspace.' }
      }

      const sourceIds = sources.map((s) => s.id)
      const existingIdentities = await db
        .select()
        .from(contactIdentities)
        .where(and(inArray(contactIdentities.contactId, [...sourceIds, target.id]), eq(contactIdentities.workspaceId, params.workspaceId)))

      const targetIdentityKeys = new Set(
        existingIdentities
          .filter((i) => i.contactId === target.id)
          .map((i) => `${i.channelType}:${i.channelIdentifier}`)
      )

      for (const identity of existingIdentities) {
        if (identity.contactId !== target.id) {
          const key = `${identity.channelType}:${identity.channelIdentifier}`
          if (!targetIdentityKeys.has(key)) {
            await db
              .update(contactIdentities)
              .set({ contactId: target.id, updatedAt: new Date() })
              .where(eq(contactIdentities.id, identity.id))
            targetIdentityKeys.add(key)
          } else {
            await db.delete(contactIdentities).where(eq(contactIdentities.id, identity.id))
          }
        }
      }

      const allTags = new Set<string>(target.tags)
      let mergedCustomFields: Record<string, string> = {}
      try { mergedCustomFields = JSON.parse(target.customFields) } catch {}

      let newTelegram = target.telegramChatId
      let newWhatsapp = target.whatsappPhone

      for (const src of sources) {
        for (const tag of src.tags) allTags.add(tag)
        try {
          const srcFields = JSON.parse(src.customFields)
          mergedCustomFields = { ...srcFields, ...mergedCustomFields }
        } catch {}
        if (!newTelegram && src.telegramChatId) newTelegram = src.telegramChatId
        if (!newWhatsapp && src.whatsappPhone) newWhatsapp = src.whatsappPhone
      }

      await db
        .update(contacts)
        .set({
          tags: Array.from(allTags),
          customFields: JSON.stringify(mergedCustomFields),
          telegramChatId: newTelegram,
          whatsappPhone: newWhatsapp,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, target.id))

      await db
        .update(campaignMessages)
        .set({ contactId: target.id, updatedAt: new Date() })
        .where(inArray(campaignMessages.contactId, sourceIds))

      await db.delete(contacts).where(inArray(contacts.id, sourceIds))

      const [updatedTarget] = await db.select().from(contacts).where(eq(contacts.id, target.id)).limit(1)
      const targetIdentities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, target.id))

      return {
        contact: { ...updatedTarget, identities: targetIdentities },
        mergedCount: sources.length,
      }
    },
    {
      body: t.Object({
        targetContactId: t.String({ minLength: 1 }),
        sourceContactIds: t.Array(t.String({ minLength: 1 })),
      }),
    },
  )

  // POST /workspaces/:workspaceId/contacts/:contactId/identities — Adicionar canal/identidade
  .post(
    '/workspaces/:workspaceId/contacts/:contactId/identities',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, params.contactId), eq(contacts.workspaceId, params.workspaceId)))
        .limit(1)

      if (!contact) { set.status = 404; return { message: 'Contato não encontrado.' } }

      const id = generateId()
      await db.insert(contactIdentities).values({
        id,
        workspaceId: params.workspaceId,
        contactId: params.contactId,
        channelType: body.channelType as never,
        channelIdentifier: body.channelIdentifier,
        isPrimary: body.isPrimary ?? false,
      }).onConflictDoNothing()

      if (body.channelType === 'whatsapp' && !contact.whatsappPhone) {
        await db.update(contacts).set({ whatsappPhone: body.channelIdentifier, updatedAt: new Date() }).where(eq(contacts.id, contact.id))
      } else if (body.channelType === 'telegram' && !contact.telegramChatId) {
        await db.update(contacts).set({ telegramChatId: body.channelIdentifier, updatedAt: new Date() }).where(eq(contacts.id, contact.id))
      }

      const identities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, contact.id))
      return { identities }
    },
    {
      body: t.Object({
        channelType: t.String({ minLength: 1 }),
        channelIdentifier: t.String({ minLength: 1 }),
        isPrimary: t.Optional(t.Boolean()),
      }),
    },
  )

  // DELETE /workspaces/:workspaceId/contacts/:contactId/identities/:identityId
  .delete(
    '/workspaces/:workspaceId/contacts/:contactId/identities/:identityId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      await db
        .delete(contactIdentities)
        .where(and(
          eq(contactIdentities.id, params.identityId),
          eq(contactIdentities.contactId, params.contactId),
          eq(contactIdentities.workspaceId, params.workspaceId),
        ))

      return { message: 'Identidade removida.' }
    },
  )

  // DELETE /workspaces/:workspaceId/contacts/:contactId
  .delete(
    '/workspaces/:workspaceId/contacts/:contactId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [existing] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, params.contactId), eq(contacts.workspaceId, params.workspaceId)))
        .limit(1)

      if (!existing) { set.status = 404; return { message: 'Contato não encontrado.' } }

      await db.delete(contactIdentities).where(eq(contactIdentities.contactId, params.contactId))
      await db.delete(campaignMessages).where(eq(campaignMessages.contactId, params.contactId))
      await db.delete(contacts).where(eq(contacts.id, params.contactId))
      return { message: 'Contato removido.' }
    },
  )

  // DELETE /workspaces/:workspaceId/contacts — bulk delete
  .delete(
    '/workspaces/:workspaceId/contacts',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      if (!body.ids || body.ids.length === 0) {
        set.status = 400
        return { message: 'Nenhum ID fornecido.' }
      }

      await db
        .delete(contactIdentities)
        .where(
          and(
            inArray(contactIdentities.contactId, body.ids),
            eq(contactIdentities.workspaceId, params.workspaceId),
          ),
        )

      const workspaceCampaignIds = db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.workspaceId, params.workspaceId))

      await db
        .delete(campaignMessages)
        .where(
          and(
            inArray(campaignMessages.contactId, body.ids),
            inArray(campaignMessages.campaignId, workspaceCampaignIds),
          ),
        )

      await db
        .delete(contacts)
        .where(and(inArray(contacts.id, body.ids), eq(contacts.workspaceId, params.workspaceId)))

      return { message: `${body.ids.length} contato(s) removido(s).` }
    },
    { body: t.Object({ ids: t.Array(t.String()) }) },
  )

  // POST /workspaces/:workspaceId/contacts/:contactId/sync-members
  .post(
    '/workspaces/:workspaceId/contacts/:contactId/sync-members',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [gc] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, params.contactId), eq(contacts.workspaceId, params.workspaceId)))
        .limit(1)

      if (!gc || !gc.isGroup) {
        set.status = 404
        return { message: 'Grupo não encontrado.' }
      }

      const groupJid = gc.whatsappPhone || gc.telegramChatId
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        set.status = 400
        return { message: 'Sincronização de membros suportada no momento apenas para grupos de WhatsApp.' }
      }

      const connectionId = await getActiveWhatsAppConnectionForWorkspace(params.workspaceId)
      if (!connectionId) {
        set.status = 400
        return { message: 'Nenhuma conexão do WhatsApp ativa no workspace para buscar os membros do grupo.' }
      }

      const participantsList = await getGroupParticipants(connectionId, groupJid)
      if (participantsList.length === 0) {
        set.status = 400
        return { message: 'Não foi possível buscar a lista de participantes ou o grupo está vazio.' }
      }

      let importedCount = 0
      let updatedCount = 0

      const enrichedMap = await batchEnrichWhatsAppContacts(
        connectionId,
        participantsList.map((p) => {
          const phone = resolveParticipantPhone(p)
          const id = (p.id && !p.id.endsWith('@lid'))
            ? p.id
            : (phone ? `${phone}@s.whatsapp.net` : p.id)
          return { id: id || phone || p.id || '', name: p.name, avatarUrl: (p as any).avatarUrl || null }
        }).filter(x => x.id),
      )

      for (const p of participantsList) {
        if (!p.id || p.id.endsWith('@g.us')) continue
        const phone = resolveParticipantPhone(p)
        if (!phone) continue

        const normalizedJid = p.id.endsWith('@lid') ? `${phone}@s.whatsapp.net` : p.id
        const enriched = enrichedMap.get(normalizedJid) || enrichedMap.get(p.id) || enrichedMap.get(`${phone}@s.whatsapp.net`)
        const isGenericName = (name: string) => !name || name.startsWith('Contato +') || name.startsWith('Contato ') || name.startsWith('Membro ') || name === phone || name === `+${phone}`
        const resolvedName = enriched?.name && !isGenericName(enriched.name)
          ? enriched.name
          : await resolveWhatsAppContactName(connectionId, p.id, p.name || null)
        const avatarUrl = enriched?.avatarUrl || (p as any).avatarUrl || null

        const [existing] = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.whatsappPhone, phone), eq(contacts.isGroup, false)))
          .limit(1)

        const groupTag = `grupo:${gc.name}`
        if (existing) {
          const mergedTags = Array.from(new Set([...existing.tags, 'origem:grupo', groupTag]))
          const updates: Record<string, unknown> = { tags: mergedTags, updatedAt: new Date() }
          if (isGenericName(existing.name) && !isGenericName(resolvedName)) {
            updates.name = resolvedName
          }
          if (avatarUrl && existing.avatarUrl !== avatarUrl) {
            updates.avatarUrl = avatarUrl
          }
          await db.update(contacts).set(updates).where(eq(contacts.id, existing.id))
          updatedCount++
        } else {
          const newId = generateId()
          await db.insert(contacts).values({
            id: newId,
            workspaceId: params.workspaceId,
            name: resolvedName,
            whatsappPhone: phone,
            avatarUrl: avatarUrl || null,
            tags: ['origem:grupo', groupTag],
            isGroup: false,
            optInStatus: true,
            optInAt: new Date(),
          })

          await db.insert(contactIdentities).values({
            id: generateId(),
            workspaceId: params.workspaceId,
            contactId: newId,
            channelType: 'whatsapp',
            channelIdentifier: phone,
            isPrimary: true,
          }).onConflictDoNothing()

          importedCount++
        }
      }

      let groupAvatar = gc.avatarUrl
      let groupName = gc.name
      try {
        const enrichedGroup = await enrichWhatsAppContact(connectionId, groupJid, gc.name)
        if (enrichedGroup.avatarUrl) groupAvatar = enrichedGroup.avatarUrl
        if (enrichedGroup.name && enrichedGroup.name !== `Contato +${groupJid}`) groupName = enrichedGroup.name
      } catch {}

      const customData = {
        isGroup: 'true',
        participantsCount: String(participantsList.length),
        participants: JSON.stringify(participantsList.map((p) => ({
          id: p.id || '',
          phoneNumber: resolveParticipantPhone(p) || null,
        }))),
      }

      await db
        .update(contacts)
        .set({
          name: groupName,
          avatarUrl: groupAvatar || null,
          customFields: JSON.stringify(customData),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, gc.id))

      return {
        importedCount,
        updatedCount,
        totalParticipants: participantsList.length,
        message: `${importedCount} novos contatos criados e ${updatedCount} atualizados a partir do grupo "${groupName}".`,
      }
    },
  )

  // POST /workspaces/:workspaceId/contacts/import — CSV import
  .post(
    '/workspaces/:workspaceId/contacts/import',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const rows = parseCSV(body.csv)
      return importContactRows(params.workspaceId, rows, { onDuplicate: body.onDuplicate ?? 'skip' })
    },
    {
      body: t.Object({
        csv: t.String(),
        onDuplicate: t.Optional(t.Union([t.Literal('skip'), t.Literal('update')])),
      }),
    },
  )

  // POST /workspaces/:workspaceId/contacts/import-file — upload csv/xlsx.
  // Todos os contatos do arquivo (novos e existentes) recebem uma tag gerada
  // 'import:<slug>-<data>' — a audiência da campanha vira um filtro por ela.
  .post(
    '/workspaces/:workspaceId/contacts/import-file',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const file = body.file
      const filename = file.name || 'arquivo'
      const isXlsx = /\.xlsx?$/i.test(filename) || file.type.includes('spreadsheet') || file.type.includes('ms-excel')

      let rows: Array<Record<string, string>>
      try {
        if (isXlsx) {
          const XLSX = await import('xlsx')
          const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) { set.status = 400; return { message: 'Planilha vazia.' } }
          rows = XLSX.utils
            .sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]!, { raw: false, defval: '' })
            .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])))
        } else {
          rows = parseCSV(await file.text())
        }
      } catch (err) {
        set.status = 400
        return { message: sanitizeErrorMessage(err, 'Não foi possível ler o arquivo. Use CSV ou XLSX com cabeçalho.') }
      }

      if (rows.length === 0) { set.status = 400; return { message: 'Nenhuma linha encontrada no arquivo (o cabeçalho é obrigatório).' } }

      const dateKey = new Date().toISOString().slice(0, 10)
      const tag = `import:${slugify(filename.replace(/\.\w+$/, '')) || 'arquivo'}-${dateKey}`

      const result = await importContactRows(params.workspaceId, rows, {
        onDuplicate: body.onDuplicate ?? 'skip',
        extraTags: [tag],
      })

      // Contatos que o import pulou por duplicidade também recebem a tag
      const phones = rows.map((r) => r.whatsapp_phone ?? r.whatsapp ?? r.phone ?? r.telefone ?? '').filter(Boolean)
      const telegramIds = rows.map((r) => r.telegram_chat_id ?? r.telegram ?? '').filter(Boolean)
      await applyTagToIdentifiers(params.workspaceId, tag, { phones, telegramIds })

      return { ...result, tag }
    },
    {
      body: t.Object({
        file: t.File(),
        onDuplicate: t.Optional(t.Union([t.Literal('skip'), t.Literal('update')])),
      }),
    },
  )

  // POST /workspaces/:workspaceId/contacts/bulk-upsert — público manual do
  // wizard: linhas nome+telefone digitadas, upsert por whatsapp_phone.
  .post(
    '/workspaces/:workspaceId/contacts/bulk-upsert',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.contacts) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const tags = [...new Set(['origem:manual', ...(body.tags ?? [])])]
      let created = 0
      let updated = 0
      let failed = 0
      const errors: string[] = []
      const contactIds: string[] = []

      for (const row of body.rows) {
        const phone = row.phone.replace(/\D/g, '')
        if (phone.length < 8 || phone.length > 15) {
          failed++
          errors.push(`${row.name || row.phone}: número inválido`)
          continue
        }
        try {
          const [existing] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.whatsappPhone, phone)))
            .limit(1)

          if (existing) {
            await db
              .update(contacts)
              .set({
                name: row.name || undefined,
                tags: sql`(SELECT array_agg(DISTINCT t) FROM unnest(${contacts.tags} || ${tags}::text[]) AS t)`,
                updatedAt: new Date(),
              })
              .where(eq(contacts.id, existing.id))
            contactIds.push(existing.id)
            updated++
          } else {
            const newId = generateId()
            await db.insert(contacts).values({
              id: newId,
              workspaceId: params.workspaceId,
              name: row.name || `Contato +${phone}`,
              whatsappPhone: phone,
              tags,
              optInStatus: true,
              optInAt: new Date(),
            })
            await db.insert(contactIdentities).values({
              id: generateId(),
              workspaceId: params.workspaceId,
              contactId: newId,
              channelType: 'whatsapp',
              channelIdentifier: phone,
              isPrimary: true,
            }).onConflictDoNothing()
            contactIds.push(newId)
            created++
          }
        } catch (err) {
          failed++
          errors.push(`${row.name || row.phone}: ${sanitizeErrorMessage(err, 'erro ao salvar contato')}`)
        }
      }

      return { created, updated, failed, errors, contactIds, tags }
    },
    {
      body: t.Object({
        rows: t.Array(
          t.Object({
            name: t.String(),
            phone: t.String({ minLength: 1 }),
          }),
          { minItems: 1 },
        ),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )
