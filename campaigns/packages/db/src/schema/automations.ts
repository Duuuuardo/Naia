import { pgTable, text, timestamp, boolean, integer, primaryKey } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { connections } from './campaigns'
import type { AutomationType } from '@naia/schemas'

// Triggers automáticos (hoje só aniversário). Quando dispara, a automação
// spawna uma campanha real (campaigns.kind='automation', automationId setado)
// — runs, cota, pacing e histórico vêm de graça do modelo de campanhas.
export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').$type<AutomationType>().notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  sendTime: text('send_time').notNull().default('09:00'), // 'HH:mm' no fuso abaixo
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  // Variantes de mensagem no mesmo shape do builder: [{ body, mediaAssetIds }]
  contentJson: text('content_json').notNull().default('[]'),
  speedJson: text('speed_json').notNull().default('{"preset":"medio"}'),
  // 'YYYY-MM-DD' no fuso da automação — guarda de idempotência do tick diário
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

export type Automation = typeof automations.$inferSelect
export type AutomationConnection = typeof automationConnections.$inferSelect
