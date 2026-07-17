import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const contactTags = pgTable('contact_tags', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#3b82f6'),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uqWorkspaceTagName: uniqueIndex('uq_workspace_tag_name').on(table.workspaceId, table.name),
}))

export type ContactTag = typeof contactTags.$inferSelect
export type NewContactTag = typeof contactTags.$inferInsert
