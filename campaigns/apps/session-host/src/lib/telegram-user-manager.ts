import { db, connections, contacts, contactIdentities } from '@naia/db'
import { eq, and } from 'drizzle-orm'
import { generateId } from './crypto'
import { notifyWorkspaceOwner, NAIA_WEB_URL } from './vianova-notifications'

type ClientEntry = { status: 'connecting' | 'connected' | 'disconnected'; client: any }

export type TelegramAuthPhase = 'connecting' | 'awaiting_code' | 'awaiting_password' | 'error'
type PendingLogin = {
  phase: TelegramAuthPhase
  error?: string
  codeResolve?: (code: string) => void
  codeReject?: (err: Error) => void
  passwordResolve?: (pw: string) => void
  timeout: NodeJS.Timeout
}

export const telegramClientMap = new Map<string, ClientEntry>()
const pendingLoginMap = new Map<string, PendingLogin>()

export type TelegramUserConfig = {
  kind: 'user'
  phone: string
  session?: string
}

export function isTelegramUserConfig(config: string | null | undefined): boolean {
  try {
    return (JSON.parse(config ?? '{}') as { kind?: string }).kind === 'user'
  } catch {
    return false
  }
}

function loadTeleproto() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TelegramClient, Api } = require('teleproto')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StringSession } = require('teleproto/sessions')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NewMessage } = require('teleproto/events')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CustomFile } = require('teleproto/client/uploads')
  return { TelegramClient, Api, StringSession, NewMessage, CustomFile }
}

export function resolveApiCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : undefined
  const apiHash = process.env.TELEGRAM_API_HASH
  if (!apiId || !Number.isFinite(apiId) || !apiHash) return null
  return { apiId, apiHash }
}

async function readUserConfig(connectionId: string): Promise<TelegramUserConfig | null> {
  const [conn] = await db
    .select({ config: connections.config })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)
  if (!conn) return null
  try {
    const parsed = JSON.parse(conn.config) as TelegramUserConfig
    return parsed.kind === 'user' ? parsed : null
  } catch {
    return null
  }
}

async function persistSession(connectionId: string, config: TelegramUserConfig, client: any): Promise<void> {
  const session = client.session.save() as string
  await db
    .update(connections)
    .set({
      status: 'active',
      config: JSON.stringify({ ...config, session }),
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connectionId))
}

function clearPendingLogin(connectionId: string): void {
  const pending = pendingLoginMap.get(connectionId)
  if (pending) clearTimeout(pending.timeout)
  pendingLoginMap.delete(connectionId)
}

function buildClient(config: TelegramUserConfig, creds: { apiId: number; apiHash: string }): any {
  const { TelegramClient, StringSession } = loadTeleproto()
  const client = new TelegramClient(new StringSession(config.session ?? ''), creds.apiId, creds.apiHash, {
    connectionRetries: 5,
    deviceModel: 'Naia Campanhas',
  })
  client.setLogLevel?.('error')
  return client
}

export async function initAllTelegramUserSessions(): Promise<void> {
  try {
    const rows = await db
      .select({ id: connections.id, config: connections.config, status: connections.status })
      .from(connections)
      .where(eq(connections.channel, 'telegram'))

    for (const row of rows) {
      if (!isTelegramUserConfig(row.config)) continue
      if (row.status !== 'active' && row.status !== 'error') continue
      connectExistingTelegramUser(row.id).catch((err) => {
        console.error(`[telegram-user] Falha ao reconectar sessão ${row.id} no boot:`, err)
      })
    }
  } catch (err) {
    console.error('[telegram-user] Erro ao inicializar sessões no boot:', err)
  }
}

