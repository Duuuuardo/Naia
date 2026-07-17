import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { contacts } from './contacts'

export const contactIdentities = pgTable('contact_identities', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  channelType: text('channel_type').notNull(), // 'whatsapp' | 'telegram' | 'discord' | 'email' | 'custom'
  channelIdentifier: text('channel_identifier').notNull(), // '+5511999999999', '123456789', etc.
  isPrimary: boolean('is_primary').notNull().default(false),
  metadata: text('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uqWorkspaceChannelId: uniqueIndex('uq_workspace_channel_identifier')
    .on(table.workspaceId, table.channelType, table.channelIdentifier),
  idxContactId: index('idx_contact_identities_contact_id').on(table.contactId),
}))

export type ContactIdentity = typeof contactIdentities.$inferSelect
export type NewContactIdentity = typeof contactIdentities.$inferInsert
