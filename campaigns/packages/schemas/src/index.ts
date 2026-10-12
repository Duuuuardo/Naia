import { Type, type Static } from '@sinclair/typebox'

export const WorkspaceRole = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
])
export type WorkspaceRole = Static<typeof WorkspaceRole>

export const PERMISSION_KEYS = [
  'contacts',
  'connections',
  'campaigns',
  'members',
  'billing',
  'settings',
  'files',
] as const
export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export type RolePermissionMap = Record<PermissionKey, boolean>
export type WorkspaceRolePermissions = {
  admin: RolePermissionMap
  member: RolePermissionMap
}

export const OWNER_PERMISSIONS: RolePermissionMap = {
  contacts: true,
  connections: true,
  campaigns: true,
  members: true,
  billing: true,
  settings: true,
  files: true,
}

export const DEFAULT_ROLE_PERMISSIONS: WorkspaceRolePermissions = {
  admin: {
    contacts: true,
    connections: true,
    campaigns: true,
    members: true,
    billing: true,
    settings: true,
    files: true,
  },
  member: {
    contacts: true,
    connections: false,
    campaigns: true,
    members: false,
    billing: false,
    settings: false,
    files: false,
  },
}

export function effectivePermissions(
  role: 'owner' | 'admin' | 'member',
  overrides: WorkspaceRolePermissions | null | undefined,
): RolePermissionMap {
  if (role === 'owner') return OWNER_PERMISSIONS
  const base = DEFAULT_ROLE_PERMISSIONS[role]
  const custom = overrides?.[role]
  return custom ? { ...base, ...custom } : base
}

export const InviteStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accepted'),
  Type.Literal('expired'),
  Type.Literal('cancelled'),
])
export type InviteStatus = Static<typeof InviteStatus>

export const ChannelType = Type.Union([
  Type.Literal('telegram'),
  Type.Literal('whatsapp'),
  Type.Literal('discord'),
  Type.Literal('email'),
  Type.Literal('custom'),
])
export type ChannelType = Static<typeof ChannelType>

export const ConnectionStatus = Type.Union([
  Type.Literal('active'),
  Type.Literal('error'),
  Type.Literal('disconnected'),
])
export type ConnectionStatus = Static<typeof ConnectionStatus>

export const MessageStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('sending'),
  Type.Literal('sent'),
  Type.Literal('delivered'),
  Type.Literal('read'),
  Type.Literal('failed'),
])
export type MessageStatus = Static<typeof MessageStatus>

export const CampaignStatus = Type.Union([
  Type.Literal('draft'),
  Type.Literal('scheduled'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
])
export type CampaignStatus = Static<typeof CampaignStatus>

export const CampaignRunStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('skipped_quota'),
])
export type CampaignRunStatus = Static<typeof CampaignRunStatus>

export const CampaignKind = Type.Union([Type.Literal('manual'), Type.Literal('automation')])
export type CampaignKind = Static<typeof CampaignKind>

export const AutomationType = Type.Union([
  Type.Literal('birthday'),
  Type.Literal('webhook'),
  Type.Literal('tag_added'),
  Type.Literal('contact_created'),
])
export type AutomationType = Static<typeof AutomationType>

export const AutomationStepAction = Type.Union([
  Type.Literal('message'),
  Type.Literal('delay'),
  Type.Literal('add_tag'),
])
export type AutomationStepAction = Static<typeof AutomationStepAction>

export const AutomationStepSchema = Type.Object({
  id: Type.String(),
  action: AutomationStepAction,
  content: Type.Optional(
    Type.Array(
      Type.Object({
        body: Type.String({ minLength: 1 }),
        mediaAssetIds: Type.Optional(Type.Array(Type.String())),
      }),
    ),
  ),
  delayHours: Type.Optional(Type.Integer({ minimum: 1 })),
  tag: Type.Optional(Type.String({ minLength: 1 })),
})
export type AutomationStep = Static<typeof AutomationStepSchema>

export const AutomationEnrollmentStatus = Type.Union([
  Type.Literal('active'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
])
export type AutomationEnrollmentStatus = Static<typeof AutomationEnrollmentStatus>

export const AutomationTriggerConfigSchema = Type.Object({
  secret: Type.Optional(Type.String()),
  tag: Type.Optional(Type.String()),
})
export type AutomationTriggerConfig = Static<typeof AutomationTriggerConfigSchema>

export const RecurrenceSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('daily'), // todo dia às `time`
    Type.Literal('weekly'), // nos `weekdays` às `time`
    Type.Literal('every_x_hours'), // de `everyHours` em `everyHours` horas
    Type.Literal('times_per_day'), // `timesPerDay` execuções distribuídas na janela
  ]),
  time: Type.Optional(Type.String()),
  weekdays: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }))),
  everyHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  timesPerDay: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 })),
  startDate: Type.Optional(Type.String()),
  endDate: Type.Optional(Type.String()),
  maxOccurrences: Type.Optional(Type.Integer({ minimum: 1 })),
})
export type Recurrence = Static<typeof RecurrenceSchema>

export const WorkingHoursSchema = Type.Object({
  start: Type.String(),
  end: Type.String(),
  weekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 })),
})
export type WorkingHours = Static<typeof WorkingHoursSchema>

