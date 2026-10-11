import fs from 'node:fs'
import path from 'node:path'
import { db, connections, contacts, contactIdentities, whatsappSessions, whatsappContactsCache } from '@naia/db'
import { eq, and, or, sql } from 'drizzle-orm'
import { getQueue, QUEUES, defaultJobOptions } from '@naia/queue'
import type { StatusWebhookJob } from '@naia/schemas'
import { usePostgresAuthState } from './use-postgres-auth-state'
import { notifyWorkspaceOwner, NAIA_WEB_URL } from './vianova-notifications'

type QREntry = { qr: string; expiresAt: Date }
type SocketEntry = { status: 'connecting' | 'connected' | 'disconnected'; socket: unknown }

const qrMap = new Map<string, QREntry>()
export const socketMap = new Map<string, SocketEntry>()
export const contactCache = new Map<string, Map<string, { id: string; name: string; phone: string; avatarUrl?: string | null }>>()
const saveContactsTimeoutMap = new Map<string, NodeJS.Timeout>()

function getContactsCachePath(connectionId: string): string {
  return path.join(getSessionDir(connectionId), 'contacts-cache.json')
}

async function loadContactsFromDatabase(connectionId: string): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(whatsappContactsCache)
      .where(eq(whatsappContactsCache.connectionId, connectionId))

    if (!contactCache.has(connectionId)) {
      contactCache.set(connectionId, new Map())
    }
    const map = contactCache.get(connectionId)!

    for (const row of rows) {
      if (row?.contactJid && row?.phone) {
        map.set(row.contactJid, { id: row.contactJid, name: row.name, phone: row.phone, avatarUrl: row.avatarUrl || null })
      }
    }

    if (rows.length === 0) {
      const filePath = getContactsCachePath(connectionId)
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8')
          const list = JSON.parse(raw) as Array<{ id: string; name: string; phone: string }>
          if (Array.isArray(list) && list.length > 0) {
            console.log(`[whatsapp-manager] Migrando cache de contatos do disco para Postgres: ${list.length} contatos (${connectionId})`)
            const values = list
              .filter((item) => item?.id && item?.phone)
              .map((item) => ({
                connectionId,
                contactJid: item.id,
                name: item.name || `Contato +${item.phone}`,
                phone: item.phone,
                updatedAt: new Date(),
              }))
            for (let i = 0; i < values.length; i += 100) {
              const chunk = values.slice(i, i + 100)
              await db.insert(whatsappContactsCache).values(chunk).onConflictDoNothing()
            }
            for (const item of list) {
              if (item?.id && item?.phone) {
                map.set(item.id, { ...item, avatarUrl: (item as any).avatarUrl || null })
              }
            }
          }
        } catch (e) {
          console.error(`[whatsapp-manager] Erro ao migrar cache de contatos do disco (${connectionId}):`, e)
        }
      }
    }
  } catch (err) {
    console.error(`[whatsapp-manager] Erro ao carregar cache de contatos para ${connectionId}:`, err)
  }
}

function scheduleSaveContactsToDatabase(connectionId: string): void {
  if (saveContactsTimeoutMap.has(connectionId)) return
  const timeout = setTimeout(async () => {
    saveContactsTimeoutMap.delete(connectionId)
    try {
      const map = contactCache.get(connectionId)
      if (!map) return
      const list = Array.from(map.values()).filter((c) => c?.id && c?.phone)
      if (list.length === 0) return

      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100).map((c) => ({
          connectionId,
          contactJid: c.id,
          name: c.name || `Contato +${c.phone}`,
          phone: c.phone,
          avatarUrl: c.avatarUrl || null,
          updatedAt: new Date(),
        }))
        await db
          .insert(whatsappContactsCache)
          .values(chunk)
          .onConflictDoUpdate({
            target: [whatsappContactsCache.connectionId, whatsappContactsCache.contactJid],
            set: {
              name: sql`CASE WHEN excluded.name LIKE 'Contato +%' OR excluded.name LIKE 'Contato %' OR excluded.name LIKE 'Membro %' THEN whatsapp_contacts_cache.name ELSE excluded.name END`,
              phone: sql`excluded.phone`,
              avatarUrl: sql`coalesce(excluded.avatar_url, whatsapp_contacts_cache.avatar_url)`,
              updatedAt: new Date(),
            },
          })
      }
    } catch (err) {
      console.error(`[whatsapp-manager] Erro ao salvar cache de contatos no banco para ${connectionId}:`, err)
    }
  }, 2000)
  saveContactsTimeoutMap.set(connectionId, timeout)
}

