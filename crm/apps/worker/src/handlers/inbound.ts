import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { ChannelMessage } from '@naia/channel-core'
import type { InboundMessageJob } from '@crm/queue'
import {
  db,
  connections,
  contactIdentities,
  contacts,
  conversations,
  conversationRatings,
  messages,
  workspaceSettings,
  CSAT_DEFAULT_THANK_YOU_MESSAGE,
  type BusinessHoursEntry,
  type Connection,
  type MessageAttachment,
} from '@crm/db'
import { generateId } from '../lib/ids'
import { buildInboxEvent, publishInboxEvent } from '../lib/events'
import { evaluateBotForInbound, sendSystemMessage } from '../bot/engine'

// Consumer de inbound-messages-v1: mensagens recebidas dos canais (já com mídia
// no storage) e atualizações de status de entrega/leitura das mensagens enviadas.

// Handle de transaction do Drizzle (tx dentro de db.transaction).
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function handleInboundMessage(job: InboundMessageJob): Promise<void> {
  if (job.kind === 'status') {
    await handleStatusUpdate(job)
    return
  }
  await handleChannelMessage(job)
}

// ─── kind: 'message' ─────────────────────────────────────────────────────────

async function handleChannelMessage(job: Extract<InboundMessageJob, { kind: 'message' }>): Promise<void> {
  const connection = await loadConnection(job.connectionId, job.workspaceId)
  if (!connection) {
    // Conexão removida entre o enqueue e o consumo: nada a fazer, sem retry.
    console.warn(`[crm-worker:inbound] conexão ${job.connectionId} não encontrada; job descartado`)
    return
  }

  const message = job.message

  // Idempotência pelo id externo (o BullMQ pode reprocessar em falhas tardias).
  const [duplicate] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.connectionId, connection.id), eq(messages.externalMessageId, message.externalMessageId)))
    .limit(1)
  if (duplicate) return

  const contactId = await resolveContact(job.workspaceId, connection, message)
  if (!contactId) {
    // Contato bloqueado: descarta silenciosamente (sem mensagem, sem conversa).
    console.warn(
      `[crm-worker:inbound] mensagem de contato bloqueado descartada (conexão ${connection.id}, from ${message.from.externalId})`,
    )
    return
  }

  // CSAT: se a última conversa do contato nesta conexão está resolvida com a
  // pesquisa enviada (csatSentAt) e ainda sem nota, uma resposta "1"–"5" é a
  // avaliação — grava o rating, agradece e NÃO reabre a conversa nem persiste
  // a mensagem na thread. Qualquer outro texto segue o fluxo normal (reabre).
  if (await tryCaptureCsatRating(job.workspaceId, connection, contactId, message)) {
    return
  }

  const { conversationId, isNewConversation, isNewAtendimento } = await resolveConversation(
    job.workspaceId,
    connection,
    contactId,
  )

  const attachments = mapAttachments(message)
  const occurredAt = new Date(message.occurredAt)
  await db.insert(messages).values({
    id: generateId(),
    conversationId,
    direction: 'inbound',
    content: message.text ?? '',
    kind: attachments[0]?.kind ?? 'text',
    status: 'sent',
    externalMessageId: message.externalMessageId,
    connectionId: connection.id,
    attachments,
    sentAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
  })

  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId))

  await publishInboxEvent(
    buildInboxEvent('message:received', {
      workspaceId: job.workspaceId,
      connectionId: connection.id,
      message,
    }),
  )

  // Horários de atendimento: fora do horário o workspace pode responder com
  // mensagem automática e/ou forçar um fluxo de bot específico.
  const outOfHours = await resolveOutOfHoursAction(job.workspaceId)
  if (outOfHours.autoReplyMessage) {
    await maybeSendOutOfHoursAutoReply(job.workspaceId, connection, conversationId, contactId, outOfHours.autoReplyMessage)
  }

  // Bot avalia DEPOIS da mensagem persistida e publicada: mesmo que o fluxo
  // falhe, o atendimento humano já tem a conversa no inbox.
  await evaluateBotForInbound({
    workspaceId: job.workspaceId,
    connectionId: connection.id,
    connectionKind: connection.kind,
    conversationId,
    contactId,
    message,
    isNewConversation,
    isNewAtendimento,
    ...(outOfHours.forceFlowId ? { forceFlowId: outOfHours.forceFlowId } : {}),
  })

  // Boas-vindas da conexão: só em conversa NOVA (não reabertura) e se nenhum
  // bot assumiu o atendimento (trigger new_conversation/out_of_hours) — o bot
  // ganha sempre. Best-effort: falha no envio não derruba o job.
  if (isNewConversation && connection.welcomeMessage?.trim()) {
    try {
      const [conversation] = await db
        .select({ activeBotFlowId: conversations.activeBotFlowId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1)
      if (!conversation?.activeBotFlowId) {
        await sendSystemMessage(
          {
            workspaceId: job.workspaceId,
            connectionId: connection.id,
            connectionKind: connection.kind,
            conversationId,
            contactId,
          },
          connection.welcomeMessage,
        )
      }
    } catch (error) {
      console.error('[crm-worker:inbound] falha ao enviar mensagem de boas-vindas:', error)
    }
  }
}

