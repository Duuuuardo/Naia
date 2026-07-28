// Gerenciador de sessões WhatsApp (Baileys) do CRM. Portado do session-host do
// Campaigns, removendo o que não se aplica ao produto de inbox: opt-in inline,
// cache de contatos de campanha, pacer, follow-ups e rotas de contatos/grupos.
// O que sobra: ciclo de vida do socket (QR, reconexão, logout), inbound de
// mensagens (com mídia → storage) e status de entrega → fila inbound-messages-v1,
// e envio outbound com mídia via storage.
import { db, connections, whatsappSessions } from '@crm/db'
import { eq } from 'drizzle-orm'
import { getCrmQueue, CRM_QUEUES, defaultCrmJobOptions, type InboundMessageJob } from '@crm/queue'
import type { ChannelMessage, ChannelAttachment } from '@naia/channel-core'
import type { MediaRef } from '@crm/schemas'
import { putObject, getObjectBytes } from '@crm/storage'
import { usePostgresAuthState } from './use-postgres-auth-state'
import { publishSessionConnected, publishSessionDisconnected, publishSessionQrUpdated } from './session-events'
import { notifyWorkspaceOwner, CRM_WEB_URL } from './vianova-notifications'

type QREntry = { qr: string; expiresAt: Date }
type SocketEntry = { status: 'connecting' | 'connected' | 'disconnected'; socket: unknown }

const qrMap = new Map<string, QREntry>()
export const socketMap = new Map<string, SocketEntry>()

// Backoff de reconexão por conexão: 5s, 10s, 20s... até 60s. Zera no 'open'.
const reconnectAttempts = new Map<string, number>()
const MAX_RECONNECT_DELAY_MS = 60_000

// Throttle da foto de perfil: buscamos no máximo 1x por contato a cada 24h por
// processo (o profilePictureUrl é uma chamada de rede sujeita a rate limit do
// WhatsApp). Chave: `${connectionId}:${jid}`.
const avatarFetchedAt = new Map<string, number>()
const AVATAR_REFETCH_MS = 24 * 60 * 60 * 1000

// Busca a foto de perfil do remetente e sobe no MinIO do CRM. Retorna o
// storageKey (para o worker gravar em contacts.avatar_storage_key) ou null
// (sem foto, privacidade, rate limit ou falha — nunca derruba a mensagem).
// Throttled: só refaz depois de AVATAR_REFETCH_MS para o mesmo contato.
async function maybeFetchWhatsAppAvatar(
  socket: any,
  workspaceId: string,
  connectionId: string,
  jid: string,
  externalId: string,
): Promise<string | null> {
  const throttleKey = `${connectionId}:${jid}`
  const last = avatarFetchedAt.get(throttleKey)
  if (last && Date.now() - last < AVATAR_REFETCH_MS) return null
  avatarFetchedAt.set(throttleKey, Date.now())
  try {
    const url: string | undefined = await socket.profilePictureUrl(jid, 'image')
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const storageKey = `${workspaceId}/avatars/whatsapp/${externalId.replace(/[^\w.-]/g, '_')}.jpg`
    await putObject(storageKey, bytes, 'image/jpeg')
    return storageKey
  } catch {
    // Sem foto pública / privacidade / rate limit: contato fica só com iniciais.
    return null
  }
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

function isConfigEmpty(config: Record<string, unknown> | null | undefined): boolean {
  return !config || Object.keys(config).length === 0
}

function enqueueInbound(job: InboundMessageJob, jobId: string): void {
  // BullMQ proíbe ':' em custom job id (só no nome). O jobId de idempotência
  // ('inbound:message:conn:extId') usa ':' como separador — troca por '_' para
  // o id, mantendo o nome legível. Sem isso, todo inbound falha ao enfileirar.
  const safeJobId = jobId.replace(/:/g, '_')
  getCrmQueue<InboundMessageJob>(CRM_QUEUES.INBOUND_MESSAGES)
    .add(jobId, job, { ...defaultCrmJobOptions, jobId: safeJobId })
    .catch((err) => console.error(`[whatsapp-manager] falha ao enfileirar ${jobId}:`, err))
}

// Telefone/JID do remetente. Baileys 7 endereça chats individuais por LID:
// remoteJid pode vir como '123...@lid' — nesse caso o número real vem em
// remoteJidAlt. Sem resolução possível, devolve os dígitos do próprio JID.
function resolveExternalId(msg: any): string {
  const remoteJid: string = msg?.key?.remoteJid ?? ''
  if (remoteJid.endsWith('@lid')) {
    const alt = typeof msg?.key?.remoteJidAlt === 'string' ? msg.key.remoteJidAlt : ''
    if (alt) return alt.replace(/@.*$/, '').replace(/\D/g, '')
  }
  return remoteJid.replace(/@.*$/, '').replace(/\D/g, '')
}

type InboundMedia = {
  baileysMessage: Record<string, unknown>
  kind: MediaRef['kind']
  mimeType: string
  filename: string
  caption?: string
}

function extFromMime(mimeType: string, fallback: string): string {
  const ext = mimeType.split('/')[1]?.split(';')[0]?.trim()
  return ext || fallback
}

function sanitizeFilename(filename: string): string {
  const clean = filename.replace(/[^\w.-]+/g, '_')
  return clean || 'arquivo'
}

// Extrai texto e mídia de uma mensagem Baileys. Retorna null se não há nada
// útil para o inbox (ex.: reaction, protocol message).
function extractContent(msg: any): { text: string | null; media: InboundMedia | null } {
  const m = msg?.message
  if (!m) return { text: null, media: null }

  if (typeof m.conversation === 'string') return { text: m.conversation, media: null }
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text, media: null }

  if (m.imageMessage) {
    const mimeType = m.imageMessage.mimetype ?? 'image/jpeg'
    return {
      text: m.imageMessage.caption ?? null,
      media: {
        baileysMessage: m.imageMessage,
        kind: 'image',
        mimeType,
        filename: `imagem.${extFromMime(mimeType, 'jpg')}`,
        caption: m.imageMessage.caption ?? undefined,
      },
    }
  }
  if (m.videoMessage) {
    const mimeType = m.videoMessage.mimetype ?? 'video/mp4'
    return {
      text: m.videoMessage.caption ?? null,
      media: {
        baileysMessage: m.videoMessage,
        kind: 'video',
        mimeType,
        filename: `video.${extFromMime(mimeType, 'mp4')}`,
        caption: m.videoMessage.caption ?? undefined,
      },
    }
  }
  if (m.audioMessage) {
    const mimeType = m.audioMessage.mimetype ?? 'audio/ogg'
    return {
      text: null,
      media: {
        baileysMessage: m.audioMessage,
        kind: 'audio',
        mimeType,
        filename: `audio.${extFromMime(mimeType, 'ogg')}`,
      },
    }
  }
  if (m.documentMessage) {
    const mimeType = m.documentMessage.mimetype ?? 'application/octet-stream'
    return {
      text: m.documentMessage.caption ?? null,
      media: {
        baileysMessage: m.documentMessage,
        kind: 'document',
        mimeType,
        filename: m.documentMessage.fileName ?? `documento.${extFromMime(mimeType, 'bin')}`,
        caption: m.documentMessage.caption ?? undefined,
      },
    }
  }

  return { text: null, media: null }
}

