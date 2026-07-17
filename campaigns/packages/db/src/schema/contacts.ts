import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  telegramChatId: text('telegram_chat_id'),
  whatsappPhone: text('whatsapp_phone'),
  email: text('email'),
  birthDate: text('birth_date'), // 'YYYY-MM-DD' or 'DD/MM'
  company: text('company'),
  notes: text('notes'),
  tags: text('tags').array().notNull().default([]),
  customFields: text('custom_fields').notNull().default('{}'),
  avatarUrl: text('avatar_url'),
  isGroup: boolean('is_group').notNull().default(false),
  optInStatus: boolean('opt_in_status').notNull().default(true),
  optInAt: timestamp('opt_in_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