function upsertContactToCache(connectionId: string, id: unknown, nameCandidate?: unknown, phoneCandidate?: unknown, avatarUrlCandidate?: unknown, lidCandidate?: unknown): void {
  if (!id || typeof id !== 'string') return
  if (
    id.endsWith('@g.us') ||
    id.endsWith('@newsletter') ||
    id.endsWith('@broadcast') ||
    id.includes('broadcast') ||
    id.includes('status') ||
    id === '0@s.whatsapp.net' ||
    id.startsWith('0@') ||
    (!id.endsWith('@s.whatsapp.net') && !id.endsWith('@c.us') && !id.endsWith('@lid') && id.includes('@'))
  ) {
    return
  }

  const isLid = id.endsWith('@lid')
  const phone = typeof phoneCandidate === 'string' && phoneCandidate.replace(/\D/g, '').length >= 8
    ? phoneCandidate.replace(/\D/g, '')
    : !isLid ? id.replace(/\D/g, '') : ''

  if (!isLid && (!phone || phone.length < 8)) return

  if (!contactCache.has(connectionId)) {
    contactCache.set(connectionId, new Map())
  }
  const map = contactCache.get(connectionId)!
  const existing = map.get(id)

  const rawName = typeof nameCandidate === 'string' ? nameCandidate.trim() : ''
  const isGeneric = (name?: string | null) => !name || name.startsWith('Contato +') || name.startsWith('Contato ') || name.startsWith('Membro ') || name.startsWith('Grupo ') || name === `+${phone}` || name === phone || name === id

  let finalName = rawName
  if (isGeneric(finalName)) {
    if (existing && existing.name && !isGeneric(existing.name)) {
      finalName = existing.name
    } else {
      finalName = phone ? `Contato +${phone}` : id
    }
  }

  const finalAvatarUrl = typeof avatarUrlCandidate === 'string' && avatarUrlCandidate
    ? avatarUrlCandidate
    : (existing?.avatarUrl || null)

  const lidStr = typeof lidCandidate === 'string' && lidCandidate.endsWith('@lid') ? lidCandidate : (isLid ? id : (existing as any)?.lid || null)

  map.set(id, { id, name: finalName, phone, avatarUrl: finalAvatarUrl, lid: lidStr } as any)
  if (lidStr && lidStr !== id) {
    const existingLid = map.get(lidStr)
    if (!existingLid || isGeneric(existingLid?.name) || !existingLid?.avatarUrl) {
      map.set(lidStr, { id: lidStr, name: finalName, phone, avatarUrl: finalAvatarUrl || existingLid?.avatarUrl || null, lid: lidStr } as any)
    }
  }
  if (phone) {
    const jid = `${phone}@s.whatsapp.net`
    const existingJid = map.get(jid)
    if (!existingJid || isGeneric(existingJid?.name) || !existingJid?.avatarUrl) {
      map.set(jid, { id: jid, name: finalName, phone, avatarUrl: finalAvatarUrl || existingJid?.avatarUrl || null, lid: lidStr || (existingJid as any)?.lid || null } as any)
    }
  }
  scheduleSaveContactsToDatabase(connectionId)
}

const silentLogger: Record<string, unknown> = {
  level: 'silent',
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
}
silentLogger.child = () => silentLogger

function loadBaileys() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@whiskeysockets/baileys') as typeof import('@whiskeysockets/baileys')
}

function getSessionDir(connectionId: string): string {
  return path.join(process.env.NAIA_SESSIONS_DIR ?? '/tmp/naia-sessions', connectionId)
}

export async function initAllWhatsAppSessions(): Promise<void> {
  try {
    const rows = await db
      .select({ id: connections.id, status: connections.status })
      .from(connections)
      .where(eq(connections.channel, 'whatsapp'))

    for (const row of rows) {
      if (row.status === 'active' || row.status === 'disconnected' || row.status === 'error') {
        startWhatsAppSession(row.id).catch((err) => {
          console.error(`[whatsapp-manager] Falha ao iniciar sessão para ${row.id}:`, err)
        })
      }
    }
  } catch (err) {
    console.error('[whatsapp-manager] Erro ao inicializar sessões de WhatsApp no boot:', err)
  }
}

