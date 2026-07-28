import {
  pgTable,
  text,
  timestamp,
  jsonb,
  unique,
  integer,
  boolean,
  index,
  date,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { agents } from './agents'

// Contatos: criados/atualizados automaticamente quando mensagem é recebida.
// Canais do contato vivem em contact_identities (um contato pode ter vários).
export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  company: text('company'),
  birthDate: date('birth_date'),
  // Avatar definido manualmente pelo agente (URL pública qualquer).
  avatarUrl: text('avatar_url'),
  // Foto de perfil puxada do canal (WhatsApp/Telegram) e guardada no MinIO do
  // CRM. Guarda o storageKey; a API serve via presigned URL. avatarUrl (manual)
  // tem precedência quando ambos existem.
  avatarStorageKey: text('avatar_storage_key'),
  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
  notes: text('notes'),
  // Contato bloqueado: inbound é descartado no worker e outbound retorna 409.
  blocked: boolean('blocked').notNull().default(false),
  blockedAt: timestamp('blocked_at'),
  firstContactAt: timestamp('first_contact_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Identidades de canal do contato: telefone do WhatsApp, chat id do Telegram, etc.
// O canal de origem da conversa sai daqui (identity primária), não mais de contacts.
export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    channelType: text('channel_type').$type<'whatsapp' | 'telegram'>().notNull(),
    // '+5511999999999', '123456789', etc.
    channelIdentifier: text('channel_identifier').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.workspaceId, table.channelType, table.channelIdentifier),
    index('idx_contact_identities_contact_id').on(table.contactId),
  ],
)

// Conexões: canais de entrada (WA/Telegram).
export const connections = pgTable('connections', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').$type<'whatsapp' | 'telegram'>().notNull(),
  status: text('status').$type<'active' | 'error' | 'disconnected'>().notNull().default('active'),
  // Configuração criptografada (sessão WhatsApp, token Telegram, etc).
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  // Fila para onde caem conversas novas desta conexão.
  defaultQueueId: text('default_queue_id').references((): AnyPgColumn => queues.id, { onDelete: 'set null' }),
  // Mensagem automática enviada quando uma conversa NOVA é criada nesta conexão
  // e nenhum bot assumiu o atendimento (bot ganha sempre). Null = desligada.
  welcomeMessage: text('welcome_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Estado de auth do Baileys por conexão WhatsApp (credenciais/keys da sessão).
export const whatsappSessions = pgTable(
  'whatsapp_sessions',
  {
    connectionId: text('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
    keyId: text('key_id').notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.keyId] })],
)

// Equipes de agentes: agrupam membros e podem ser atribuídas a filas.
export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.agentId] })],
)

// Filas de atendimento: agrupam agentes e roteiam conversas.
export const queues = pgTable('queues', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  description: text('description'),
  // Equipe responsável pela fila (null = sem equipe atribuída).
  teamId: text('team_id').references((): AnyPgColumn => teams.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const queueMembers = pgTable(
  'queue_members',
  {
    queueId: text('queue_id').notNull().references(() => queues.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.queueId, table.agentId] })],
)

// Conversas: thread de mensagens entre contato e workspace.
export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
    // Protocolo sequencial por workspace (gerado na criação pelo worker, a
    // partir do contador workspace_settings.next_protocol).
    protocol: integer('protocol').notNull(),
    status: text('status').$type<'open' | 'assigned' | 'pending' | 'resolved'>().notNull().default('open'),
    // Atendimento atual: cada ciclo resolve→reopen é um NOVO atendimento (ticket)
    // dentro da mesma conversa. Incrementa na reabertura; carimba mensagens e
    // sessões de bot para separar a thread por atendimento.
    atendimentoSeq: integer('atendimento_seq').notNull().default(1),
    assignedAgentId: text('assigned_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    queueId: text('queue_id').references(() => queues.id, { onDelete: 'set null' }),
    // Bot atendendo a conversa agora (fonte do badge no inbox). Null = sem bot.
    activeBotFlowId: text('active_bot_flow_id').references((): AnyPgColumn => botFlows.id, { onDelete: 'set null' }),
    // Título manual do atendimento (renomear conversa). Null = usa nome do contato.
    title: text('title'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at'),
    // Quando a pesquisa CSAT foi enviada ao contato (na resolução). Null =
    // pesquisa ainda não enviada; também sinaliza ao worker que a próxima
    // resposta do contato pode ser a nota (não reabre a conversa).
    csatSentAt: timestamp('csat_sent_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.protocol)],
)

// Anexo de mensagem: aponta para um objeto no storage (files.storageKey).
export type MessageAttachment = {
  storageKey: string
  mimeType: string
  kind: 'image' | 'video' | 'audio' | 'document'
  filename: string
}

// Mensagens dentro de cada conversa.
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
  content: text('content').notNull(),
  // Atendimento a que a mensagem pertence (carimbado por trigger a partir da
  // conversa no INSERT — ver migration). Base da separação da thread por atendimento.
  atendimentoSeq: integer('atendimento_seq').notNull().default(1),
  kind: text('kind').$type<'text' | 'image' | 'audio' | 'video' | 'document'>().notNull().default('text'),
  status: text('status').$type<'queued' | 'sent' | 'delivered' | 'read' | 'failed'>().notNull().default('queued'),
  // Agente autor (outbound manual); null em inbound e mensagens de bot.
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  // Id da mensagem no canal (WhatsApp message id, Telegram message id) — idempotência.
  externalMessageId: text('external_message_id'),
  connectionId: text('connection_id').references(() => connections.id, { onDelete: 'set null' }),
  attachments: jsonb('attachments').$type<MessageAttachment[]>().notNull().default([]),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
  failureReason: text('failure_reason'),
})