async function handleInboundMessage(
  socket: unknown,
  connectionId: string,
  workspaceId: string,
  msg: any,
): Promise<void> {
  const externalMessageId: string | undefined = msg?.key?.id
  if (!externalMessageId) return

  const { text, media } = extractContent(msg)
  if (!text && !media) return

  // No inbound o `url` do ChannelAttachment carrega o storageKey (não há URL
  // pública): o worker persiste como messages.attachments.storageKey e a API
  // gera presigned URL sob demanda.
  const attachments: ChannelAttachment[] = []

  if (media) {
    try {
      const { downloadMediaMessage } = loadBaileys()
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: silentLogger as never, reuploadRequest: (socket as any).updateMediaMessage },
      )) as Buffer
      const filename = sanitizeFilename(media.filename)
      const storageKey = `${workspaceId}/inbound/${externalMessageId}/${filename}`
      await putObject(storageKey, new Uint8Array(buffer), media.mimeType)
      attachments.push({ kind: media.kind, url: storageKey, mimeType: media.mimeType, filename })
    } catch (err) {
      // Sem a mídia a mensagem ainda entra (texto/caption), senão perderíamos
      // o atendimento inteiro por uma falha de download.
      console.error(`[whatsapp-manager] [${connectionId}] falha ao baixar/subir mídia de ${externalMessageId}:`, err)
    }
  }

  const ts = Number(msg?.messageTimestamp ?? 0)
  const pushName = typeof msg?.pushName === 'string' && msg.pushName.trim() ? msg.pushName.trim() : null
  const externalId = resolveExternalId(msg)
  // Foto de perfil (throttled): jid real do chat p/ o profilePictureUrl.
  const avatarJid: string = msg?.key?.remoteJid ?? `${externalId}@s.whatsapp.net`
  const avatarStorageKey = await maybeFetchWhatsAppAvatar(socket, workspaceId, connectionId, avatarJid, externalId)
  const metadata: Record<string, unknown> = {
    // Extra fora do contrato tipado: o worker usa pushName para nomear o
    // contato e avatarStorageKey para a foto de perfil.
    ...(pushName ? { pushName } : {}),
    ...(avatarStorageKey ? { avatarStorageKey } : {}),
  }
  const message = {
    externalMessageId,
    from: { channel: 'whatsapp', externalId },
    to: { channel: 'whatsapp', externalId: (socket as any).user?.id ?? connectionId },
    text,
    attachments,
    occurredAt: ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  } satisfies ChannelMessage & { metadata?: Record<string, unknown> }

  enqueueInbound({ kind: 'message', workspaceId, connectionId, message }, `inbound:message:${connectionId}:${externalMessageId}`)
}

function mapReceiptStatus(statusVal: unknown): 'delivered' | 'read' | 'failed' | null {
  if (statusVal === 3 || statusVal === 'DELIVERY_ACK') return 'delivered'
  if (statusVal === 4 || statusVal === 5 || statusVal === 'READ' || statusVal === 'PLAYED') return 'read'
  if (statusVal === 0 || statusVal === 'ERROR') return 'failed'
  return null
}

export async function startWhatsAppSession(connectionId: string): Promise<void> {
  const current = socketMap.get(connectionId)
  if (current?.status === 'connected' || current?.status === 'connecting') {
    return
  }

  socketMap.set(connectionId, { status: 'connecting', socket: null })

  const baileys = loadBaileys()
  const { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, BufferJSON } = baileys

  const [conn] = await db
    .select({ workspaceId: connections.workspaceId, config: connections.config })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (!conn) {
    socketMap.delete(connectionId)
    throw new Error(`[whatsapp-manager] Conexão ${connectionId} não encontrada.`)
  }
  const workspaceId = conn.workspaceId

  // Sem credenciais salvas (conexão nova, reconectar manual ou logout) → limpa
  // restos de sessão para forçar pareamento novo (QR).
  if (isConfigEmpty(conn.config)) {
    await db.delete(whatsappSessions).where(eq(whatsappSessions.connectionId, connectionId)).catch(() => {})
  }

  const { state, saveCreds } = await usePostgresAuthState(connectionId)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Naia CRM', 'Chrome', '124'],
    logger: silentLogger as never,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
  })

  socketMap.set(connectionId, { status: 'connecting', socket })

  socket.ev.on('creds.update', async () => {
    try {
      await saveCreds()
      await db
        .update(connections)
        .set({ config: JSON.parse(JSON.stringify(state.creds, BufferJSON.replacer)), updatedAt: new Date() })
        .where(eq(connections.id, connectionId))
    } catch (err) {
      console.error(`[whatsapp-manager] Erro em creds.update para ${connectionId}:`, err)
    }
  })

  socket.ev.on('messages.upsert', async ({ messages, type }: { messages: any[]; type: string }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      try {
        const remoteJid: string = msg?.key?.remoteJid ?? ''
        // Grupos, broadcast e status não viram conversa no inbox.
        if (
          msg?.key?.fromMe
          || !msg?.message
          || remoteJid.endsWith('@g.us')
          || remoteJid.endsWith('@broadcast')
          || remoteJid === 'status@broadcast'
          || remoteJid.endsWith('@newsletter')
        ) {
          continue
        }
        await handleInboundMessage(socket, connectionId, workspaceId, msg)
      } catch (err) {
        console.error(`[whatsapp-manager] [${connectionId}] erro no inbound:`, err)
      }
    }
  })

  socket.ev.on('messages.update', async (updates: any[]) => {
    if (!Array.isArray(updates)) return
    for (const item of updates) {
      const extId = item?.key?.id
      if (!extId) continue
      const newStatus = mapReceiptStatus(item?.update?.status)
      if (newStatus) {
        enqueueInbound(
          {
            kind: 'status',
            workspaceId,
            connectionId,
            externalMessageId: extId,
            status: newStatus,
            timestamp: new Date().toISOString(),
          },
          `inbound:status:${connectionId}:${extId}:${newStatus}`,
        )
      }
    }
  })

  socket.ev.on('message-receipt.update', async (updates: any[]) => {
    if (!Array.isArray(updates)) return
    for (const item of updates) {
      const extId = item?.key?.id
      const receipt = item?.receipt
      if (!extId || !receipt) continue
      let newStatus: 'delivered' | 'read' | null = null
      if (receipt.readTimestamp || (receipt as any).playedTimestamp) {
        newStatus = 'read'
      } else if (receipt.receiptTimestamp) {
        newStatus = 'delivered'
      }
      if (newStatus) {
        const tsSec = receipt.readTimestamp || (receipt as any).playedTimestamp || receipt.receiptTimestamp
        const timestamp = typeof tsSec === 'number' && tsSec > 0 ? new Date(tsSec * 1000).toISOString() : new Date().toISOString()
        enqueueInbound(
          { kind: 'status', workspaceId, connectionId, externalMessageId: extId, status: newStatus, timestamp },
          `inbound:status:${connectionId}:${extId}:${newStatus}`,
        )
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
      publishSessionQrUpdated({ workspaceId, connectionId, qrCode: qr })
        .catch((err) => console.error(`[whatsapp-manager] [${connectionId}] falha ao publicar QR:`, err))
    }

    if (connection === 'open') {
      qrMap.delete(connectionId)
      reconnectAttempts.delete(connectionId)
      socketMap.set(connectionId, { status: 'connected', socket })

      await saveCreds().catch(() => {})

      await db
        .update(connections)
        .set({
          status: 'active',
          config: JSON.parse(JSON.stringify(state.creds, BufferJSON.replacer)),
          updatedAt: new Date(),
        })
        .where(eq(connections.id, connectionId))

      publishSessionConnected({ workspaceId, connectionId, channel: 'whatsapp' })
        .catch((err) => console.error(`[whatsapp-manager] [${connectionId}] falha ao publicar connected:`, err))
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401

      socketMap.delete(connectionId)
      qrMap.delete(connectionId)

      if (shouldReconnect) {
        // Queda transitória (stream restart, rede): as credenciais continuam
        // válidas — reconecta com backoff sem mexer no status persistido.
        const attempt = (reconnectAttempts.get(connectionId) ?? 0) + 1
        reconnectAttempts.set(connectionId, attempt)
        const delay = Math.min(5_000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS)
        console.warn(`[whatsapp-manager] [${connectionId}] conexão caiu (tentativa ${attempt}, retry em ${delay}ms)`)
        setTimeout(() => {
          startWhatsAppSession(connectionId).catch(console.error)
        }, delay)
      } else {
        reconnectAttempts.delete(connectionId)
        await db.delete(whatsappSessions).where(eq(whatsappSessions.connectionId, connectionId)).catch(() => {})
        const [connInfo] = await db
          .select({ name: connections.name })
          .from(connections)
          .where(eq(connections.id, connectionId))
          .limit(1)
        const reason = 'Aparelho desconectado pelo celular ou sessão expirada.'
        await db
          .update(connections)
          .set({ status: 'disconnected', config: {}, updatedAt: new Date() })
          .where(eq(connections.id, connectionId))
        publishSessionDisconnected({ workspaceId, connectionId, channel: 'whatsapp', reason })
          .catch((err) => console.error(`[whatsapp-manager] [${connectionId}] falha ao publicar disconnected:`, err))
        notifyWorkspaceOwner(workspaceId, {
          type: 'product',
          title: 'WhatsApp desconectado',
          body: `A conexão "${connInfo?.name ?? connectionId}" do WhatsApp foi desconectada. Reconecte para continuar o atendimento.`,
          actionUrl: `${CRM_WEB_URL}/inbox/admin/connections`,
          actionLabel: 'Reconectar',
          metadata: { connectionId, connectionName: connInfo?.name, channel: 'whatsapp', reason: 'whatsapp_disconnected' },
        }).catch((err) => console.error('[whatsapp-manager] falha ao notificar desconexão:', err))
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

export async function disconnectWhatsApp(connectionId: string, options: { logout?: boolean } = {}): Promise<void> {
  const entry = socketMap.get(connectionId)
  if (entry?.socket) {
    const socket = entry.socket as { logout?: () => Promise<void>; end?: () => void }
    // Sem logout explícito, apenas encerra o socket: as credenciais ficam e a
    // sessão pode ser retomada. Com logout, o 'close' chega como loggedOut e
    // limpa sessão + config pelo handler de connection.update.
    try {
      if (options.logout) await socket.logout?.()
      else socket.end?.()
    } catch { /* ignore */ }
    try { socket.end?.() } catch { /* ignore */ }
  }
  socketMap.delete(connectionId)
  qrMap.delete(connectionId)
  reconnectAttempts.delete(connectionId)

  if (options.logout) {
    // Garantia extra caso o evento 'close' não chegue (socket já morto).
    await db.delete(whatsappSessions).where(eq(whatsappSessions.connectionId, connectionId)).catch(() => {})
    await db
      .update(connections)
      .set({ status: 'disconnected', config: {}, updatedAt: new Date() })
      .where(eq(connections.id, connectionId))
      .catch(() => {})
  }
}

export async function sendWhatsAppMessage(
  connectionId: string,
  phone: string,
  content: string,
  media?: MediaRef[],
): Promise<{ externalMessageId: string }> {
  const entry = socketMap.get(connectionId)
  if (!entry?.socket || entry.status !== 'connected') {
    throw new Error('Conexão WhatsApp não está conectada no momento.')
  }
  const socket = entry.socket as { sendMessage: (jid: string, msg: Record<string, unknown>) => Promise<{ key?: { id?: string } }> }
  // JIDs completos (grupos '@g.us', '@lid') passam intactos
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

  // Primeira mídia carrega o texto como caption (áudio não suporta caption —
  // nesse caso o texto vai como mensagem separada depois)
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