// ─── Horários de atendimento (workspace_settings) ────────────────────────────

// Fuso dos horários de atendimento (fixo por enquanto — os BusinessHoursEntry
// são configurados pensando em horário de Brasília).
const BUSINESS_HOURS_TZ = 'America/Sao_Paulo'

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const businessHoursFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_HOURS_TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type OutOfHoursAction = {
  autoReplyMessage: string | null
  forceFlowId: string | null
}

const NO_OUT_OF_HOURS_ACTION: OutOfHoursAction = { autoReplyMessage: null, forceFlowId: null }

// Sem linha em workspace_settings = sem restrição. Dentro do horário ou modo
// 'none' = nada a fazer.
async function resolveOutOfHoursAction(workspaceId: string): Promise<OutOfHoursAction> {
  const [settings] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1)
  if (!settings) return NO_OUT_OF_HOURS_ACTION
  if (isWithinBusinessHours(settings.businessHours, new Date())) return NO_OUT_OF_HOURS_ACTION

  const mode = settings.outOfHoursMode
  const autoReplyMessage =
    (mode === 'auto_reply' || mode === 'both') && settings.outOfHoursMessage?.trim()
      ? settings.outOfHoursMessage
      : null
  const forceFlowId = mode === 'bot' || mode === 'both' ? settings.outOfHoursBotFlowId : null
  return { autoReplyMessage, forceFlowId }
}

// businessHours null/vazio = sem restrição (24h). Dia ausente na lista =
// fechado o dia inteiro. Janelas são [start, end) em 'HH:mm'.
function isWithinBusinessHours(entries: BusinessHoursEntry[] | null, now: Date): boolean {
  if (!entries || entries.length === 0) return true
  const parts = businessHoursFormatter.formatToParts(now)
  const weekday = WEEKDAY_INDEX[parts.find((part) => part.type === 'weekday')?.value ?? '']
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (weekday === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return true
  const current = hour * 60 + minute
  return entries
    .filter((entry) => entry.day === weekday)
    .some((entry) => {
      const start = parseHHmm(entry.start)
      const end = parseHHmm(entry.end)
      return start !== null && end !== null && current >= start && current < end
    })
}

function parseHHmm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

const AUTO_REPLY_INTERVAL_MS = 12 * 60 * 60 * 1000

// No máximo 1 auto-reply por conversa a cada 12h — heurística: já existe
// mensagem outbound com o mesmo conteúdo enviada nas últimas 12h.
async function maybeSendOutOfHoursAutoReply(
  workspaceId: string,
  connection: Connection,
  conversationId: string,
  contactId: string,
  content: string,
): Promise<void> {
  const [recent] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'outbound'),
        eq(messages.content, content),
        gte(messages.sentAt, new Date(Date.now() - AUTO_REPLY_INTERVAL_MS)),
      ),
    )
    .limit(1)
  if (recent) return

  await sendSystemMessage(
    {
      workspaceId,
      connectionId: connection.id,
      connectionKind: connection.kind,
      conversationId,
      contactId,
    },
    content,
  )
}

// ─── CSAT: captura da nota pós-resolução ─────────────────────────────────────