export async function startWhatsAppSession(connectionId: string): Promise<void> {
  if (socketMap.has(connectionId)) {
    const current = socketMap.get(connectionId)
    if (current?.status === 'connected' || current?.status === 'connecting') {
      return
    }
  }

  socketMap.set(connectionId, { status: 'connecting', socket: null })

  const baileys = loadBaileys()
  const { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, BufferJSON } = baileys

  const sessionDir = getSessionDir(connectionId)
  await fs.promises.mkdir(sessionDir, { recursive: true }).catch(() => {})

  const [conn] = await db
    .select({ config: connections.config, status: connections.status })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (conn && (!conn.config || conn.config === '{}')) {
    await fs.promises.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
    await fs.promises.mkdir(sessionDir, { recursive: true }).catch(() => {})
    await db.delete(whatsappSessions).where(eq(whatsappSessions.connectionId, connectionId)).catch(() => {})
    await db.delete(whatsappContactsCache).where(eq(whatsappContactsCache.connectionId, connectionId)).catch(() => {})
  }

  const { state, saveCreds } = await usePostgresAuthState(connectionId)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Naia Campanhas', 'Chrome', '124'],
    logger: silentLogger as never,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
  })

  socketMap.set(connectionId, { status: 'connecting', socket })

  socket.ev.on('creds.update', async () => {
    try {
      await saveCreds()
      const credsJson = JSON.stringify(state.creds, BufferJSON.replacer)
      await db
        .update(connections)
        .set({ config: credsJson, updatedAt: new Date() })
        .where(eq(connections.id, connectionId))
    } catch (err) {
      console.error(`[whatsapp-manager] Erro em creds.update para ${connectionId}:`, err)
    }
  })

  await loadContactsFromDatabase(connectionId)

  socket.ev.on('messaging-history.set', ({ contacts, chats, messages }: any) => {
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        upsertContactToCache(connectionId, c?.id, c?.name || c?.notify || c?.pushName || c?.verifiedName, undefined, c?.imgUrl || c?.profilePictureUrl, c?.lid)
      }
    }
    if (Array.isArray(chats)) {
      for (const ch of chats) {
        upsertContactToCache(connectionId, ch?.id, ch?.name || ch?.subject)
      }
    }
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg?.key && !msg.key.fromMe) {
          const pushName = msg.pushName || msg.verifiedBizName
          if (msg.key.remoteJid && !msg.key.remoteJid.endsWith('@g.us')) {
            upsertContactToCache(connectionId, msg.key.remoteJid, pushName)
          }
          if (msg.key.participant) {
            upsertContactToCache(connectionId, msg.key.participant, pushName)
          }
        }
      }
    }
  })

  socket.ev.on('contacts.upsert', (contactsList: any[]) => {
    if (!Array.isArray(contactsList)) return
    console.log(`[whatsapp-manager] [${connectionId}] contacts.upsert emitted with ${contactsList.length} items`)
    for (const c of contactsList) {
      upsertContactToCache(connectionId, c?.id, c?.name || c?.notify || c?.pushName || c?.verifiedName, undefined, c?.imgUrl || c?.profilePictureUrl, c?.lid)
    }
  })

  socket.ev.on('contacts.update', (contactsList: any[]) => {
    if (!Array.isArray(contactsList)) return
    console.log(`[whatsapp-manager] [${connectionId}] contacts.update emitted with ${contactsList.length} items`)
    for (const c of contactsList) {
      upsertContactToCache(connectionId, c?.id, c?.name || c?.notify || c?.pushName || c?.verifiedName, undefined, c?.imgUrl || c?.profilePictureUrl, c?.lid)
    }
  })

  socket.ev.on('chats.upsert', (chatsList: any[]) => {
    if (!Array.isArray(chatsList)) return
    for (const chat of chatsList) {
      upsertContactToCache(connectionId, chat?.id, chat?.name || chat?.subject)
    }
  })

  socket.ev.on('chats.update', (chatsList: any[]) => {
    if (!Array.isArray(chatsList)) return
    for (const chat of chatsList) {
      upsertContactToCache(connectionId, chat?.id, chat?.name || chat?.subject)
    }
  })

  socket.ev.on('messages.update', async (updates: any[]) => {
    if (!Array.isArray(updates)) return
    const queue = getQueue<StatusWebhookJob>(QUEUES.STATUS_WEBHOOK)
    for (const item of updates) {
      const extId = item?.key?.id
      if (!extId) continue
      const statusVal = item?.update?.status
      let newStatus: 'delivered' | 'read' | 'failed' | null = null
      if (statusVal === 3 || statusVal === 'DELIVERY_ACK') newStatus = 'delivered'
      else if (statusVal === 4 || statusVal === 5 || statusVal === 'READ' || statusVal === 'PLAYED') newStatus = 'read'
      else if (statusVal === 0 || statusVal === 'ERROR') newStatus = 'failed'

      if (newStatus) {
        await queue.add(
          `status-update:${extId}:${newStatus}`,
          {
            source: 'whatsapp',
            connectionId,
            externalMessageId: extId,
            status: newStatus as never,
            timestamp: new Date().toISOString(),
          },
          { ...defaultJobOptions, jobId: `status-update:${extId}:${newStatus}` }
        ).catch(() => {})
      }
    }
  })

  socket.ev.on('message-receipt.update', async (updates: any[]) => {
    if (!Array.isArray(updates)) return
    const queue = getQueue<StatusWebhookJob>(QUEUES.STATUS_WEBHOOK)
    for (const item of updates) {
      const extId = item?.key?.id
      if (!extId) continue
      const receipt = item?.receipt
      if (!receipt) continue
      let newStatus: 'delivered' | 'read' | null = null
      if (receipt.readTimestamp || (receipt as any).playedTimestamp) {
        newStatus = 'read'
      } else if (receipt.receiptTimestamp) {
        newStatus = 'delivered'
      }
      if (newStatus) {
        const tsSec = receipt.readTimestamp || (receipt as any).playedTimestamp || receipt.receiptTimestamp
        const timestamp = typeof tsSec === 'number' && tsSec > 0 ? new Date(tsSec * 1000).toISOString() : new Date().toISOString()
        await queue.add(
          `receipt-update:${extId}:${newStatus}`,
          {
            source: 'whatsapp',
            connectionId,
            externalMessageId: extId,
            status: newStatus as never,
            timestamp,
          },
          { ...defaultJobOptions, jobId: `receipt-update:${extId}:${newStatus}` }
        ).catch(() => {})
      }
    }
  })

  socket.ev.on('messages.upsert', async ({ messages, type }: { messages: any[]; type: string }) => {
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg?.key && !msg.key.fromMe) {
          const pushName = msg.pushName || msg.verifiedBizName
          if (msg.key.remoteJid && !msg.key.remoteJid.endsWith('@g.us')) {
            upsertContactToCache(connectionId, msg.key.remoteJid, pushName)
          }
          if (msg.key.participant) {
            upsertContactToCache(connectionId, msg.key.participant, pushName)
          }
        }
      }
    }
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue

      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''
      ).trim().toLowerCase()

      if (!text) continue

      const remoteJid = msg.key.remoteJid ?? ''
      if (remoteJid.endsWith('@g.us')) continue

      const isOptOutCmd = text === '#sair'
      const isOptInCmd = text === '#voltar'

      if (isOptOutCmd || isOptInCmd) {
        let phoneSource = ''
        if (!remoteJid.endsWith('@lid')) {
          phoneSource = remoteJid
        } else {
          const altJid = typeof (msg.key as { remoteJidAlt?: unknown }).remoteJidAlt === 'string'
            ? (msg.key as { remoteJidAlt: string }).remoteJidAlt
            : ''
          phoneSource = altJid || (contactCache.get(connectionId)?.get(remoteJid)?.phone ?? '')
          if (!phoneSource) {
            const pn = await (socket as any).signalRepository?.lidMapping
              ?.getPNForLID?.(remoteJid)
              .catch(() => null)
            if (typeof pn === 'string') phoneSource = pn
          }
          if (!phoneSource) {
            const [row] = await db
              .select({ phone: whatsappContactsCache.phone })
              .from(whatsappContactsCache)
              .where(and(
                eq(whatsappContactsCache.connectionId, connectionId),
                eq(whatsappContactsCache.contactJid, remoteJid),
              ))
              .limit(1)
            phoneSource = row?.phone ?? ''
          }
        }
        const phoneClean = phoneSource.replace(/\D/g, '')

        console.log(
          `[whatsapp-manager] [${connectionId}] comando ${text} de ${remoteJid} → telefone ${phoneClean || 'NÃO RESOLVIDO'}`,
        )
        if (!phoneClean) continue

        if (remoteJid.endsWith('@lid')) {
          upsertContactToCache(connectionId, remoteJid, msg.pushName, phoneClean)
        }

        const [conn] = await db
          .select({ workspaceId: connections.workspaceId })
          .from(connections)
          .where(eq(connections.id, connectionId))
          .limit(1)

        if (!conn) continue

        const idRows = await db
          .select({ contactId: contactIdentities.contactId })
          .from(contactIdentities)
          .where(and(eq(contactIdentities.workspaceId, conn.workspaceId), eq(contactIdentities.channelIdentifier, phoneClean)))

        const contactIdSet = new Set(idRows.map((r) => r.contactId))
        const directRows = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.workspaceId, conn.workspaceId), eq(contacts.whatsappPhone, phoneClean)))

        for (const r of directRows) contactIdSet.add(r.id)
        const targetContactIds = Array.from(contactIdSet)

        console.log(
          `[whatsapp-manager] comando ${text} de ${remoteJid} (tel resolvido: ${phoneClean}) → ${targetContactIds.length} contato(s) no workspace ${conn.workspaceId}`,
        )

        if (targetContactIds.length > 0) {
          const newStatus = isOptInCmd
          for (const cId of targetContactIds) {
            await db
              .update(contacts)
              .set({
                optInStatus: newStatus,
                optInAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(contacts.id, cId))
          }

          const replyText = newStatus
            ? '✅ *Opt-in reativado!* Você voltou a estar inscrito e receberá nossas notificações automáticas.'
            : '🚫 *Opt-out confirmado.* Você foi descadastrado e não receberá mais nenhuma campanha deste canal. Para reativar a qualquer momento, responda *#VOLTAR*.'

          await (socket as any).sendMessage(remoteJid, { text: replyText }).catch(() => {})
        }
      }
    }
  })

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update as {
      connection?: string
      lastDisconnect?: { error?: { output?: { statusCode?: number } } }
      qr?: string
    }

    if (qr) {
      qrMap.set(connectionId, { qr, expiresAt: new Date(Date.now() + 120_000) })
      socketMap.set(connectionId, { status: 'connecting', socket })
    }

    if (connection === 'open') {
      qrMap.delete(connectionId)
      socketMap.set(connectionId, { status: 'connected', socket })

      await saveCreds().catch(() => {})
      const credsJson = JSON.stringify(state.creds, BufferJSON.replacer)

      await db
        .update(connections)
        .set({
          status: 'active',
          config: credsJson,
          lastErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(connections.id, connectionId))

      try {
        const map = contactCache.get(connectionId)
        const isGen = (n?: string | null) => !n || n.startsWith('Contato +') || n.startsWith('Contato ') || n.startsWith('Membro ') || n.startsWith('Grupo ')
        const realCount = map ? Array.from(map.values()).filter((x) => !isGen(x?.name)).length : 0
        if (realCount <= 5 && (socket as any).resyncAppState && typeof loadBaileys === 'function') {
          const { ALL_WA_PATCH_NAMES } = loadBaileys()
          console.log(`[whatsapp-manager] [${connectionId}] Poucos contatos no cache (${realCount}). Acionando resyncAppState...`)
          await db.delete(whatsappSessions).where(
            and(
              eq(whatsappSessions.connectionId, connectionId),
              sql`${whatsappSessions.keyId} LIKE 'app-state-sync-version-%'`
            )
          )
          await (socket as any).resyncAppState(ALL_WA_PATCH_NAMES, true)
        }
      } catch (err) {
        console.error(`[whatsapp-manager] [${connectionId}] Erro no resync automático de contatos:`, err)
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401

      socketMap.delete(connectionId)
      qrMap.delete(connectionId)

      if (shouldReconnect) {
        await db
          .update(connections)
          .set({
            lastErrorAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(connections.id, connectionId))

        setTimeout(() => {
          startWhatsAppSession(connectionId).catch(console.error)
        }, 5000)
      } else {
        await fs.promises.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
        const [connInfo] = await db
          .select({ workspaceId: connections.workspaceId, name: connections.name, channel: connections.channel })
          .from(connections)
          .where(eq(connections.id, connectionId))
          .limit(1)
        await db
          .update(connections)
          .set({
            status: 'disconnected',
            config: '{}',
            lastErrorMessage: 'Aparelho desconectado pelo celular ou sessão expirada.',
            updatedAt: new Date(),
          })
          .where(eq(connections.id, connectionId))
        if (connInfo) {
          notifyWorkspaceOwner(connInfo.workspaceId, {
            type: 'product',
            title: 'WhatsApp desconectado',
            body: `A conexão "${connInfo.name}" do WhatsApp foi desconectada. Reconecte para continuar os envios.`,
            actionUrl: `${NAIA_WEB_URL}/${connInfo.workspaceId}/connections`,
            actionLabel: 'Reconectar',
            metadata: { connectionId, connectionName: connInfo.name, channel: connInfo.channel, reason: 'whatsapp_disconnected' },
          }, 'emailOnConnectionDisconnected').catch((err) => console.error('[whatsapp-manager] falha ao notificar desconexão:', err))
        }
      }
    }
  })
}

