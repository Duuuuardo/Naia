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
  config: text('config').notNull().default('{}'),
  lastErrorAt: timestamp('last_error_at'),
  lastErrorMessage: text('last_error_message'),
  termsAcceptedAt: timestamp('terms_accepted_at'),
  termsAcceptedByUserId: text('terms_accepted_by_user_id'),
  termsVersion: text('terms_version'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const campaigns = pgTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    channel: text('channel').$type<ChannelType | 'mixed'>().notNull(),
    status: text('status').$type<CampaignStatus>().notNull().default('draft'),
    kind: text('kind').$type<CampaignKind>().notNull().default('manual'),
    automationId: text('automation_id'),
    segmentFilter: text('segment_filter').notNull().default('{}'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    scheduleJson: text('schedule_json').notNull().default('{"type":"immediate"}'),
    speedJson: text('speed_json').notNull().default('{"preset":"medio"}'),
    applyTagOnDispatch: text('apply_tag_on_dispatch'),
    consentAt: timestamp('consent_at'),
    nextRunAt: timestamp('next_run_at'),
    occurrenceCount: integer('occurrence_count').notNull().default(0),
    scheduledAt: timestamp('scheduled_at'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
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
    quotaTruncated: boolean('quota_truncated').notNull().default(false),
    nextPacerAt: timestamp('next_pacer_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('campaign_runs_campaign_run_idx').on(table.campaignId, table.runNumber)],
)

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
    runId: text('run_id').references(() => campaignRuns.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => connections.id),
    variantId: text('variant_id').references(() => campaignVariants.id, { onDelete: 'set null' }),
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
  (table) => [
    index('campaign_messages_run_status_idx').on(table.runId, table.status),
    index('campaign_messages_external_id_idx').on(table.externalMessageId),
    index('campaign_messages_campaign_status_idx').on(table.campaignId, table.status),
  ],
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
