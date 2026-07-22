import { Elysia, t } from 'elysia'
import { db, connections, contacts, contactIdentities, entitlements } from '@naia/db'
import { eq, and, count } from 'drizzle-orm'
import { canAddConnection } from '@naia/entitlements'
import { sanitizeErrorMessage } from '@naia/schemas'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'
import { isTelegramUserConfig, resolveApiCredentials } from '../lib/telegram-helpers'
import {
  startWhatsAppSession,
  startTelegramUserLogin,
  submitTelegramCode,
  submitTelegramPassword,
  reconnectSession,
  disconnectSession,
  getSessionStatus,
  fetchWhatsAppContacts,
  fetchWhatsAppGroups,
  fetchTelegramUserContacts,
  fetchTelegramUserGroups,
  getGroupParticipants,
  importTelegramGroupMembers,
  enrichWhatsAppContact,
  batchEnrichWhatsAppContacts,
  resolveWhatsAppContactName,
} from '@naia/session-host-client'


/**
 * Resolve a usable WhatsApp phone number from a group participant object.
 * Modern Baileys returns participants in @lid (Linked Identity) format instead
 * of @s.whatsapp.net. When the id ends with @lid, the actual phone number lives
 * in the separate `phoneNumber` field (format: "5511999999999@s.whatsapp.net").
 */
function resolveParticipantPhone(p: { id: string; phoneNumber?: string | null; name?: string | null }): string | null {
  // If participant has a phoneNumber field (provided by Baileys for @lid participants), use it
  if (p.phoneNumber) {
    const pn = p.phoneNumber.replace(/@.*$/, '').replace(/\D/g, '')
    if (pn && pn.length >= 8 && pn.length <= 15) return pn
  }
  // If participant id is @s.whatsapp.net, extract the phone directly
  if (p.id && p.id.endsWith('@s.whatsapp.net')) {
    const phone = p.id.replace(/@.*$/, '').replace(/\D/g, '')
    if (phone && phone.length >= 8 && phone.length <= 15) return phone
  }
  // @lid without phoneNumber — cannot resolve to a real phone number
  if (p.id && p.id.endsWith('@lid')) return null
  // Fallback: try to use id as-is if it looks like a valid E.164 phone number
  if (p.id && !p.id.includes('@')) {
    const phone = p.id.replace(/\D/g, '')
    if (phone && phone.length >= 8 && phone.length <= 15) return phone
  }
  return null
}

async function hostIdForWorkspace(workspaceId: string): Promise<'base' | 'scale'> {
  const [ent] = await db.select({ tier: entitlements.tier }).from(entitlements).where(eq(entitlements.workspaceId, workspaceId)).limit(1)
  return ent?.tier === 'scale' ? 'scale' : 'base'
}