// Interpreta a resposta do contato como nota: primeiro token numérico 1-5 =
// score; o restante do texto (se houver) vira comentário. "5", "4 bom",
// "5\nExcelente atendimento" parseiam; "oi, voltou o problema" não.
function parseCsatScore(text: string | null | undefined): { score: number; comment: string | null } | null {
  const trimmed = text?.trim() ?? ''
  const match = /^([1-5])(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return null
  const comment = match[2]?.trim()
  return { score: Number(match[1]), comment: comment ? comment : null }
}

// Tenta capturar a mensagem como avaliação CSAT. Retorna true quando a
// mensagem foi consumida pela pesquisa (rating gravado + agradecimento
// enviado) — o caller não deve seguir o fluxo normal nesse caso.
async function tryCaptureCsatRating(
  workspaceId: string,
  connection: Connection,
  contactId: string,
  message: ChannelMessage,
): Promise<boolean> {
  const [latest] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.connectionId, connection.id)))
    .orderBy(desc(conversations.createdAt))
    .limit(1)

  // Só há nota a capturar quando a conversa mais recente está resolvida com
  // a pesquisa já enviada ao contato.
  if (!latest || latest.status !== 'resolved' || !latest.csatSentAt) return false

  const parsed = parseCsatScore(message.text)
  if (!parsed) return false

  // Uma avaliação por conversa: se já existe (ex.: reprocessamento do job),
  // a mensagem segue o fluxo normal.
  const inserted = await db
    .insert(conversationRatings)
    .values({
      id: generateId(),
      workspaceId,
      conversationId: latest.id,
      atendimentoSeq: latest.atendimentoSeq,
      contactId,
      agentId: latest.assignedAgentId,
      score: parsed.score,
      comment: parsed.comment,
    })
    .onConflictDoNothing({
      target: [conversationRatings.conversationId, conversationRatings.atendimentoSeq],
    })
    .returning({ id: conversationRatings.id })
  if (inserted.length === 0) return false

  // Nota registrada: publica para o inbox mostrar a avaliação na thread em
  // tempo real (a API resolve o shape completo do rating no bridge Redis→WS).
  await publishInboxEvent(
    buildInboxEvent('conversation:rated', {
      workspaceId,
      conversationId: latest.id,
      ratingId: inserted[0]!.id,
    }),
  )

  const [settings] = await db
    .select({ csatThankYouMessage: workspaceSettings.csatThankYouMessage })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1)
  await sendSystemMessage(
    {
      workspaceId,
      connectionId: connection.id,
      connectionKind: connection.kind,
      conversationId: latest.id,
      contactId,
    },
    settings?.csatThankYouMessage?.trim() || CSAT_DEFAULT_THANK_YOU_MESSAGE,
  )
  return true
}

async function loadConnection(connectionId: string, workspaceId: string): Promise<Connection | null> {  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.workspaceId, workspaceId)))
    .limit(1)
  return connection ?? null
}

// Retorna null quando o contato existe mas está bloqueado (caller descarta).
async function resolveContact(
  workspaceId: string,
  connection: Connection,
  message: ChannelMessage,
): Promise<string | null> {
  const channelIdentifier = message.from.externalId
  const avatarStorageKey = readAvatarStorageKey(message)
  const [identity] = await db
    .select({ contactId: contactIdentities.contactId, blocked: contacts.blocked })
    .from(contactIdentities)
    .innerJoin(contacts, eq(contacts.id, contactIdentities.contactId))
    .where(
      and(
        eq(contactIdentities.workspaceId, workspaceId),
        eq(contactIdentities.channelType, connection.kind),
        eq(contactIdentities.channelIdentifier, channelIdentifier),
      ),
    )
    .limit(1)
  if (identity) {
    if (identity.blocked) return null
    // Foto de perfil atualizada (o session-host refaz a busca a cada 24h):
    // mantém contacts.avatar_storage_key em dia sem tocar no avatarUrl manual.
    if (avatarStorageKey) {
      await db
        .update(contacts)
        .set({ avatarStorageKey, updatedAt: new Date() })
        .where(eq(contacts.id, identity.contactId))
    }
    return identity.contactId
  }

  const contactId = generateId()
  await db.insert(contacts).values({
    id: contactId,
    workspaceId,
    name: readPushName(message) ?? channelIdentifier,
    avatarStorageKey,
    firstContactAt: new Date(),
  })
  await db.insert(contactIdentities).values({
    id: generateId(),
    workspaceId,
    contactId,
    channelType: connection.kind,
    channelIdentifier,
    isPrimary: true,
  })
  return contactId
}