export async function connectExistingTelegramUser(connectionId: string): Promise<boolean> {
  const existing = telegramClientMap.get(connectionId)
  if (existing?.status === 'connected' || existing?.status === 'connecting') return true

  const config = await readUserConfig(connectionId)
  if (!config?.session) return false
  const creds = resolveApiCredentials()
  if (!creds) return false

  telegramClientMap.set(connectionId, { status: 'connecting', client: null })
  try {
    const client = buildClient(config, creds)
    await client.connect()
    const authorized = await client.isUserAuthorized()
    const [connInfo] = await db
      .select({ workspaceId: connections.workspaceId, name: connections.name, status: connections.status, channel: connections.channel })
      .from(connections)
      .where(eq(connections.id, connectionId))
      .limit(1)
    if (!authorized) {
      await client.disconnect().catch(() => {})
      telegramClientMap.delete(connectionId)
      await db
        .update(connections)
        .set({
          status: 'disconnected',
          lastErrorMessage: 'Sessão do Telegram expirada — faça login novamente.',
          updatedAt: new Date(),
        })
        .where(eq(connections.id, connectionId))
      if (connInfo?.status === 'active') {
        notifyWorkspaceOwner(connInfo.workspaceId, {
          type: 'product',
          title: 'Telegram desconectado',
          body: `A conexão "${connInfo.name}" do Telegram expirou. Faça login novamente para continuar os envios.`,
          actionUrl: `${NAIA_WEB_URL}/${connInfo.workspaceId}/connections`,
          actionLabel: 'Reconectar',
          metadata: { connectionId, connectionName: connInfo.name, channel: connInfo.channel, reason: 'telegram_session_expired' },
        }, 'emailOnConnectionDisconnected').catch((err) => console.error('[telegram-user] falha ao notificar desconexão:', err))
      }
      return false
    }

    telegramClientMap.set(connectionId, { status: 'connected', client })
    registerOptCommandHandler(connectionId, client)
    await db
      .update(connections)
      .set({ status: 'active', lastErrorMessage: null, updatedAt: new Date() })
      .where(eq(connections.id, connectionId))
    return true
  } catch (err) {
    telegramClientMap.delete(connectionId)
    const [connInfo] = await db
      .select({ workspaceId: connections.workspaceId, name: connections.name, status: connections.status, channel: connections.channel })
      .from(connections)
      .where(eq(connections.id, connectionId))
      .limit(1)
    await db
      .update(connections)
      .set({
        status: 'error',
        lastErrorAt: new Date(),
        lastErrorMessage: 'Falha ao conectar a sessão do Telegram.',
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId))
    if (connInfo?.status === 'active') {
      notifyWorkspaceOwner(connInfo.workspaceId, {
        type: 'product',
        title: 'Telegram com erro',
        body: `A conexão "${connInfo.name}" do Telegram falhou ao conectar. Verifique as configurações.`,
        actionUrl: `${NAIA_WEB_URL}/${connInfo.workspaceId}/connections`,
        actionLabel: 'Ver conexões',
        metadata: { connectionId, connectionName: connInfo.name, channel: connInfo.channel, reason: 'telegram_connection_error' },
      }, 'emailOnConnectionDisconnected').catch((err) => console.error('[telegram-user] falha ao notificar erro:', err))
    }
    console.error(`[telegram-user] Erro ao conectar sessão ${connectionId}:`, err)
    return false
  }
}

