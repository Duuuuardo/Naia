import { pgTable, text, timestamp, boolean, integer, primaryKey } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { connections } from './campaigns'
import { contacts } from './contacts'
import type { AutomationType, AutomationEnrollmentStatus } from '@naia/schemas'

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').$type<AutomationType>().notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  sendTime: text('send_time').notNull().default('09:00'), // 'HH:mm' no fuso abaixo
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  contentJson: text('content_json').notNull().default('[]'),
  speedJson: text('speed_json').notNull().default('{"preset":"medio"}'),
  stepsJson: text('steps_json').notNull().default('[]'),
  stopOnTagsJson: text('stop_on_tags_json').notNull().default('[]'),
  triggerJson: text('trigger_json').notNull().default('{}'),
  lastEvaluatedDate: text('last_evaluated_date'),
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

export const automationEnrollments = pgTable('automation_enrollments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  currentStepIndex: integer('current_step_index').notNull().default(0),
  nextStepAt: timestamp('next_step_at').notNull(),
  status: text('status').$type<AutomationEnrollmentStatus>().notNull().default('active'),
  contextJson: text('context_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Automation = typeof automations.$inferSelect
export type AutomationConnection = typeof automationConnections.$inferSelect
export type AutomationEnrollment = typeof automationEnrollments.$inferSelect

