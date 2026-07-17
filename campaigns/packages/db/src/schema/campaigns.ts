import { pgTable, text, timestamp, integer, boolean, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { contacts } from './contacts'
import type {
  ChannelType,
  ConnectionStatus,
  MessageStatus,
  CampaignStatus,
  CampaignRunStatus,
  CampaignKind,
} from '@naia/schemas'

export const connections = pgTable('connections', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  channel: text('channel').$type<ChannelType>().notNull(),
  name: text('name').notNull(),
  status: text('status').$type<ConnectionStatus>().notNull().default('disconnected'),
  // Segredos por conexão (token do bot, sessão Baileys) — texto hoje, mesma
  // decisão do legado; criptografia em repouso fica para quando sair do dev.
  config: text('config').notNull().default('{}'),
  lastErrorAt: timestamp('last_error_at'),
  lastErrorMessage: text('last_error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const campaigns = pgTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // 'mixed' quando as conexões selecionadas cobrem mais de um canal
    channel: text('channel').$type<ChannelType | 'mixed'>().notNull(),
    status: text('status').$type<CampaignStatus>().notNull().default('draft'),
    kind: text('kind').$type<CampaignKind>().notNull().default('manual'),
    // Referência fraca à automação que gerou a campanha (sem FK para evitar
    // ciclo de imports com automations.ts; limpeza feita em código).
    automationId: text('automation_id'),
    segmentFilter: text('segment_filter').notNull().default('{}'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    scheduleJson: text('schedule_json').notNull().default('{"type":"immediate"}'),
    speedJson: text('speed_json').notNull().default('{"preset":"medio"}'),
    // Tag aplicada a todos os contatos alcançados no início de cada run
    applyTagOnDispatch: text('apply_tag_on_dispatch'),
    // Momento em que o usuário confirmou o checkbox de consentimento
    consentAt: timestamp('consent_at'),
    // Próxima execução (UTC) — o tick do scheduler varre este campo
    nextRunAt: timestamp('next_run_at'),
    occurrenceCount: integer('occurrence_count').notNull().default(0),
    // Legado one-shot; agendamento vigente vive em scheduleJson
    scheduledAt: timestamp('scheduled_at'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    // Agregados de todos os runs (fonte da verdade por run em campaign_runs)
    totalContacts: integer('total_contacts').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('campaigns_next_run_idx').on(table.nextRunAt)],
)

// Conexões selecionadas para o disparo — o pacer distribui as mensagens em
// round-robin entre as saudáveis do canal de cada mensagem.
export const campaignConnections = pgTable(
  'campaign_connections',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.connectionId] })],
)

// Uma execução da campanha. One-shot tem exatamente um run; recorrente cria um
// por ocorrência. Audiência é re-resolvida e a cota re-checada a cada run.
export const campaignRuns = pgTable(
  'campaign_runs',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    runNumber: integer('run_number').notNull(),
    status: text('status').$type<CampaignRunStatus>().notNull().default('pending'),
    scheduledFor: timestamp('scheduled_for').notNull(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    totalContacts: integer('total_contacts').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skipReason: text('skip_reason'),
    // true quando a cota mensal cortou parte da audiência deste run
    quotaTruncated: boolean('quota_truncated').notNull().default(false),
    // Heartbeat do pacer: instante do próximo passo agendado. Recovery só
    // re-enfileira pacer quando este instante está vencido há alguns minutos.
    // Null = pacer intencionalmente parado (pausa/conclusão).
    nextPacerAt: timestamp('next_pacer_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('campaign_runs_campaign_run_idx').on(table.campaignId, table.runNumber)],
)

// Variantes de mensagem (A/B/C…) rotacionadas entre os contatos — reduz
// padrão fixo de texto e a chance de marcação como spam.
export const campaignVariants = pgTable('campaign_variants', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0), // 0=A, 1=B…
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const campaignMessages = pgTable(
  'campaign_messages',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    // Nullable: linhas anteriores ao modelo de runs não têm run associado
    runId: text('run_id').references(() => campaignRuns.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    // Atribuída pelo pacer no momento do envio (round-robin entre saudáveis)
    connectionId: text('connection_id').references(() => connections.id),
    variantId: text('variant_id').references(() => campaignVariants.id, { onDelete: 'set null' }),
    // Canal resolvido por contato (campanha mista: WhatsApp tem prioridade)
    channel: text('channel').$type<ChannelType>(),
    status: text('status').$type<MessageStatus>().notNull().default('queued'),
    externalMessageId: text('external_message_id'),
    failureReason: text('failure_reason'),
    sentAt: timestamp('sent_at'),
    deliveredAt: timestamp('delivered_at'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('campaign_messages_run_status_idx').on(table.runId, table.status)],
)

export const whatsappSessions = pgTable(
  'whatsapp_sessions',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    keyId: text('key_id').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.keyId] })],
)

export const whatsappContactsCache = pgTable(
  'whatsapp_contacts_cache',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    contactJid: text('contact_jid').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    avatarUrl: text('avatar_url'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.contactJid] })],
)

export type Connection = typeof connections.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type CampaignConnection = typeof campaignConnections.$inferSelect
export type CampaignRun = typeof campaignRuns.$inferSelect
export type CampaignVariant = typeof campaignVariants.$inferSelect
export type CampaignMessage = typeof campaignMessages.$inferSelect
export type WhatsAppSession = typeof whatsappSessions.$inferSelect
export type WhatsAppContactCacheRow = typeof whatsappContactsCache.$inferSelect
