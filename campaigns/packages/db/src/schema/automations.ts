import { pgTable, text, timestamp, boolean, integer, primaryKey } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { connections } from './campaigns'
import { contacts } from './contacts'
import type { AutomationType, AutomationEnrollmentStatus } from '@naia/schemas'

// Triggers automáticos (aniversário, webhook/carrinho abandonado, tags, etc).
// Quando dispara, pode gerar campanha ou entrar no sequenciador de cadência (automationEnrollments).
export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').$type<AutomationType>().notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  sendTime: text('send_time').notNull().default('09:00'), // 'HH:mm' no fuso abaixo
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  // Variantes de mensagem para passo único / aniversário: [{ body, mediaAssetIds }]
  contentJson: text('content_json').notNull().default('[]'),
  speedJson: text('speed_json').notNull().default('{"preset":"medio"}'),
  // Passos da cadência multi-passo (se preenchido, usa este sequenciador):
  // [{ id, action: 'message' | 'delay' | 'add_tag', content?: [...], delayHours?: 72, tag?: '...' }]
  stepsJson: text('steps_json').notNull().default('[]'),
  // Freio de mão: tags que se o contato receber, cancelam a inscrição ativa
  stopOnTagsJson: text('stop_on_tags_json').notNull().default('[]'),
  // Config do gatilho: webhook → { secret }, tag_added → { tag }
  triggerJson: text('trigger_json').notNull().default('{}'),
  // 'YYYY-MM-DD' no fuso da automação — guarda de idempotência do tick diário (aniversário)
  lastEvaluatedDate: text('last_evaluated_date'),
  // { matched, campaignId?, skipReason? } da última avaliação
  lastResultJson: text('last_result_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const automationConnections = pgTable(
  'automation_connections',
  {
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.automationId, table.connectionId] })],
)

// Inscrições ativas na cadência multi-passos (a Persistência / Régua)
export const automationEnrollments = pgTable('automation_enrollments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  currentStepIndex: integer('current_step_index').notNull().default(0),
  nextStepAt: timestamp('next_step_at').notNull(),
  status: text('status').$type<AutomationEnrollmentStatus>().notNull().default('active'),
  // Variantes e dados do evento que engatou a automação (ex: cart_url do webhook)
  contextJson: text('context_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Automation = typeof automations.$inferSelect
export type AutomationConnection = typeof automationConnections.$inferSelect
export type AutomationEnrollment = typeof automationEnrollments.$inferSelect