// Leitura de conversa por agente: último instante em que o agente abriu/leu
// a conversa. Base do contador de não lidas (mensagens inbound após lastReadAt;
// sem registro = todas as inbound contam).
export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.agentId] })],
)

// Notas internas: visíveis só para a equipe, não enviadas ao cliente.
export const internalNotes = pgTable('internal_notes', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Tags unificadas: categorizam contatos e conversas (substituem a tabela
// labels e os jsonb contacts.tags / conversations.labels).
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.name)],
)

export const contactTags = pgTable(
  'contact_tags',
  {
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.contactId, table.tagId] })],
)

export const conversationTags = pgTable(
  'conversation_tags',
  {
    conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.tagId] })],
)

// Arquivos do workspace (biblioteca de mídia do inbox). Bytes ficam no storage
// (S3/MinIO) sob storageKey = `${workspaceId}/${fileId}/${filename}`; aqui só metadados.
export const files = pgTable('files', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'image' | 'video' | 'audio' | 'document'>().notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  storageKey: text('storage_key').notNull().unique(),
  status: text('status').$type<'pending' | 'ready'>().notNull().default('pending'),
  uploadedByAgentId: text('uploaded_by_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Avaliação de atendimento (CSAT): uma por conversa (unique), capturada da
// primeira resposta do contato após o envio da pesquisa (csatSentAt).
export const conversationRatings = pgTable(
  'conversation_ratings',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // Uma avaliação por ATENDIMENTO (não por conversa): cada ciclo resolve→reopen
    // pode coletar sua própria nota.
    atendimentoSeq: integer('atendimento_seq').notNull().default(1),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    // Agente atribuído quando a conversa foi resolvida (null = sem dono/bot).
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    // Nota de 1 a 5.
    score: integer('score').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_conversation_ratings_workspace_id').on(table.workspaceId),
    unique().on(table.conversationId, table.atendimentoSeq),
  ],
)

// Histórico de transferências de conversa (entre agentes e/ou filas).
export const conversationTransfers = pgTable('conversation_transfers', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  fromAgentId: text('from_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  fromQueueId: text('from_queue_id').references(() => queues.id, { onDelete: 'set null' }),
  toAgentId: text('to_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  toQueueId: text('to_queue_id').references(() => queues.id, { onDelete: 'set null' }),
  note: text('note'),
  transferredByAgentId: text('transferred_by_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Respostas rápidas: templates disparados por atalho ("/saudacao") no composer.
export const quickReplies = pgTable(
  'quick_replies',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    shortcut: text('shortcut').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    // Arquivos anexados à resposta (ids em `files`, mesmo workspace). Ao usar o
    // atalho no composer, viram anexos da mensagem; ids que já não existem/estão
    // prontos são descartados na leitura.
    attachmentFileIds: jsonb('attachment_file_ids').$type<string[]>().notNull().default([]),
    createdByAgentId: text('created_by_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.shortcut)],
)

// Fluxos de bot (definição do grafo fica em `definition`) e sessões em execução.
export const botFlows = pgTable('bot_flows', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').$type<'draft' | 'active' | 'paused'>().notNull().default('draft'),
  triggerKind: text('trigger_kind')
    .$type<'new_conversation' | 'keyword' | 'always'>()
    .notNull()
    .default('new_conversation'),
  triggerKeywords: jsonb('trigger_keywords').$type<string[]>().notNull().default([]),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull().default({}),
  createdByAgentId: text('created_by_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const botSessions = pgTable('bot_sessions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  flowId: text('flow_id').notNull().references(() => botFlows.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  // Atendimento (ciclo resolve→reopen) em que esta sessão de bot rodou. Escopa
  // o "1 bot por atendimento": ao reabrir, o bot pode atender de novo.
  atendimentoSeq: integer('atendimento_seq').notNull().default(1),
  currentNodeId: text('current_node_id'),
  variables: jsonb('variables').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status')
    .$type<'running' | 'waiting_input' | 'handed_off' | 'finished' | 'failed' | 'cancelled'>()
    .notNull()
    .default('running'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type ContactIdentity = typeof contactIdentities.$inferSelect
export type NewContactIdentity = typeof contactIdentities.$inferInsert
export type Connection = typeof connections.$inferSelect
export type WhatsappSession = typeof whatsappSessions.$inferSelect
export type Team = typeof teams.$inferSelect
export type TeamMember = typeof teamMembers.$inferSelect
export type Queue = typeof queues.$inferSelect
export type QueueMember = typeof queueMembers.$inferSelect
export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type InternalNote = typeof internalNotes.$inferSelect
export type Tag = typeof tags.$inferSelect
export type ContactTag = typeof contactTags.$inferSelect
export type ConversationTag = typeof conversationTags.$inferSelect
export type FileRow = typeof files.$inferSelect
export type NewFile = typeof files.$inferInsert
export type ConversationTransfer = typeof conversationTransfers.$inferSelect
export type ConversationRating = typeof conversationRatings.$inferSelect
export type ConversationRead = typeof conversationReads.$inferSelect
export type QuickReply = typeof quickReplies.$inferSelect
export type BotFlow = typeof botFlows.$inferSelect
export type BotSession = typeof botSessions.$inferSelect
