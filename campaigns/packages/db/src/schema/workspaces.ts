import { pgTable, text, timestamp, integer, bigint, unique, jsonb } from 'drizzle-orm/pg-core'
import type { WorkspaceRole, InviteStatus, WorkspaceRolePermissions } from '@naia/schemas'

// Tenant do Naia. userId de owner/membros são ids de usuário do Vianova —
// Naia não guarda perfil de usuário, só referencia o id emitido no JWT (sub).
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ownerUserId: text('owner_user_id').notNull(),
  // Vínculo fraco e opcional com a Organização do Vianova — só exibição.
  organizationId: text('organization_id'),
  description: text('description'),
  location: text('location'),
  industry: text('industry'),
  // Avatar do workspace: data URL pequena (redimensionada no cliente) — dado
  // de produto, vive aqui mesmo; nada a ver com o avatar de usuário (Vianova).
  avatarUrl: text('avatar_url'),
  // Matriz de permissões por papel (admin/member). Null = defaults de
  // @naia/schemas; Owner sempre tem acesso total.
  rolePermissions: jsonb('role_permissions').$type<WorkspaceRolePermissions>(),
  // Preferências de notificação por email do workspace. Somente o dono recebe.
  notificationPreferences: jsonb('notification_preferences')
    .$type<{
      emailOnCampaignCompleted?: boolean
      emailOnCampaignFailed?: boolean
      emailOnCreditsExhausted?: boolean
      emailOnConnectionDisconnected?: boolean
    }>()
    .notNull()
    .default({
      emailOnCampaignCompleted: true,
      emailOnCampaignFailed: true,
      emailOnCreditsExhausted: true,
      emailOnConnectionDisconnected: true,
    }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').$type<WorkspaceRole>().notNull().default('member'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.userId)],
)

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<WorkspaceRole>().notNull().default('member'),
  invitedByUserId: text('invited_by_user_id').notNull(),
  token: text('token').notNull().unique(),
  status: text('status').$type<InviteStatus>().notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Entitlement local — única forma de escrita é POST /internal/entitlements
// (token de serviço do Vianova). Nunca calculado por lógica de billing própria.
export const entitlements = pgTable('entitlements', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('free'),
  status: text('status').notNull().default('active'),
  seats: integer('seats').notNull().default(1),
  connections: integer('connections').notNull().default(1),
  // Créditos concedidos por ciclo de cobrança (propriedade estática do plano)
  creditsPerCycle: integer('credits_per_cycle').notNull().default(3),
  // Saldo spendable atual — decrementado por disparo, incrementado por renovação/compra
  creditsBalance: integer('credits_balance').notNull().default(3),
  campaignsPerMonth: integer('campaigns_per_month').notNull().default(1),
  // Limite de automações ativas (-1 = ilimitado, como Scale). Escrito só via sync do Vianova.
  automations: integer('automations').notNull().default(0),
  // Quota de storage e tamanho máximo por arquivo sincronizados pelo Vianova.
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  maxFileSizeBytes: bigint('max_file_size_bytes', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Base do single sign-out local: Naia guarda o JWT do Vianova (claim `sid`)
// como o próprio cookie de sessão, sem round-trip por request. Quando o
// Vianova avisa POST /internal/session-revoked, o sid cai aqui — a validação
// local do token passa a checar essa tabela além da assinatura/expiração.
export const revokedSessions = pgTable('revoked_sessions', {
  sid: text('sid').primaryKey(),
  revokedAt: timestamp('revoked_at').defaultNow().notNull(),
})

// Cache de exibição (nome/email) dos usuários do Vianova que já autenticaram
// aqui — Naia não tem cadastro próprio, só espelha o que vem no JWT a cada
// login para poder listar membros sem chamar o Vianova a cada request.
export const directoryUsers = pgTable('directory_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  picture: text('picture'),
  pictureFrame: text('picture_frame'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Workspace = typeof workspaces.$inferSelect
export type Member = typeof members.$inferSelect
export type Invite = typeof invites.$inferSelect
export type EntitlementRow = typeof entitlements.$inferSelect
export type DirectoryUser = typeof directoryUsers.$inferSelect
