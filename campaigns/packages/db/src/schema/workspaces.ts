import { pgTable, text, timestamp, integer, bigint, unique, jsonb } from 'drizzle-orm/pg-core'
import type { WorkspaceRole, InviteStatus, WorkspaceRolePermissions } from '@naia/schemas'

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ownerUserId: text('owner_user_id').notNull(),
  organizationId: text('organization_id'),
  description: text('description'),
  location: text('location'),
  industry: text('industry'),
  avatarUrl: text('avatar_url'),
  rolePermissions: jsonb('role_permissions').$type<WorkspaceRolePermissions>(),
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

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const entitlements = pgTable('entitlements', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('free'),
  status: text('status').notNull().default('active'),
  seats: integer('seats').notNull().default(1),
  connections: integer('connections').notNull().default(1),
  creditsPerCycle: integer('credits_per_cycle').notNull().default(3),
  creditsBalance: integer('credits_balance').notNull().default(3),
  campaignsPerMonth: integer('campaigns_per_month').notNull().default(1),
  automations: integer('automations').notNull().default(0),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  maxFileSizeBytes: bigint('max_file_size_bytes', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const revokedSessions = pgTable('revoked_sessions', {
  sid: text('sid').primaryKey(),
  revokedAt: timestamp('revoked_at').defaultNow().notNull(),
})

export const directoryUsers = pgTable('directory_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  picture: text('picture'),
  pictureFrame: text('picture_frame'),
  freeWorkspacesCreated: integer('free_workspaces_created').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const productSettings = pgTable('product_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull().default({}),
  description: text('description'),
  updatedByService: text('updated_by_service'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedByService: text('updated_by_service'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Workspace = typeof workspaces.$inferSelect
export type Member = typeof members.$inferSelect
export type Invite = typeof invites.$inferSelect
export type EntitlementRow = typeof entitlements.$inferSelect
export type DirectoryUser = typeof directoryUsers.$inferSelect
export type ProductSetting = typeof productSettings.$inferSelect
export type WorkspaceSetting = typeof workspaceSettings.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
