import { pgTable, text, timestamp, integer, boolean, unique, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core'
import type { WorkspaceRolePermissions } from '@crm/schemas'
import { botFlows } from './product'

// Faixa de horário de atendimento por dia da semana (0 = domingo … 6 = sábado).
export type BusinessHoursEntry = { day: number; start: string; end: string }

// Tenant do Naia CRM. Management panel é Vianova-scoped; inbox usa auth próprio.
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  location: text('location'),
  industry: text('industry'),
  // Avatar do workspace é dado do produto. Avatar de usuário continua vindo
  // exclusivamente do Vianova pelo claim `picture`.
  avatarUrl: text('avatar_url'),
  // Matriz de permissões por papel (admin). Null = defaults de @crm/schemas;
  // Owner sempre tem acesso total.
  rolePermissions: jsonb('role_permissions').$type<WorkspaceRolePermissions>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Managers do workspace (owners/admins via Vianova). Separado de agents (inbox).
export const workspaceManagers = pgTable(
  'workspace_managers',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    vianovaUserId: text('vianova_user_id').notNull(),
    role: text('role').$type<'owner' | 'admin'>().notNull().default('admin'),
    // Cache Vianova
    name: text('name').notNull(),
    email: text('email').notNull(),
    pictureUrl: text('picture_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.vianovaUserId)],
)

// Invites de co-admin para o management panel. Convidado precisa de conta Vianova.
export const managerInvites = pgTable('manager_invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<'owner' | 'admin'>().notNull().default('admin'),
  invitedByUserId: text('invited_by_user_id').notNull(),
  token: text('token').notNull().unique(),
  status: text('status').$type<'pending' | 'accepted' | 'expired'>().notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Entitlement local — escrito via POST /internal/entitlements (Vianova service).
export const entitlements = pgTable('entitlements', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  agentsLimit: integer('agents_limit').notNull().default(2),
  managersLimit: integer('managers_limit').notNull().default(2),
  connectionsLimit: integer('connections_limit').notNull().default(1),
  activeConversationsLimit: integer('active_conversations_limit').notNull().default(200),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Single sign-out: Vianova avisa via POST /internal/session-revoked.
export const revokedSessions = pgTable('revoked_sessions', {
  sid: text('sid').primaryKey(),
  revokedAt: timestamp('revoked_at').defaultNow().notNull(),
})

// Configurações globais do produto (editáveis via Vianova admin panel).
export const productSettings = pgTable('product_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull().default({}),
  description: text('description'),
  updatedByService: text('updated_by_service'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Configurações por workspace (custom domain, logo, cor, etc).
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  customDomain: text('custom_domain').unique(),
  customLogoUrl: text('custom_logo_url'),
  primaryColor: text('primary_color'),
  domainVerifiedAt: timestamp('domain_verified_at'),
  // Horários de atendimento. Null = sem restrição (24h).
  businessHours: jsonb('business_hours').$type<BusinessHoursEntry[]>(),
  // Comportamento fora de horário: none | auto_reply | bot | both.
  outOfHoursMode: text('out_of_hours_mode').$type<'none' | 'auto_reply' | 'bot' | 'both'>().notNull().default('none'),
  outOfHoursMessage: text('out_of_hours_message'),
  outOfHoursBotFlowId: text('out_of_hours_bot_flow_id').references((): AnyPgColumn => botFlows.id, {
    onDelete: 'set null',
  }),
  // Pesquisa de satisfação (CSAT): enviada ao contato quando a conversa é
  // resolvida; a próxima resposta numérica (1-5) vira a avaliação.
  csatEnabled: boolean('csat_enabled').notNull().default(false),
  // Null = usa os textos padrão (CSAT_DEFAULT_MESSAGE / CSAT_DEFAULT_THANK_YOU_MESSAGE).
  csatMessage: text('csat_message'),
  csatThankYouMessage: text('csat_thank_you_message'),
  // Identifica o atendente ao contato: quando ligado, o outbound manual leva o
  // primeiro nome do agente em negrito antes da mensagem (*João*:\n…). Só afeta
  // o texto enviado ao canal; o registro no banco continua limpo (o inbox já
  // mostra o autor via agentName).
  identifyAgent: boolean('identify_agent').notNull().default(false),
  // Próximo número de protocolo de conversa do workspace (incremento atômico
  // na mesma transação que cria a conversa, no worker).
  nextProtocol: integer('next_protocol').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Workspace = typeof workspaces.$inferSelect
export type WorkspaceManager = typeof workspaceManagers.$inferSelect
export type ManagerInvite = typeof managerInvites.$inferSelect
export type EntitlementRow = typeof entitlements.$inferSelect
export type ProductSetting = typeof productSettings.$inferSelect
export type WorkspaceSetting = typeof workspaceSettings.$inferSelect

// Textos padrão da pesquisa CSAT (usados quando as colunas do workspace são null).
export const CSAT_DEFAULT_MESSAGE = 'Seu atendimento foi finalizado. De 1 a 5, como você avalia o atendimento?'
export const CSAT_DEFAULT_THANK_YOU_MESSAGE = 'Obrigado pela sua avaliação!'
