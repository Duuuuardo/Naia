import { pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

// Agentes do inbox CRM. Auth própria, sem dependência Vianova.
// Email é único por workspace (login no inbox é email + senha + slug do workspace).
export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    // superadmin: admin total do inbox (conexões, filas, permissões); admin/agent
    // seguem a matriz de permissões do workspace.
    role: text('role').$type<'superadmin' | 'admin' | 'agent'>().notNull().default('agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    activatedAt: timestamp('activated_at'),
    lastLoginAt: timestamp('last_login_at'),
  },
  (table) => [unique().on(table.workspaceId, table.email)],
)

// Tokens de ativação: enviados por email para novo agente definir senha.
export const agentInviteTokens = pgTable('agent_invite_tokens', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
})

// Sessões de agente no inbox: JWT + sid.
export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  sid: text('sid').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
})

export type Agent = typeof agents.$inferSelect
export type AgentInviteToken = typeof agentInviteTokens.$inferSelect
export type AgentSession = typeof agentSessions.$inferSelect