export function getQRCode(connectionId: string): string | null {
  const entry = qrMap.get(connectionId)
  if (!entry) return null
  if (entry.expiresAt < new Date()) {
    qrMap.delete(connectionId)
    return null
  }
  return entry.qr
}

export function getSocketStatus(connectionId: string): 'connecting' | 'connected' | 'disconnected' {
  return socketMap.get(connectionId)?.status ?? 'disconnected'
}

export async function disconnectWhatsApp(connectionId: string): Promise<void> {
  const entry = socketMap.get(connectionId)
  if (entry?.socket) {
    const socket = entry.socket as { logout?: () => Promise<void>; end?: () => void }
    try { await socket.logout?.() } catch { /* ignore */ }
    try { socket.end?.() } catch { /* ignore */ }
  }
  socketMap.delete(connectionId)
  qrMap.delete(connectionId)
  contactCache.delete(connectionId)
  if (saveContactsTimeoutMap.has(connectionId)) {
    clearTimeout(saveContactsTimeoutMap.get(connectionId)!)
    saveContactsTimeoutMap.delete(connectionId)
  }

  const sessionDir = getSessionDir(connectionId)
  await fs.promises.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  await db.delete(whatsappSessions).where(eq(whatsappSessions.connectionId, connectionId)).catch(() => {})
  await db.delete(whatsappContactsCache).where(eq(whatsappContactsCache.connectionId, connectionId)).catch(() => {})
}