export async function startTelegramUserLogin(connectionId: string): Promise<void> {
  const current = telegramClientMap.get(connectionId)
  if (current?.status === 'connected' || current?.status === 'connecting') return

  const config = await readUserConfig(connectionId)
  if (!config) {
    console.error(`[telegram-user] Conexão ${connectionId} sem config de conta de usuário.`)
    return
  }
  const creds = resolveApiCredentials()
  if (!creds) {
    await db
      .update(connections)
      .set({
        status: 'error',
        lastErrorAt: new Date(),
        lastErrorMessage: 'Credenciais de API do Telegram ausentes (api_id/api_hash).',
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId))
    return
  }

  clearPendingLogin(connectionId)
  const client = buildClient({ ...config, session: '' }, creds)
  telegramClientMap.set(connectionId, { status: 'connecting', client })

  const timeout = setTimeout(() => {
    const p = pendingLoginMap.get(connectionId)
    if (p?.codeReject) p.codeReject(new Error('Tempo esgotado aguardando o código de login.'))
    pendingLoginMap.set(connectionId, {
      phase: 'error',
      error: 'Tempo esgotado — reinicie a conexão para tentar de novo.',
      timeout: setTimeout(() => pendingLoginMap.delete(connectionId), 600_000),
    })
    client.disconnect().catch(() => {})
    telegramClientMap.delete(connectionId)
  }, 600_000)

  pendingLoginMap.set(connectionId, { phase: 'connecting', timeout })

  const waitFor = (phase: 'awaiting_code' | 'awaiting_password') =>
    new Promise<string>((resolve, reject) => {
      const pending = pendingLoginMap.get(connectionId)
      if (!pending) return reject(new Error('Login cancelado.'))
      pending.phase = phase
      if (phase === 'awaiting_code') {
        pending.codeResolve = resolve
        pending.codeReject = reject
      } else {
        pending.passwordResolve = resolve
      }
    })

  try {
    await client.start({
      phoneNumber: () => config.phone,
      phoneCode: () => waitFor('awaiting_code'),
      password: () => waitFor('awaiting_password'),
      onError: (err: Error) => {
        const pending = pendingLoginMap.get(connectionId)
        if (pending) {
          pending.error = translateLoginError(err)
        }
        console.error(`[telegram-user] Erro durante login ${connectionId}:`, err.message)
        return false
      },
    })

    clearPendingLogin(connectionId)
    telegramClientMap.set(connectionId, { status: 'connected', client })
    registerOptCommandHandler(connectionId, client)
    await persistSession(connectionId, config, client)
    console.log(`[telegram-user] Sessão ${connectionId} autenticada.`)
  } catch (err) {
    const message = translateLoginError(err)
    clearPendingLogin(connectionId)
    pendingLoginMap.set(connectionId, {
      phase: 'error',
      error: message,
      timeout: setTimeout(() => pendingLoginMap.delete(connectionId), 600_000),
    })
    telegramClientMap.delete(connectionId)
    await client.disconnect().catch(() => {})
    await db
      .update(connections)
      .set({
        status: 'error',
        lastErrorAt: new Date(),
        lastErrorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId))
  }
}

function translateLoginError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('PHONE_CODE_INVALID')) return 'Código de verificação inválido.'
  if (msg.includes('PHONE_CODE_EXPIRED')) return 'Código de verificação expirado — reinicie a conexão.'
  if (msg.includes('PASSWORD_HASH_INVALID') || msg.includes('Invalid password')) return 'Senha 2FA incorreta.'
  if (msg.includes('PHONE_NUMBER_INVALID')) return 'Número de telefone inválido.'
  if (msg.includes('PHONE_NUMBER_BANNED')) return 'Este número está banido do Telegram.'
  if (msg.includes('FLOOD')) return 'O Telegram limitou as tentativas — aguarde alguns minutos e tente de novo.'
  if (msg.includes('API_ID_INVALID')) return 'api_id/api_hash inválidos — confira em my.telegram.org.'
  if (msg.includes('Tempo esgotado')) return 'Tempo esgotado — reinicie a conexão para tentar de novo.'
  return 'Falha no login do Telegram. Reinicie a conexão e tente novamente.'
}

export function submitTelegramCode(connectionId: string, code: string): boolean {
  const pending = pendingLoginMap.get(connectionId)
  if (!pending?.codeResolve || pending.phase !== 'awaiting_code') return false
  pending.phase = 'connecting'
  pending.error = undefined
  const resolve = pending.codeResolve
  pending.codeResolve = undefined
  resolve(code.trim())
  return true
}

export function submitTelegramPassword(connectionId: string, password: string): boolean {
  const pending = pendingLoginMap.get(connectionId)
  if (!pending?.passwordResolve || pending.phase !== 'awaiting_password') return false
  pending.phase = 'connecting'
  pending.error = undefined
  const resolve = pending.passwordResolve
  pending.passwordResolve = undefined
  resolve(password)
  return true
}