async function resolveConversation(
  workspaceId: string,
  connection: Connection,
  contactId: string,
): Promise<{ conversationId: string; isNewConversation: boolean; isNewAtendimento: boolean }> {
  const [latest] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.connectionId, connection.id)))
    .orderBy(desc(conversations.createdAt))
    .limit(1)

  if (latest && latest.status !== 'resolved') {
    return { conversationId: latest.id, isNewConversation: false, isNewAtendimento: false }
  }

  if (latest) {
    // Cliente voltou a falar numa conversa resolvida: reabre, desatribui e
    // ABRE UM NOVO ATENDIMENTO (incrementa o seq). A mensagem que reabre já é
    // carimbada com o novo atendimento pelo trigger. Alinha com a state machine.
    await db
      .update(conversations)
      .set({
        status: 'open',
        assignedAgentId: null,
        resolvedAt: null,
        atendimentoSeq: sql`${conversations.atendimentoSeq} + 1`,
        // Novo atendimento: zera o marcador de pesquisa enviada para que o CSAT
        // possa ser disparado de novo ao resolver este atendimento.
        csatSentAt: null,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, latest.id))
    return { conversationId: latest.id, isNewConversation: false, isNewAtendimento: true }
  }

  // Nova conversa: protocolo sequencial por workspace, com o contador
  // incrementado na mesma transação (garante unicidade sem lacunas de lock).
  const conversationId = generateId()
  await db.transaction(async (tx) => {
    const protocol = await nextProtocolNumber(tx, workspaceId)
    await tx.insert(conversations).values({
      id: conversationId,
      workspaceId,
      contactId,
      connectionId: connection.id,
      status: 'open',
      queueId: connection.defaultQueueId,
      protocol,
    })
  })
  return { conversationId, isNewConversation: true, isNewAtendimento: true }
}

// Contador atômico por workspace: insere a linha de settings com o primeiro
// valor já consumido (2) ou incrementa a existente; retorna o número usado.
async function nextProtocolNumber(tx: DbTransaction, workspaceId: string): Promise<number> {
  const [row] = await tx
    .insert(workspaceSettings)
    .values({ workspaceId, nextProtocol: 2 })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: { nextProtocol: sql`${workspaceSettings.nextProtocol} + 1` },
    })
    .returning({ value: workspaceSettings.nextProtocol })
  return row.value - 1
}

// ChannelMessage não carrega metadata tipada; o session-host do CRM anexa
// pushName do WhatsApp como metadata extra. Lido de forma defensiva.
function readPushName(message: ChannelMessage): string | null {
  const metadata = (message as { metadata?: Record<string, unknown> }).metadata
  const pushName = metadata?.pushName
  return typeof pushName === 'string' && pushName.trim().length > 0 ? pushName.trim() : null
}

// storageKey da foto de perfil que o session-host subiu no MinIO (metadata
// extra, igual ao pushName). Ausente quando não há foto ou está throttled.
function readAvatarStorageKey(message: ChannelMessage): string | null {
  const metadata = (message as { metadata?: Record<string, unknown> }).metadata
  const key = metadata?.avatarStorageKey
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null
}

// ChannelAttachment.url carrega o storageKey do objeto no MinIO (o session-host
// sobe a mídia antes de enfileirar); messages.attachments guarda a referência.
function mapAttachments(message: ChannelMessage): MessageAttachment[] {
  return message.attachments.map((attachment) => ({
    storageKey: attachment.url,
    mimeType: attachment.mimeType ?? 'application/octet-stream',
    kind: attachment.kind,
    filename: attachment.filename ?? attachment.url.split('/').pop() ?? 'arquivo',
  }))
}

// ─── kind: 'status' ──────────────────────────────────────────────────────────

const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3 } as const

async function handleStatusUpdate(job: Extract<InboundMessageJob, { kind: 'status' }>): Promise<void> {
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.connectionId, job.connectionId), eq(messages.externalMessageId, job.externalMessageId)))
    .limit(1)
  if (!message) return

  // Idempotente: nunca regride (ex.: delivered depois de read) nem sobrescreve
  // read com failed tardio.
  if (message.status === 'read') return
  if (job.status !== 'failed' && STATUS_RANK[job.status] <= STATUS_RANK[message.status as keyof typeof STATUS_RANK]) {
    return
  }

  const timestamp = new Date(job.timestamp)
  const at = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp
  await db
    .update(messages)
    .set({
      status: job.status,
      ...(job.status === 'delivered' ? { deliveredAt: at } : {}),
      ...(job.status === 'read' ? { readAt: at, deliveredAt: message.deliveredAt ?? at } : {}),
    })
    .where(eq(messages.id, message.id))

  await publishInboxEvent(
    buildInboxEvent('message:status-updated', {
      workspaceId: job.workspaceId,
      conversationId: message.conversationId,
      messageId: message.id,
      status: job.status,
    }),
  )
}