export async function fetchWhatsAppContacts(connectionId: string): Promise<Array<{ id: string; name: string; phone: string; avatarUrl?: string | null }>> {
  await loadContactsFromDatabase(connectionId)
  const cached = contactCache.get(connectionId)
  return cached ? Array.from(cached.values()).sort((a, b) => a.name.localeCompare(b.name)) : []
}

export async function fetchWhatsAppGroups(connectionId: string): Promise<Array<{ id: string; subject: string; size: number; desc?: string; participants: Array<{ id: string; admin?: string | null }> }>> {
  const entry = socketMap.get(connectionId)
  if (!entry?.socket || entry.status !== 'connected') {
    throw new Error('Conexão WhatsApp não está conectada no momento.')
  }
  const socket = entry.socket as {
    groupFetchAllParticipating?: () => Promise<Record<string, any>>
  }
  if (!socket.groupFetchAllParticipating) {
    return []
  }
  try {
    const groupsMap = await socket.groupFetchAllParticipating()
    return Object.values(groupsMap).map((g: any) => ({
      id: g.id ?? '',
      subject: g.subject ?? 'Grupo sem nome',
      size: g.size ?? g.participants?.length ?? 0,
      desc: g.desc ?? '',
      participants: (g.participants ?? []).map((p: any) => ({
        id: p.id ?? '',
        admin: p.admin ?? null,
        phoneNumber: p.phoneNumber ?? null,
      })),
    }))
  } catch (err: any) {
    if (err?.isBoom && (err?.message === 'Cancelled' || err?.message === 'Connection Closed')) {
      console.warn(`[whatsapp-manager] [${connectionId}] Busca de grupos interrompida (conexão reiniciando/ocupada).`)
      return []
    }
    console.error(`[whatsapp-manager] Erro ao buscar grupos para ${connectionId}:`, err)
    throw err
  }
}

type WhatsAppMediaRef = { storageKey: string; mimeType: string; kind: 'image' | 'video' | 'audio' | 'document'; filename: string }

export async function sendWhatsAppMessage(
  connectionId: string,
  phone: string,
  content: string,
  media?: WhatsAppMediaRef[],
): Promise<{ externalMessageId: string }> {
  const entry = socketMap.get(connectionId)
  if (!entry?.socket || entry.status !== 'connected') {
    throw new Error('Conexão WhatsApp não está conectada no momento.')
  }
  const socket = entry.socket as { sendMessage: (jid: string, msg: Record<string, unknown>) => Promise<{ key?: { id?: string } }> }
  const jid = phone.includes('@') ? phone : phone.replace(/\D/g, '') + '@s.whatsapp.net'

  const sendOne = async (msg: Record<string, unknown>): Promise<{ key?: { id?: string } }> => {
    try {
      return await Promise.race([
        socket.sendMessage(jid, msg),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout de 25s ao enviar mensagem para ${phone} via WhatsApp.`)), 25000),
        ),
      ])
    } catch (err: any) {
      if (err?.isBoom && (err?.message === 'Cancelled' || err?.message === 'Connection Closed')) {
        throw new Error(`Envio via WhatsApp interrompido (${phone}): a conexão com o aparelho reiniciou ou está ocupada.`)
      }
      throw err
    }
  }

  if (!media || media.length === 0) {
    const result = await sendOne({ text: content })
    return { externalMessageId: result?.key?.id ?? '' }
  }

  const { getObjectBytes } = await import('@naia/storage')
  let firstId = ''
  let captionUsed = false

  for (let i = 0; i < media.length; i++) {
    const m = media[i]!
    const buffer = Buffer.from(await getObjectBytes(m.storageKey))
    const caption = i === 0 && m.kind !== 'audio' && content ? content : undefined
    if (caption) captionUsed = true

    const msg: Record<string, unknown> =
      m.kind === 'image' ? { image: buffer, caption }
      : m.kind === 'video' ? { video: buffer, caption }
      : m.kind === 'audio' ? { audio: buffer, mimetype: m.mimeType }
      : { document: buffer, fileName: m.filename, mimetype: m.mimeType, caption }

    const result = await sendOne(msg)
    if (!firstId) firstId = result?.key?.id ?? ''
  }

  if (!captionUsed && content) {
    const result = await sendOne({ text: content })
    if (!firstId) firstId = result?.key?.id ?? ''
  }

  return { externalMessageId: firstId }
}

export async function getGroupParticipants(connectionId: string, groupJid: string): Promise<Array<{ id: string; admin?: string | null; phoneNumber?: string | null; name?: string | null }>> {
  const entry = socketMap.get(connectionId)
  if (entry?.socket && entry.status === 'connected') {
    const socket = entry.socket as {
      groupMetadata?: (jid: string) => Promise<any>
      groupFetchAllParticipating?: () => Promise<Record<string, any>>
      onWhatsApp?: (...jids: string[]) => Promise<any[]>
    }

    let rawParticipants: Array<{ id: string; admin?: string | null; phoneNumber?: string | null; name?: string | null; avatarUrl?: string | null }> = []

    if (socket.groupMetadata) {
      try {
        const meta = await socket.groupMetadata(groupJid)
        if (meta?.participants && meta.participants.length > 0) {
          rawParticipants = meta.participants.map((p: any) => ({
            id: p.id ?? '',
            admin: p.admin ?? null,
            phoneNumber: p.phoneNumber ?? null,
            name: p.name || p.notify || p.pushName || p.verifiedName || null,
            avatarUrl: null,
          }))
        }
      } catch (err) {
        console.error(`[whatsapp-manager] Erro em groupMetadata (${groupJid}):`, err)
      }
    }

    if (rawParticipants.length === 0 && socket.groupFetchAllParticipating) {
      try {
        const groupsMap = await socket.groupFetchAllParticipating()
        const g = groupsMap[groupJid]
        if (g?.participants && g.participants.length > 0) {
          rawParticipants = g.participants.map((p: any) => ({
            id: p.id ?? '',
            admin: p.admin ?? null,
            phoneNumber: p.phoneNumber ?? null,
            name: p.name || p.notify || p.pushName || p.verifiedName || null,
            avatarUrl: null,
          }))
        }
      } catch (err) {
        console.error(`[whatsapp-manager] Erro em groupFetchAllParticipating (${groupJid}):`, err)
      }
    }

    if (rawParticipants.length === 0) return []

    for (const p of rawParticipants) {
      if (p.id && p.id.endsWith('@s.whatsapp.net') && p.name) {
        const phone = p.id.replace(/@.*$/, '').replace(/\D/g, '')
        if (phone && phone.length >= 8 && phone.length <= 15) {
          upsertContactToCache(connectionId, p.id, p.name, phone, null)
        }
      }
    }

    if (socket.onWhatsApp) {
      const missing = rawParticipants.filter(p =>
        p.id && (p.id.endsWith('@s.whatsapp.net') || (p.id.endsWith('@lid') && p.phoneNumber)) && !p.name
      )
      const batchSize = 5
      for (let i = 0; i < missing.length; i += batchSize) {
        const batch = missing.slice(i, i + batchSize)
        const jids = batch.map(p => p.phoneNumber ? `${p.phoneNumber}@s.whatsapp.net` : p.id)
        try {
          const results: any[] = await Promise.race([
            socket.onWhatsApp!(...jids),
            new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
          ])
          if (Array.isArray(results)) {
            for (const r of results) {
              const notify = r?.notify || r?.name || r?.pushname || r?.verifiedName
              if (notify && r?.jid) {
                const phone = r.jid.replace(/@.*$/, '').replace(/\D/g, '')
                if (phone && phone.length >= 8 && phone.length <= 15) {
                  upsertContactToCache(connectionId, r.jid, notify, phone, null)
                  const p = rawParticipants.find(x => x.id === r.jid || (x.phoneNumber && `${x.phoneNumber}@s.whatsapp.net` === r.jid))
                  if (p) p.name = notify
                }
              }
            }
          }
        } catch {
        }
        if (i + batchSize < missing.length) {
          await new Promise(r => setTimeout(r, 300))
        }
      }
    }

    const map = contactCache.get(connectionId)
    const isGen = (n?: string | null) => !n || n.startsWith('Contato +') || n.startsWith('Contato ') || n.startsWith('Membro ') || n.startsWith('Grupo ')
    if (map) {
      for (const p of rawParticipants) {
        if (isGen(p.name) || !p.avatarUrl) {
          let cached = map.get(p.id)
          if (cached) {
            if (isGen(p.name) && !isGen(cached.name)) p.name = cached.name
            if (!p.avatarUrl && cached.avatarUrl) p.avatarUrl = cached.avatarUrl
          }
          if (p.phoneNumber && (isGen(p.name) || !p.avatarUrl)) {
            const cleanPhone = p.phoneNumber.replace(/@.*$/, '').replace(/\D/g, '')
            if (cleanPhone) {
              cached = map.get(`${cleanPhone}@s.whatsapp.net`)
              if (cached) {
                if (isGen(p.name) && !isGen(cached.name)) p.name = cached.name
                if (!p.avatarUrl && cached.avatarUrl) p.avatarUrl = cached.avatarUrl
              }
            }
          }
          if (isGen(p.name) || !p.avatarUrl) {
            for (const entry of map.values()) {
              if (entry.id === p.id || (entry as any).lid === p.id || (p.phoneNumber && entry.phone === p.phoneNumber.replace(/@.*$/, '').replace(/\D/g, ''))) {
                if (isGen(p.name) && !isGen(entry.name)) p.name = entry.name
                if (!p.avatarUrl && entry.avatarUrl) p.avatarUrl = entry.avatarUrl
                if (!isGen(p.name) && p.avatarUrl) break
              }
            }
          }
        }
      }
    }

    return rawParticipants
  }
  return []
}

export function resolveWhatsAppContactName(connectionId: string, phoneOrJid: string, fallbackCandidate?: string | null): string {
  const isGeneric = (name?: string | null): boolean => {
    if (!name || typeof name !== 'string') return true
    const clean = name.trim()
    if (!clean) return true
    if (clean.startsWith('Contato +') || clean.startsWith('Contato ') || clean.startsWith('Membro ') || clean.startsWith('Grupo ')) return true
    const digitsOnly = clean.replace(/\D/g, '')
    if (digitsOnly === clean || `+${digitsOnly}` === clean || `${digitsOnly}@s.whatsapp.net` === clean || `${digitsOnly}@lid` === clean) return true
    return false
  }

  const isLidJid = phoneOrJid.endsWith('@lid')

  const map = contactCache.get(connectionId)
  if (map && phoneOrJid) {
    const exact = map.get(phoneOrJid)
    if (exact && !isGeneric(exact.name)) {
      return exact.name
    }

    const phoneDigits = phoneOrJid.replace(/@.*$/, '').replace(/\D/g, '')
    if (phoneDigits && phoneDigits.length >= 8 && phoneDigits.length <= 15) {
      if (!isLidJid) {
        const byJid = map.get(`${phoneDigits}@s.whatsapp.net`)
        if (byJid && !isGeneric(byJid.name)) {
          return byJid.name
        }
      }
      for (const entry of map.values()) {
        if ((entry.id === phoneOrJid || (entry as any).lid === phoneOrJid || (!isLidJid && entry.phone === phoneDigits)) && !isGeneric(entry.name)) {
          return entry.name
        }
      }
    }
  }

  if (!isGeneric(fallbackCandidate)) {
    return fallbackCandidate!.trim()
  }

  if (!isLidJid) {
    const phoneDigits = (phoneOrJid || '').replace(/@.*$/, '').replace(/\D/g, '')
    if (phoneDigits && phoneDigits.length >= 8 && phoneDigits.length <= 15) {
      return `Contato +${phoneDigits}`
    }
  }
  return 'Contato'
}

export async function getActiveWhatsAppConnectionForWorkspace(workspaceId: string, preferredConnectionId?: string | null): Promise<string | null> {
  if (preferredConnectionId) {
    const entry = socketMap.get(preferredConnectionId)
    if (entry?.socket && entry.status === 'connected') return preferredConnectionId
  }
  const rows = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.workspaceId, workspaceId), eq(connections.channel, 'whatsapp'), eq(connections.status, 'active')))
  for (const row of rows) {
    const entry = socketMap.get(row.id)
    if (entry?.socket && entry.status === 'connected') {
      return row.id
    }
  }
  return rows[0]?.id ?? null
}

export async function enrichWhatsAppContactInfo(
  workspaceIdOrConnectionId: string,
  phoneOrJid: string,
  existingName?: string | null,
  isDirectConnectionId?: boolean
): Promise<{ name: string; avatarUrl: string | null; phone: string }> {
  const isGeneric = (name?: string | null): boolean => {
    if (!name || typeof name !== 'string') return true
    const clean = name.trim()
    if (!clean) return true
    if (clean.startsWith('Contato +') || clean.startsWith('Contato ') || clean.startsWith('Membro ') || clean.startsWith('Grupo ')) return true
    const digitsOnly = clean.replace(/\D/g, '')
    if (digitsOnly === clean || `+${digitsOnly}` === clean || `${digitsOnly}@s.whatsapp.net` === clean || `${digitsOnly}@lid` === clean) return true
    return false
  }

  let connectionId: string | null = null
  if (isDirectConnectionId) {
    connectionId = workspaceIdOrConnectionId
  } else {
    connectionId = await getActiveWhatsAppConnectionForWorkspace(workspaceIdOrConnectionId)
  }

  const cleanPhone = phoneOrJid.replace(/@.*$/, '').replace(/\D/g, '')
  const isGroup = phoneOrJid.endsWith('@g.us')
  const jid = phoneOrJid.includes('@') ? phoneOrJid : `${cleanPhone}@s.whatsapp.net`

  let resolvedName = existingName && !isGeneric(existingName) ? existingName.trim() : (cleanPhone ? `Contato +${cleanPhone}` : phoneOrJid)
  if (connectionId) {
    const cachedName = resolveWhatsAppContactName(connectionId, jid, existingName || null)
    if (!isGeneric(cachedName)) {
      resolvedName = cachedName
    }
  }

  let avatarUrl: string | null = null
  if (connectionId && contactCache.has(connectionId)) {
    const map = contactCache.get(connectionId)!
    const cached = map.get(jid) || map.get(`${cleanPhone}@s.whatsapp.net`) || map.get(phoneOrJid)
    if (cached?.avatarUrl) {
      avatarUrl = cached.avatarUrl
    }
    if (cached?.name && !isGeneric(cached.name)) {
      resolvedName = cached.name
    }
    if (isGeneric(resolvedName) || !avatarUrl) {
      for (const entry of map.values()) {
        if (entry.id === phoneOrJid || (entry as any).lid === phoneOrJid || (cleanPhone && entry.phone === cleanPhone)) {
          if (isGeneric(resolvedName) && !isGeneric(entry.name)) resolvedName = entry.name
          if (!avatarUrl && entry.avatarUrl) avatarUrl = entry.avatarUrl
          if (!isGeneric(resolvedName) && avatarUrl) break
        }
      }
    }
  }

  if ((isGeneric(resolvedName) || !avatarUrl) && connectionId) {
    try {
      const cacheRows = await db
        .select({ name: whatsappContactsCache.name, avatarUrl: whatsappContactsCache.avatarUrl, contactJid: whatsappContactsCache.contactJid })
        .from(whatsappContactsCache)
        .where(
          and(
            eq(whatsappContactsCache.connectionId, connectionId),
            or(
              cleanPhone ? eq(whatsappContactsCache.phone, cleanPhone) : sql`false`,
              eq(whatsappContactsCache.contactJid, phoneOrJid),
              cleanPhone ? eq(whatsappContactsCache.contactJid, `${cleanPhone}@s.whatsapp.net`) : sql`false`
            )
          )
        )
        .limit(1)
      if (cacheRows.length > 0) {
        if (cacheRows[0].name && !isGeneric(cacheRows[0].name)) {
          resolvedName = cacheRows[0].name
        }
        if (!avatarUrl && cacheRows[0].avatarUrl) {
          avatarUrl = cacheRows[0].avatarUrl
        }
      }
    } catch {}
  }

  if (connectionId) {
    const entry = socketMap.get(connectionId)
    if (entry?.socket && entry.status === 'connected') {
      const socket = entry.socket as {
        profilePictureUrl?: (jid: string, type?: 'preview' | 'image') => Promise<string | undefined>
        getBusinessProfile?: (jid: string) => Promise<any>
        onWhatsApp?: (...args: any[]) => Promise<any[]>
        fetchStatus?: (jid: string) => Promise<any>
      }

      if (isGeneric(resolvedName) && !isGroup && socket.onWhatsApp) {
        try {
          const waRes = await Promise.race([
            socket.onWhatsApp(jid),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout onWhatsApp')), 3000))
          ])
          if (Array.isArray(waRes) && waRes.length > 0 && waRes[0]?.exists) {
            const waCandidate = waRes[0].notify || waRes[0].name || waRes[0].pushname || waRes[0].verifiedName
            if (waCandidate && typeof waCandidate === 'string' && !isGeneric(waCandidate)) {
              resolvedName = waCandidate.trim()
            }
          }
        } catch {}
      }

      if (socket.profilePictureUrl) {
        const targetJids = Array.from(new Set([
          !jid.endsWith('@lid') ? jid : null,
          !phoneOrJid.endsWith('@lid') ? phoneOrJid : null,
          cleanPhone && cleanPhone.length >= 8 ? `${cleanPhone}@s.whatsapp.net` : null,
          jid
        ].filter(Boolean) as string[]))

        for (const targetJid of targetJids) {
          if (avatarUrl) break
          try {
            const urlPreview = await Promise.race([
              socket.profilePictureUrl(targetJid, 'preview'),
              new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('Timeout avatar preview')), 1500))
            ])
            if (urlPreview) { avatarUrl = urlPreview; break }
          } catch {}
        }

        if (!avatarUrl) {
          for (const targetJid of targetJids) {
            if (avatarUrl) break
            try {
              const url = await Promise.race([
                socket.profilePictureUrl(targetJid, 'image'),
                new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('Timeout avatar image')), 2000))
              ])
              if (url) { avatarUrl = url; break }
            } catch {}
          }
        }
      }

      if (isGeneric(resolvedName) && !isGroup && socket.getBusinessProfile) {
        try {
          const biz = await Promise.race([
            socket.getBusinessProfile(jid),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout biz profile')), 3000))
          ])
          if (biz?.description || biz?.email || (biz as any)?.name) {
            const bizName = (biz as any)?.name
            if (bizName && typeof bizName === 'string' && !isGeneric(bizName)) {
              resolvedName = bizName.trim()
            }
          }
        } catch {}
      }

      if (isGeneric(resolvedName) && !isGroup && socket.fetchStatus) {
        try {
          const st = await Promise.race([
            socket.fetchStatus(jid),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout fetchStatus')), 2500))
          ])
          if (st?.status && typeof st.status === 'string' && st.status.length < 50 && !isGeneric(st.status)) {
            const sLower = st.status.toLowerCase()
            if (!sLower.includes('using whatsapp') && !sLower.includes('usando o whatsapp') && !sLower.includes('busy') && !sLower.includes('disponível') && !sLower.includes('ocupado') && !sLower.includes('urgent only') && !sLower.includes('battery about to die')) {
              resolvedName = st.status.trim()
            }
          }
        } catch {}
      }
    }

    upsertContactToCache(connectionId, jid, resolvedName, cleanPhone, avatarUrl)
  }

  return { name: resolvedName, avatarUrl, phone: cleanPhone }
}

export async function batchEnrichWhatsAppContacts(
  connectionId: string,
  items: Array<{ id: string; name?: string | null; avatarUrl?: string | null }>
): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const result = new Map<string, { name: string; avatarUrl: string | null }>()
  const concurrency = 3
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async (item) => {
        const enriched = await enrichWhatsAppContactInfo(connectionId, item.id, item.name, true)
        const finalAvatar = item.avatarUrl || enriched.avatarUrl || null
        result.set(item.id, { name: enriched.name, avatarUrl: finalAvatar })
      })
    )
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, 150))
    }
  }
  return result
}

