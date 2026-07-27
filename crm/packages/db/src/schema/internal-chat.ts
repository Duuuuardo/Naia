import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { agents } from './agents'
import { queues, teams } from './product'

// Chat interno da equipe: dm entre agentes, grupo ad-hoc, canal de fila ou canal de equipe.
export const internalChats = pgTable('internal_chats', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'dm' | 'group' | 'queue' | 'team'>().notNull(),
  // Nome só faz sentido em grupo; dm e canais de fila/equipe derivam o título.
  name: text('name'),
  queueId: text('queue_id').references(() => queues.id, { onDelete: 'set null' }),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
  createdByAgentId: text('created_by_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const internalChatMembers = pgTable(
  'internal_chat_members',
  {
    chatId: text('chat_id').notNull().references(() => internalChats.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at'),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.agentId] })],
)

export const internalChatMessages = pgTable('internal_chat_messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => internalChats.id, { onDelete: 'cascade' }),
  senderAgentId: text('sender_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type InternalChat = typeof internalChats.$inferSelect
export type InternalChatMember = typeof internalChatMembers.$inferSelect
export type InternalChatMessage = typeof internalChatMessages.$inferSelect
