import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { agents } from './agents'
import { contacts, conversations, queues } from './product'

// Funis de vendas do workspace e seus estágios (kanban).
export const pipelines = pgTable('pipelines', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// kind: estágio final de ganho/perda (fecha o deal ao entrar) ou aberto.
export const pipelineStages = pgTable('pipeline_stages', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  position: integer('position').notNull(),
  kind: text('kind').$type<'open' | 'won' | 'lost'>().notNull().default('open'),
})

// Deals: oportunidades vinculadas a um contato (e opcionalmente à conversa).
export const deals = pgTable('deals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  stageId: text('stage_id').notNull().references(() => pipelineStages.id),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  valueCents: integer('value_cents').notNull().default(0),
  currency: text('currency').notNull().default('BRL'),
  assignedAgentId: text('assigned_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  queueId: text('queue_id').references(() => queues.id, { onDelete: 'set null' }),
  status: text('status').$type<'open' | 'won' | 'lost'>().notNull().default('open'),
  lostReason: text('lost_reason'),
  position: integer('position').notNull().default(0),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Pipeline = typeof pipelines.$inferSelect
export type NewPipeline = typeof pipelines.$inferInsert
export type PipelineStage = typeof pipelineStages.$inferSelect
export type NewPipelineStage = typeof pipelineStages.$inferInsert
export type Deal = typeof deals.$inferSelect
export type NewDeal = typeof deals.$inferInsert