export function getTelegramAuthState(connectionId: string): { phase: TelegramAuthPhase; error: string | null } | null {
  const pending = pendingLoginMap.get(connectionId)
  if (!pending) return null
  return { phase: pending.phase, error: pending.error ?? null }
}

export function getTelegramUserStatus(connectionId: string): 'connecting' | 'connected' | 'disconnected' {
  return telegramClientMap.get(connectionId)?.status ?? 'disconnected'
}

export async function disconnectTelegramUser(connectionId: string, opts?: { logout?: boolean }): Promise<void> {
  clearPendingLogin(connectionId)
  const entry = telegramClientMap.get(connectionId)
  if (entry?.client) {
    if (opts?.logout) {
      try {
        const { Api } = loadTeleproto()
        await entry.client.invoke(new Api.auth.LogOut())
      } catch { /* melhor esforço — sessão pode já estar morta */ }
    }
    try { await entry.client.disconnect() } catch { /* ignore */ }
  }
  telegramClientMap.delete(connectionId)
}

function registerOptCommandHandler(connectionId: string, client: any): void {
  const { NewMessage } = loadTeleproto()
  client.addEventHandler(async (event: any) => {
    try {
      if (!event.isPrivate || event.message?.out) return
      const text = (event.message?.message ?? '').trim().toLowerCase()
      const isOptOutCmd = text === '#sair'
      const isOptInCmd = text === '#voltar'
      if (!isOptOutCmd && !isOptInCmd) return

      const senderId = event.message?.senderId?.toString?.()
      if (!senderId) return

      const [conn] = await db
        .select({ workspaceId: connections.workspaceId })
        .from(connections)
        .where(eq(connections.id, connectionId))
        .limit(1)
      if (!conn) return

      const idRows = await db
        .select({ contactId: contactIdentities.contactId })
        .from(contactIdentities)
        .where(and(
          eq(contactIdentities.workspaceId, conn.workspaceId),
          eq(contactIdentities.channelType, 'telegram'),
          eq(contactIdentities.channelIdentifier, senderId),
        ))
      const contactIdSet = new Set(idRows.map((r) => r.contactId))
      const directRows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, conn.workspaceId), eq(contacts.telegramChatId, senderId)))
      for (const r of directRows) contactIdSet.add(r.id)

      if (contactIdSet.size === 0) return

      const newStatus = isOptInCmd
      for (const cId of contactIdSet) {
        await db
          .update(contacts)
          .set({ optInStatus: newStatus, optInAt: new Date(), updatedAt: new Date() })
          .where(eq(contacts.id, cId))
      }

      const replyText = newStatus
        ? '✅ Opt-in reativado! Você voltou a estar inscrito e receberá nossas notificações automáticas.'
        : '🚫 Opt-out confirmado. Você foi descadastrado e não receberá mais nenhuma campanha deste canal. Para reativar a qualquer momento, responda #VOLTAR.'
      await event.message.respond({ message: replyText }).catch(() => {})
    } catch (err) {
      console.error(`[telegram-user] Erro no handler de opt-out (${connectionId}):`, err)
    }
  }, new NewMessage({ incoming: true }))
}

function getConnectedClient(connectionId: string): any {
  const entry = telegramClientMap.get(connectionId)
  if (!entry?.client || entry.status !== 'connected') {
    throw new Error('Conexão Telegram (conta) não está conectada no momento.')
  }
  return entry.client
}

async function resolveEntity(client: any, target: string): Promise<any> {
  const t = target.trim()
  if (/^-?\d+$/.test(t)) {
    try {
      return await client.getInputEntity(Number(t))
    } catch {
      await client.getDialogs({ limit: 300 }).catch(() => {})
      return await client.getInputEntity(Number(t))
    }
  }
  return await client.getInputEntity(t)
}

type TelegramMediaRef = { storageKey: string; mimeType: string; kind: 'image' | 'video' | 'audio' | 'document'; filename: string }