export const connectionRoutes = new Elysia()
  .use(authPlugin)

  // GET /workspaces/:workspaceId/connections
  .get(
    '/workspaces/:workspaceId/connections',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const rows = await db
        .select()
        .from(connections)
        .where(eq(connections.workspaceId, params.workspaceId))
        .orderBy(connections.createdAt)

      const statuses = await Promise.all(
        rows.map(async (c) => {
          try {
            return await getSessionStatus(c.id)
          } catch {
            return { socketStatus: 'disconnected' as const, qr: null, telegramAuth: null }
          }
        }),
      )

      return {
        connections: rows.map((c, i) => {
          const status = statuses[i]!
          const isTgUser = c.channel === 'telegram' && isTelegramUserConfig(c.config)
          return {
            ...c,
            config: undefined,
            kind: c.channel === 'telegram' ? ('user' as const) : null,
            qr: c.status === 'disconnected' && c.channel === 'whatsapp' ? status.qr : null,
            socketStatus: c.channel === 'whatsapp' ? status.socketStatus : isTgUser ? status.socketStatus : null,
            telegramAuth: isTgUser ? status.telegramAuth : null,
          }
        }),
      }
    },
  )

  // POST /workspaces/:workspaceId/connections/telegram-user — conta pessoal (MTProto)
  .post(
    '/workspaces/:workspaceId/connections/telegram-user',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [countResult] = await db
        .select({ count: count() })
        .from(connections)
        .where(eq(connections.workspaceId, params.workspaceId))

      const check = canAddConnection(ctx.entitlements, countResult?.count ?? 0)
      if (!check.allowed) { set.status = 403; return { message: check.reason } }

      const phone = body.phone.replace(/[^\d+]/g, '')
      if (phone.replace(/\D/g, '').length < 8) {
        set.status = 400; return { message: 'Número de telefone inválido.' }
      }

      if (!resolveApiCredentials()) {
        set.status = 503
        return { message: 'Integração do Telegram indisponível — credenciais de API não configuradas no servidor.' }
      }

      const connectionId = generateId()
      await db.insert(connections).values({
        id: connectionId,
        workspaceId: params.workspaceId,
        channel: 'telegram',
        name: body.name,
        status: 'disconnected',
        config: JSON.stringify({ kind: 'user', phone }),
      })

      // Login MTProto em background — o frontend acompanha via telegramAuth
      const hostId = await hostIdForWorkspace(params.workspaceId)
      startTelegramUserLogin(connectionId, hostId).catch(console.error)

      const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1)
      return { connection: { ...conn, config: undefined } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        phone: t.String({ minLength: 8 }),
      }),
    },
  )

  // POST /workspaces/:workspaceId/connections/:connectionId/telegram-code
  .post(
    '/workspaces/:workspaceId/connections/:connectionId/telegram-code',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select({ id: connections.id })
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)
      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      try {
        await submitTelegramCode(conn.id, body.code)
        return { message: 'Código recebido — validando...' }
      } catch {
        set.status = 400
        return { message: 'Nenhum login aguardando código para esta conexão.' }
      }
    },
    { body: t.Object({ code: t.String({ minLength: 1 }) }) },
  )

  // POST /workspaces/:workspaceId/connections/:connectionId/telegram-password
  .post(
    '/workspaces/:workspaceId/connections/:connectionId/telegram-password',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select({ id: connections.id })
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)
      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      try {
        await submitTelegramPassword(conn.id, body.password)
        return { message: 'Senha recebida — validando...' }
      } catch {
        set.status = 400
        return { message: 'Nenhum login aguardando senha 2FA para esta conexão.' }
      }
    },
    { body: t.Object({ password: t.String({ minLength: 1 }) }) },
  )

  // POST /workspaces/:workspaceId/connections/whatsapp
  .post(
    '/workspaces/:workspaceId/connections/whatsapp',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      if (!body.acceptTerms || !body.acceptResponsibleUse) {
        set.status = 400
        return { message: 'Confirme os termos e as práticas de uso responsável antes de conectar o WhatsApp.' }
      }

      const [countResult] = await db
        .select({ count: count() })
        .from(connections)
        .where(eq(connections.workspaceId, params.workspaceId))

      const check = canAddConnection(ctx.entitlements, countResult?.count ?? 0)
      if (!check.allowed) { set.status = 403; return { message: check.reason } }

      const connectionId = generateId()

      await db.insert(connections).values({
        id: connectionId,
        workspaceId: params.workspaceId,
        channel: 'whatsapp',
        name: body.name,
        status: 'disconnected',
        config: '{}',
        termsAcceptedAt: new Date(),
        termsAcceptedByUserId: session!.userId,
        termsVersion: 'whatsapp-baileys-v1',
      })

      // Sessão Baileys em background (gera o QR code).
      const hostId = await hostIdForWorkspace(params.workspaceId)
      startWhatsAppSession(connectionId, hostId).catch(console.error)

      const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1)
      return { connection: { ...conn, config: undefined } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        acceptTerms: t.Literal(true),
        acceptResponsibleUse: t.Literal(true),
      }),
    },
  )

  // GET /workspaces/:workspaceId/connections/:connectionId
  .get(
    '/workspaces/:workspaceId/connections/:connectionId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      const isTgUser = conn.channel === 'telegram' && isTelegramUserConfig(conn.config)
      const status = await getSessionStatus(conn.id).catch(() => ({ socketStatus: 'disconnected' as const, qr: null, telegramAuth: null }))
      return {
        connection: {
          ...conn,
          config: undefined,
          kind: conn.channel === 'telegram' ? ('user' as const) : null,
          qr: conn.channel === 'whatsapp' ? status.qr : null,
          socketStatus: conn.channel === 'whatsapp' ? status.socketStatus : isTgUser ? status.socketStatus : null,
          telegramAuth: isTgUser ? status.telegramAuth : null,
        },
      }
    },
  )

  // PATCH /workspaces/:workspaceId/connections/:connectionId
  .patch(
    '/workspaces/:workspaceId/connections/:connectionId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      await db
        .update(connections)
        .set({ name: body.name, updatedAt: new Date() })
        .where(eq(connections.id, params.connectionId))

      const [updated] = await db.select().from(connections).where(eq(connections.id, params.connectionId)).limit(1)
      return { connection: { ...updated, config: undefined } }
    },
    { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  )

  // POST /workspaces/:workspaceId/connections/:connectionId/reconnect (WhatsApp only)
  .post(
    '/workspaces/:workspaceId/connections/:connectionId/reconnect',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }
      const isTgUser = conn.channel === 'telegram' && isTelegramUserConfig(conn.config)
      if (conn.channel !== 'whatsapp' && !isTgUser) { set.status = 400; return { message: 'Apenas conexões WhatsApp ou de conta do Telegram podem ser reconectadas aqui.' } }

      if (conn.status !== 'active') {
        const [activeCountResult] = await db
          .select({ count: count() })
          .from(connections)
          .where(and(eq(connections.workspaceId, params.workspaceId), eq(connections.status, 'active')))

        const check = canAddConnection(ctx.entitlements, activeCountResult?.count ?? 0)
        if (!check.allowed) {
          set.status = 403
          return { message: check.reason }
        }
      }

      try {
        await reconnectSession(conn.id, { channel: conn.channel as 'whatsapp' | 'telegram' })
      } catch (err) {
        console.error(`[connections] falha ao reconectar ${conn.id}:`, err)
      }

      return { message: 'Reconexão iniciada.' }
    },
  )

  // DELETE /workspaces/:workspaceId/connections/:connectionId
  .delete(
    '/workspaces/:workspaceId/connections/:connectionId',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      const isTgUser = conn.channel === 'telegram' && isTelegramUserConfig(conn.config)
      try {
        await disconnectSession(conn.id, { channel: conn.channel as 'whatsapp' | 'telegram', logout: isTgUser })
      } catch (err) {
        console.error(`[connections] falha ao desconectar ${conn.id}:`, err)
      }

      await db.delete(connections).where(eq(connections.id, conn.id))

      return { message: 'Conexão removida.' }
    },
  )

  // GET /workspaces/:workspaceId/connections/:connectionId/contacts-sync
  .get(
    '/workspaces/:workspaceId/connections/:connectionId/contacts-sync',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      if (conn.channel === 'whatsapp') {
        const list = await fetchWhatsAppContacts(conn.id)
        return { contacts: list }
      }

      if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
        try {
          const list = await fetchTelegramUserContacts(conn.id)
          return { contacts: list }
        } catch (err) {
          set.status = 400
          return { message: sanitizeErrorMessage(err, 'Falha ao buscar contatos no Telegram.') }
        }
      }

      const rows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.isGroup, false)))

      return {
        contacts: rows
          .filter((r) => r.telegramChatId || r.whatsappPhone)
          .map((r) => ({
            id: r.id,
            name: r.name,
            phone: r.whatsappPhone || r.telegramChatId || '',
          })),
      }
    },
  )

  // GET /workspaces/:workspaceId/connections/:connectionId/groups-sync
  .get(
    '/workspaces/:workspaceId/connections/:connectionId/groups-sync',
    async ({ session, params, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      if (conn.channel === 'whatsapp') {
        try {
          const list = await fetchWhatsAppGroups(conn.id)
          return { groups: list }
        } catch (err) {
          set.status = 400
          return { message: sanitizeErrorMessage(err, 'Falha ao buscar grupos no WhatsApp.') }
        }
      }

      if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
        try {
          const list = await fetchTelegramUserGroups(conn.id)
          return { groups: list }
        } catch (err) {
          set.status = 400
          return { message: sanitizeErrorMessage(err, 'Falha ao buscar grupos no Telegram.') }
        }
      }

      return { groups: [] }
    },
  )

  // POST /workspaces/:workspaceId/connections/:connectionId/import-contacts
  .post(
    '/workspaces/:workspaceId/connections/:connectionId/import-contacts',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      let importedCount = 0
      let updatedCount = 0

      const isWa = conn.channel === 'whatsapp'
      const isTg = conn.channel === 'telegram'
      const enrichedMap = isWa
        ? await batchEnrichWhatsAppContacts(conn.id, body.contacts.map(c => ({ id: c.phoneOrId, name: c.name, avatarUrl: c.avatarUrl })))
        : new Map<string, { name: string; avatarUrl: string | null }>()

      for (const item of body.contacts) {
        const phoneOrId = item.phoneOrId.trim()
        if (!phoneOrId) continue

        const [existing] = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, params.workspaceId),
              isWa ? eq(contacts.whatsappPhone, phoneOrId) : eq(contacts.telegramChatId, phoneOrId),
            ),
          )
          .limit(1)

        const enriched = enrichedMap.get(phoneOrId) || enrichedMap.get(`${phoneOrId}@s.whatsapp.net`)
        const isGeneric = (name: string) => !name || name.startsWith('Contato +') || name.startsWith('Contato ') || name.startsWith('Membro ') || name === phoneOrId || name === `+${phoneOrId}`
        const resolvedName = isWa
          ? (enriched?.name && !isGeneric(enriched.name) ? enriched.name : await resolveWhatsAppContactName(conn.id, phoneOrId, item.name || null))
          : (item.name || `Contato ${phoneOrId}`)
        const avatarUrl = enriched?.avatarUrl || item.avatarUrl || null

        if (existing) {
          const mergedTags = Array.from(new Set([...existing.tags, ...(body.tags || [])]))
          const updates: Record<string, unknown> = { tags: mergedTags, updatedAt: new Date() }
          if (isGeneric(existing.name) && !isGeneric(resolvedName)) {
            updates.name = resolvedName
          }
          if (avatarUrl && existing.avatarUrl !== avatarUrl) {
            updates.avatarUrl = avatarUrl
          }
          await db
            .update(contacts)
            .set(updates)
            .where(eq(contacts.id, existing.id))
          updatedCount++
        } else {
          const newId = generateId()
          await db.insert(contacts).values({
            id: newId,
            workspaceId: params.workspaceId,
            name: resolvedName,
            whatsappPhone: isWa ? phoneOrId : null,
            telegramChatId: isTg ? phoneOrId : null,
            avatarUrl: avatarUrl || null,
            tags: body.tags || [],
            isGroup: false,
            optInStatus: true,
            optInAt: new Date(),
          })

          await db.insert(contactIdentities).values({
            id: generateId(),
            workspaceId: params.workspaceId,
            contactId: newId,
            channelType: conn.channel,
            channelIdentifier: phoneOrId,
            isPrimary: true,
          }).onConflictDoNothing()

          importedCount++
        }
      }

      return { importedCount, updatedCount }
    },
    {
      body: t.Object({
        contacts: t.Array(
          t.Object({
            name: t.String(),
            phoneOrId: t.String(),
            avatarUrl: t.Optional(t.Nullable(t.String())),
          }),
        ),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )

  // POST /workspaces/:workspaceId/connections/:connectionId/import-groups
  .post(
    '/workspaces/:workspaceId/connections/:connectionId/import-groups',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      let importedGroupsCount = 0

      for (const group of body.groups) {
        const groupId = group.id.trim()
        if (!groupId) continue

        const isWa = conn.channel === 'whatsapp'
        const isTg = conn.channel === 'telegram'

        const [existing] = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, params.workspaceId),
              isWa ? eq(contacts.whatsappPhone, groupId) : eq(contacts.telegramChatId, groupId),
              eq(contacts.isGroup, true),
            ),
          )
          .limit(1)

        let avatarUrl: string | null = existing?.avatarUrl || null
        let groupSubject = group.subject
        if (isWa && groupId.endsWith('@g.us')) {
          try {
            const enriched = await enrichWhatsAppContact(conn.id, groupId, groupSubject)
            if (enriched.avatarUrl) avatarUrl = enriched.avatarUrl
            if (enriched.name && enriched.name !== `Contato +${groupId}`) groupSubject = enriched.name
          } catch {}
        }

        const customData = {
          isGroup: 'true',
          participantsCount: String(group.size ?? group.participants?.length ?? 0),
          desc: group.desc ?? '',
          participants: JSON.stringify((group.participants ?? []).map((p: any) => ({
            id: p.id ?? '',
            admin: p.admin ?? null,
            phoneNumber: p.phoneNumber ?? null,
          }))),
        }

        if (existing) {
          const mergedTags = Array.from(new Set([...existing.tags, ...(body.tags || []), 'grupo']))
          await db
            .update(contacts)
            .set({
              name: groupSubject,
              avatarUrl: avatarUrl || existing.avatarUrl || null,
              tags: mergedTags,
              customFields: JSON.stringify(customData),
              updatedAt: new Date(),
            })
            .where(eq(contacts.id, existing.id))
        } else {
          const newId = generateId()
          await db.insert(contacts).values({
            id: newId,
            workspaceId: params.workspaceId,
            name: groupSubject || `Grupo ${groupId}`,
            whatsappPhone: isWa ? groupId : null,
            telegramChatId: isTg ? groupId : null,
            avatarUrl: avatarUrl || null,
            tags: ['grupo', ...(body.tags || [])],
            customFields: JSON.stringify(customData),
            isGroup: true,
            optInStatus: true,
            optInAt: new Date(),
          })

          await db.insert(contactIdentities).values({
            id: generateId(),
            workspaceId: params.workspaceId,
            contactId: newId,
            channelType: conn.channel,
            channelIdentifier: groupId,
            isPrimary: true,
          }).onConflictDoNothing()

          importedGroupsCount++
        }
      }

      return { importedGroupsCount }
    },
    {
      body: t.Object({
        groups: t.Array(
          t.Object({
            id: t.String(),
            subject: t.String(),
            size: t.Optional(t.Number()),
            desc: t.Optional(t.String()),
            participants: t.Optional(
              t.Array(
                t.Object({
                  id: t.String(),
                  admin: t.Optional(t.Nullable(t.String())),
                  phoneNumber: t.Optional(t.Nullable(t.String())),
                }),
              ),
            ),
          }),
        ),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )

  // POST /workspaces/:workspaceId/connections/:connectionId/import-group-members
  .post(
    '/workspaces/:workspaceId/connections/:connectionId/import-group-members',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (!ctx.permissions.connections) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }
      if (ctx.role === 'member') { set.status = 403; return { message: 'Requer permissão de admin ou owner.' } }

      const [conn] = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, params.connectionId), eq(connections.workspaceId, params.workspaceId)))
        .limit(1)

      if (!conn) { set.status = 404; return { message: 'Conexão não encontrada.' } }

      if (conn.channel === 'telegram' && isTelegramUserConfig(conn.config)) {
        try {
          return await importTelegramGroupMembers(conn.id, params.workspaceId, body.groupJid, body.tags || [])
        } catch (err) {
          set.status = 400
          return { message: sanitizeErrorMessage(err, 'Falha ao importar membros do grupo no Telegram.') }
        }
      }

      let participantsList = await getGroupParticipants(conn.id, body.groupJid)
      if (participantsList.length === 0) {
        const [groupContact] = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, params.workspaceId),
              eq(contacts.whatsappPhone, body.groupJid),
              eq(contacts.isGroup, true),
            ),
          )
          .limit(1)

        if (groupContact) {
          try {
            const meta = JSON.parse(groupContact.customFields)
            if (meta.participants) {
              participantsList = JSON.parse(meta.participants)
            }
          } catch {}
        }
      }

      let importedMembersCount = 0
      let skippedLidCount = 0

      const enrichedMap = await batchEnrichWhatsAppContacts(
        conn.id,
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
        if (!phone) {
          if (p.id.endsWith('@lid')) skippedLidCount++
          continue
        }

        const normalizedJid = p.id.endsWith('@lid') ? `${phone}@s.whatsapp.net` : p.id
        const enriched = enrichedMap.get(normalizedJid) || enrichedMap.get(p.id) || enrichedMap.get(`${phone}@s.whatsapp.net`)
        const isGenericName = (name: string) => !name || name.startsWith('Contato +') || name.startsWith('Contato ') || name.startsWith('Membro ') || name === phone || name === `+${phone}`
        const resolvedName = enriched?.name && !isGenericName(enriched.name)
          ? enriched.name
          : await resolveWhatsAppContactName(conn.id, p.id, p.name || null)
        const avatarUrl = enriched?.avatarUrl || (p as any).avatarUrl || null

        const [existing] = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.whatsappPhone, phone)))
          .limit(1)

        if (existing) {
          const updates: Record<string, unknown> = { updatedAt: new Date() }
          if (isGenericName(existing.name) && !isGenericName(resolvedName)) {
            updates.name = resolvedName
          }
          if (avatarUrl && existing.avatarUrl !== avatarUrl) {
            updates.avatarUrl = avatarUrl
          }
          if (Object.keys(updates).length > 1) {
            await db.update(contacts).set(updates).where(eq(contacts.id, existing.id))
          }
        } else {
          const newId = generateId()
          await db.insert(contacts).values({
            id: newId,
            workspaceId: params.workspaceId,
            name: resolvedName,
            whatsappPhone: phone,
            avatarUrl: avatarUrl || null,
            tags: ['origem:grupo', ...(body.tags || [])],
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

          importedMembersCount++
        }
      }

      return {
        importedMembersCount,
        ...(skippedLidCount > 0 ? {
          warning: `${skippedLidCount} membro(s) usam o formato de identidade vinculada (LID) do WhatsApp e não puderam ter o número de telefone resolvido. Reconecte a sessão do WhatsApp e tente novamente para obter os números reais.`,
        } : {}),
      }
    },
    {
      body: t.Object({
        groupJid: t.String(),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )
