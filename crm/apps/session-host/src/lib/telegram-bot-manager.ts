// Gerenciador de bots Telegram (grammy, long polling) do CRM. Novo em relação
// ao Campaigns: lá o Telegram é conta de usuário (MTProto) para disparo; aqui
// é bot token (BotFather) como canal de atendimento do inbox.
//
// O token fica em connections.config.token (jsonb — o CRM não criptografa a
// config hoje; se isso mudar, descriptografar aqui antes de instanciar o Bot).
import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy'
import { db, connections } from '@crm/db'
import { eq } from 'drizzle-orm'
import { getCrmQueue, CRM_QUEUES, defaultCrmJobOptions, type InboundMessageJob, type OutboundButton } from '@crm/queue'
import type { ChannelMessage, ChannelAttachment } from '@naia/channel-core'
import type { MediaRef } from '@crm/schemas'
import { putObject, getObjectBytes } from '@crm/storage'
import { publishSessionConnected, publishSessionDisconnected } from './session-events'

type BotStatus = 'connecting' | 'connected' | 'disconnected'
type BotEntry = { status: BotStatus; bot: Bot | null }

const botMap = new Map<string, BotEntry>()

function readToken(config: Record<string, unknown> | null | undefined): string | null {
  const token = config?.token
  return typeof token === 'string' && token.length > 0 ? token : null
}

function extFromMime(mimeType: string | undefined, fallback: string): string {
  const ext = mimeType?.split('/')[1]?.split(';')[0]?.trim()
  return ext || fallback
}

function sanitizeFilename(filename: string): string {
  const clean = filename.replace(/[^\w.-]+/g, '_')
  return clean || 'arquivo'
}

type TelegramMedia = {
  fileId: string
  kind: MediaRef['kind']
  mimeType: string
  filename: string
}

// Extrai o arquivo de uma mensagem Telegram (foto maior, vídeo, áudio, voz ou
// documento). Retorna null para mensagem só de texto.
function extractMedia(ctx: Context): TelegramMedia | null {
  const msg = ctx.message
  if (!msg) return null

  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1]!
    return { fileId: largest.file_id, kind: 'image', mimeType: 'image/jpeg', filename: 'foto.jpg' }
  }
  if (msg.video) {
    const mimeType = msg.video.mime_type ?? 'video/mp4'
    return {
      fileId: msg.video.file_id,
      kind: 'video',
      mimeType,
      filename: msg.video.file_name ?? `video.${extFromMime(mimeType, 'mp4')}`,
    }
  }
  if (msg.audio) {
    const mimeType = msg.audio.mime_type ?? 'audio/mpeg'
    return {
      fileId: msg.audio.file_id,
      kind: 'audio',
      mimeType,
      filename: msg.audio.file_name ?? `audio.${extFromMime(mimeType, 'mp3')}`,
    }
  }
  if (msg.voice) {
    const mimeType = msg.voice.mime_type ?? 'audio/ogg'
    return { fileId: msg.voice.file_id, kind: 'audio', mimeType, filename: `audio.${extFromMime(mimeType, 'ogg')}` }
  }
  if (msg.document) {
    const mimeType = msg.document.mime_type ?? 'application/octet-stream'
    return {
      fileId: msg.document.file_id,
      kind: 'document',
      mimeType,
      filename: msg.document.file_name ?? `documento.${extFromMime(mimeType, 'bin')}`,
    }
  }
  return null
}

async function downloadTelegramFile(bot: Bot, token: string, fileId: string): Promise<Uint8Array> {
  const file = await bot.api.getFile(fileId)
  if (!file.file_path) throw new Error('Telegram não retornou file_path para o arquivo.')
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
  if (!res.ok) throw new Error(`Falha ao baixar arquivo do Telegram (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function startTelegramBot(connectionId: string): Promise<void> {
  const current = botMap.get(connectionId)
  if (current?.status === 'connected' || current?.status === 'connecting') {
    return
  }

  const [conn] = await db
    .select({ workspaceId: connections.workspaceId, kind: connections.kind, config: connections.config })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (!conn || conn.kind !== 'telegram') {
    throw new Error(`[telegram-manager] Conexão ${connectionId} não encontrada ou não é Telegram.`)
  }

  const token = readToken(conn.config)
  if (!token) {
    await db
      .update(connections)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(connections.id, connectionId))
    throw new Error(`[telegram-manager] Conexão ${connectionId} sem bot token em config.token.`)
  }

  const workspaceId = conn.workspaceId
  botMap.set(connectionId, { status: 'connecting', bot: null })

  const bot = new Bot(token)

  // Valida o token antes de subir o polling — token inválido falha aqui.
  const me = await bot.api.getMe()

  const enqueueInbound = (externalMessageId: string, message: ChannelMessage & { metadata?: Record<string, unknown> }) => {
    const jobId = `inbound:message:${connectionId}:${externalMessageId}`
    getCrmQueue<InboundMessageJob>(CRM_QUEUES.INBOUND_MESSAGES)
      .add(
        jobId,
        { kind: 'message', workspaceId, connectionId, message },
        { ...defaultCrmJobOptions, jobId },
      )
      .catch((err) => console.error(`[telegram-manager] [${connectionId}] falha ao enfileirar inbound:`, err))
  }

  bot.on('message', async (ctx) => {
    try {
      const msg = ctx.message
      if (!msg) return
      // Eco do próprio bot nunca vira conversa.
      if (msg.from?.is_bot) return

      const externalMessageId = String(msg.message_id)
      const media = extractMedia(ctx)
      const text = msg.text ?? msg.caption ?? null
      if (!text && !media) return

      // No inbound o `url` do ChannelAttachment carrega o storageKey (mesmo
      // padrão do WhatsApp — ver whatsapp-manager.ts).
      const attachments: ChannelAttachment[] = []
      if (media) {
        try {
          const bytes = await downloadTelegramFile(bot, token, media.fileId)
          const filename = sanitizeFilename(media.filename)
          const storageKey = `${workspaceId}/inbound/${externalMessageId}/${filename}`
          await putObject(storageKey, bytes, media.mimeType)
          attachments.push({ kind: media.kind, url: storageKey, mimeType: media.mimeType, filename })
        } catch (err) {
          console.error(`[telegram-manager] [${connectionId}] falha ao baixar/subir mídia de ${externalMessageId}:`, err)
        }
      }

      const pushName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim()
        || (msg.from?.username ?? '')
      const message = {
        externalMessageId,
        from: { channel: 'telegram', externalId: String(msg.chat.id) },
        to: { channel: 'telegram', externalId: String(me.id) },
        text,
        attachments,
        occurredAt: new Date(msg.date * 1000).toISOString(),
        // Extra fora do contrato tipado: o worker usa pushName para nomear o contato.
        ...(pushName ? { metadata: { pushName } } : {}),
      } satisfies ChannelMessage & { metadata?: Record<string, unknown> }

      enqueueInbound(externalMessageId, message)
    } catch (err) {
      console.error(`[telegram-manager] [${connectionId}] erro no inbound:`, err)
    }
  })

  // Clique em botão de inline keyboard (nó 'buttons' do bot): entra como
  // mensagem inbound cujo texto é o callback_data (= id da opção), marcada
  // como isButtonCallback na metadata extra (mesmo padrão do pushName).
  bot.on('callback_query', async (ctx) => {
    try {
      const query = ctx.callbackQuery
      // Responde sempre — tira o estado de "carregando" do botão no cliente.
      await ctx.answerCallbackQuery().catch(() => {})
      if (query.from.is_bot) return
      const data = query.data
      const chatId = query.message?.chat.id
      if (!data || !chatId) return

      const externalMessageId = `cbq:${query.id}`
      const pushName = [query.from.first_name, query.from.last_name].filter(Boolean).join(' ').trim()
        || (query.from.username ?? '')
      const message = {
        externalMessageId,
        from: { channel: 'telegram', externalId: String(chatId) },
        to: { channel: 'telegram', externalId: String(me.id) },
        text: data,
        attachments: [],
        occurredAt: new Date().toISOString(),
        metadata: { isButtonCallback: true, ...(pushName ? { pushName } : {}) },
      } satisfies ChannelMessage & { metadata?: Record<string, unknown> }

      enqueueInbound(externalMessageId, message)
    } catch (err) {
      console.error(`[telegram-manager] [${connectionId}] erro no callback_query:`, err)
    }
  })

  bot.catch((err) => {
    console.error(`[telegram-manager] [${connectionId}] erro no polling:`, err.error ?? err)
  })

  // bot.start() resolve só quando o polling para — fica em background.
  bot.start({
    onStart: () => {
      console.log(`[telegram-manager] [${connectionId}] polling ativo como @${me.username}`)
    },
  }).catch((err) => {
    console.error(`[telegram-manager] [${connectionId}] polling encerrado com erro:`, err)
    botMap.delete(connectionId)
  })

  botMap.set(connectionId, { status: 'connected', bot })

  await db
    .update(connections)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(connections.id, connectionId))

  publishSessionConnected({ workspaceId, connectionId, channel: 'telegram' })
    .catch((err) => console.error(`[telegram-manager] [${connectionId}] falha ao publicar connected:`, err))
}

export function getTelegramBotStatus(connectionId: string): BotStatus {
  return botMap.get(connectionId)?.status ?? 'disconnected'
}

export async function stopTelegramBot(connectionId: string, reason: string | null = null): Promise<void> {
  const entry = botMap.get(connectionId)
  botMap.delete(connectionId)
  if (entry?.bot) {
    try { await entry.bot.stop() } catch { /* ignore */ }
  }

  const [conn] = await db
    .select({ workspaceId: connections.workspaceId })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  await db
    .update(connections)
    .set({ status: 'disconnected', updatedAt: new Date() })
    .where(eq(connections.id, connectionId))
    .catch(() => {})

  if (conn) {
    publishSessionDisconnected({ workspaceId: conn.workspaceId, connectionId, channel: 'telegram', reason })
      .catch((err) => console.error(`[telegram-manager] [${connectionId}] falha ao publicar disconnected:`, err))
  }
}

export async function sendTelegramMessage(
  connectionId: string,
  chatId: string,
  content: string,
  media?: MediaRef[],
  buttons?: OutboundButton[],
): Promise<{ externalMessageId: string }> {
  const entry = botMap.get(connectionId)
  if (!entry?.bot || entry.status !== 'connected') {
    throw new Error('Bot Telegram não está conectado no momento.')
  }
  const { bot } = entry

  if (!media || media.length === 0) {
    // Botões viram inline keyboard (uma por linha; callback_data = id da opção).
    const keyboard = buttons && buttons.length > 0 ? buildInlineKeyboard(buttons) : undefined
    const result = await bot.api.sendMessage(chatId, content, keyboard ? { reply_markup: keyboard } : {})
    return { externalMessageId: String(result.message_id) }
  }

  // Com mídia os botões são ignorados — o nó 'buttons' do bot envia só texto.

  // Telegram aceita caption em todas as mídias — a primeira carrega o texto.
  let firstId = ''

  for (let i = 0; i < media.length; i++) {
    const m = media[i]!
    const bytes = await getObjectBytes(m.storageKey)
    const file = new InputFile(bytes, m.filename)
    const caption = i === 0 && content ? content : undefined

    const result =
      m.kind === 'image' ? await bot.api.sendPhoto(chatId, file, { caption })
      : m.kind === 'video' ? await bot.api.sendVideo(chatId, file, { caption })
      : m.kind === 'audio' ? await bot.api.sendAudio(chatId, file, { caption })
      : await bot.api.sendDocument(chatId, file, { caption })

    if (!firstId) firstId = String(result.message_id)
  }

  return { externalMessageId: firstId }
}

function buildInlineKeyboard(buttons: OutboundButton[]): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  for (const button of buttons) {
    keyboard.text(button.label, button.id).row()
  }
  return keyboard
}