export async function sendTelegramUserMessage(
  connectionId: string,
  target: string,
  content: string,
  media?: TelegramMediaRef[],
): Promise<{ externalMessageId: string }> {
  const client = getConnectedClient(connectionId)
  const entity = await resolveEntity(client, target)

  if (!media || media.length === 0) {
    const msg = await client.sendMessage(entity, { message: content })
    return { externalMessageId: String(msg?.id ?? '') }
  }

  const { CustomFile } = loadTeleproto()
  const { getObjectBytes } = await import('@naia/storage')
  const captionFits = content.length <= 1024
  let firstId = ''

  if (content && !captionFits) {
    const msg = await client.sendMessage(entity, { message: content })
    firstId = String(msg?.id ?? '')
  }

  for (let i = 0; i < media.length; i++) {
    const m = media[i]!
    const buffer = Buffer.from(await getObjectBytes(m.storageKey))
    const file = new CustomFile(m.filename, buffer.length, '', buffer)
    const caption = i === 0 && content && captionFits ? content : undefined
    const msg = await client.sendFile(entity, {
      file,
      caption,
      forceDocument: m.kind === 'document',
    })
    if (!firstId) firstId = String(msg?.id ?? '')
  }

  return { externalMessageId: firstId }
}

export async function fetchTelegramUserContacts(connectionId: string): Promise<Array<{ id: string; name: string; phone: string; avatarUrl?: string | null }>> {
  const client = getConnectedClient(connectionId)
  const dialogs = await client.getDialogs({ limit: 500 })
  const result: Array<{ id: string; name: string; phone: string; avatarUrl?: string | null }> = []

  for (const dialog of dialogs) {
    if (!dialog.isUser) continue
    const entity = dialog.entity
    if (!entity || entity.bot || entity.self || entity.deleted) continue
    const id = entity.id?.toString?.()
    if (!id) continue
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ')
      || (entity.username ? `@${entity.username}` : `Contato ${id}`)
    result.push({ id, name, phone: id, avatarUrl: null })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchTelegramUserGroups(connectionId: string): Promise<Array<{ id: string; subject: string; size: number; desc?: string; participants: Array<{ id: string; admin?: string | null }> }>> {
  const client = getConnectedClient(connectionId)
  const dialogs = await client.getDialogs({ limit: 500 })
  const result: Array<{ id: string; subject: string; size: number; desc?: string; participants: Array<{ id: string; admin?: string | null }> }> = []

  for (const dialog of dialogs) {
    const isGroupChat = dialog.isGroup || (dialog.isChannel && dialog.entity?.megagroup)
    if (!isGroupChat) continue
    const id = dialog.id?.toString?.()
    if (!id) continue
    result.push({
      id,
      subject: dialog.title || `Grupo ${id}`,
      size: dialog.entity?.participantsCount ?? 0,
      participants: [],
    })
  }

  return result
}

export async function importTelegramGroupMembers(
  connectionId: string,
  workspaceId: string,
  groupId: string,
  tags: string[],
): Promise<{ importedMembersCount: number }> {
  const client = getConnectedClient(connectionId)
  const entity = await resolveEntity(client, groupId)
  const participants = await client.getParticipants(entity, { limit: 2000 })

  let importedMembersCount = 0
  for (const user of participants) {
    if (!user || user.bot || user.self || user.deleted) continue
    const id = user.id?.toString?.()
    if (!id) continue
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
      || (user.username ? `@${user.username}` : `Contato ${id}`)

    const [existing] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.telegramChatId, id)))
      .limit(1)
    if (existing) continue

    const newId = generateId()
    await db.insert(contacts).values({
      id: newId,
      workspaceId,
      name,
      telegramChatId: id,
      tags: ['origem:grupo', ...tags],
      isGroup: false,
      optInStatus: true,
      optInAt: new Date(),
    })
    await db.insert(contactIdentities).values({
      id: generateId(),
      workspaceId,
      contactId: newId,
      channelType: 'telegram',
      channelIdentifier: id,
      isPrimary: true,
    }).onConflictDoNothing()
    importedMembersCount++
  }

  return { importedMembersCount }
}