export const ScheduleSchema = Type.Object({
  type: Type.Union([Type.Literal('immediate'), Type.Literal('once'), Type.Literal('recurring')]),
  onceAt: Type.Optional(Type.String()),
  recurrence: Type.Optional(RecurrenceSchema),
  workingHours: Type.Optional(WorkingHoursSchema),
  dailyCap: Type.Optional(Type.Integer({ minimum: 1 })),
})
export type Schedule = Static<typeof ScheduleSchema>

export const SpeedPreset = Type.Union([
  Type.Literal('lento'),
  Type.Literal('medio'),
  Type.Literal('rapido'),
  Type.Literal('manual'),
])
export type SpeedPreset = Static<typeof SpeedPreset>

export const SpeedSchema = Type.Object({
  preset: SpeedPreset,
  minSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
  maxSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
  pauseEveryN: Type.Optional(Type.Integer({ minimum: 1 })),
  pauseMinMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
  pauseMaxMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
})
export type Speed = Static<typeof SpeedSchema>

export type SpeedChannel = 'whatsapp' | 'telegram'

export const SPEED_PRESET_RANGES: Record<
  Exclude<SpeedPreset, 'manual'>,
  Record<SpeedChannel, { min: number; max: number }>
> = {
  lento: { whatsapp: { min: 60, max: 180 }, telegram: { min: 10, max: 30 } },
  medio: { whatsapp: { min: 30, max: 60 }, telegram: { min: 3, max: 10 } },
  rapido: { whatsapp: { min: 20, max: 40 }, telegram: { min: 1, max: 3 } },
}

export const MediaKind = Type.Union([
  Type.Literal('image'),
  Type.Literal('video'),
  Type.Literal('audio'),
  Type.Literal('document'),
])
export type MediaKind = Static<typeof MediaKind>

export const MediaRefSchema = Type.Object({
  storageKey: Type.String(),
  mimeType: Type.String(),
  kind: MediaKind,
  filename: Type.String(),
})
export type MediaRef = Static<typeof MediaRefSchema>

export const EntitlementsSchema = Type.Object({
  tier: Type.String(),
  status: Type.String(),
  seats: Type.Number(),
  connections: Type.Number(),
  creditsPerCycle: Type.Number(),
  creditsBalance: Type.Number(),
  campaignsPerMonth: Type.Number(),
  automations: Type.Number(),
  storageBytes: Type.Number(),
  maxFileSizeBytes: Type.Number(),
})
export type Entitlements = Static<typeof EntitlementsSchema>

export const EntitlementsSyncBodySchema = Type.Object({
  workspace_id: Type.String(),
  product_slug: Type.String(),
  tier: Type.String(),
  status: Type.String(),
  limits: Type.Record(Type.String(), Type.Number()),
})
export type EntitlementsSyncBody = Static<typeof EntitlementsSyncBodySchema>

export const SessionRevokedBodySchema = Type.Object({
  user_id: Type.String(),
  session_ids: Type.Array(Type.String()),
})
export type SessionRevokedBody = Static<typeof SessionRevokedBodySchema>

export const SendMessageJobSchema = Type.Object({
  campaignId: Type.String(),
  campaignMessageId: Type.String(),
  contactId: Type.String(),
  channel: ChannelType,
  connectionId: Type.String(),
  content: Type.String(),
  kind: Type.Optional(Type.Union([Type.Literal('campaign'), Type.Literal('followup')])),
  runId: Type.Optional(Type.String()),
  variantId: Type.Optional(Type.String()),
  media: Type.Optional(Type.Array(MediaRefSchema)),
})
export type SendMessageJob = Static<typeof SendMessageJobSchema>

export const PacerJobSchema = Type.Object({
  noConnSince: Type.Optional(Type.Number()),
  runId: Type.String(),
  campaignId: Type.String(),
  sentInBurst: Type.Integer({ minimum: 0 }),
})
export type PacerJob = Static<typeof PacerJobSchema>

export const StatusWebhookJobSchema = Type.Object({
  source: ChannelType,
  connectionId: Type.String(),
  externalMessageId: Type.String(),
  status: MessageStatus,
  reason: Type.Optional(Type.String()),
  timestamp: Type.String(),
})
export type StatusWebhookJob = Static<typeof StatusWebhookJobSchema>

export const ContactIdentitySchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  contactId: Type.String(),
  channelType: ChannelType,
  channelIdentifier: Type.String(),
  isPrimary: Type.Boolean(),
  metadata: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
export type ContactIdentityDTO = Static<typeof ContactIdentitySchema>

export const MergeContactsBodySchema = Type.Object({
  targetContactId: Type.String(),
  sourceContactIds: Type.Array(Type.String()),
})
export type MergeContactsBody = Static<typeof MergeContactsBodySchema>

export const CreateContactIdentityBodySchema = Type.Object({
  channelType: ChannelType,
  channelIdentifier: Type.String({ minLength: 1 }),
  isPrimary: Type.Optional(Type.Boolean()),
})
export type CreateContactIdentityBody = Static<typeof CreateContactIdentityBodySchema>

export * from './error-sanitizer'

