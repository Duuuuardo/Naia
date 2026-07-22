import { defaultSpeedPreset, getSpeedPolicy } from '@naia/entitlements'
import type {
  CampaignScheduleInput,
  CampaignSpeedInput,
  CampaignVariantInput,
} from '../../lib/actions'

export type WizardConnection = {
  id: string
  name: string
  channel: string
  status: string
}

export type WizardMedia = {
  assetId: string
  filename: string
  kind: string
  mimeType: string
  previewUrl: string | null
}

export type WizardVariant = {
  key: string
  body: string
  media: WizardMedia[]
}

export type AudienceMode = 'all' | 'tags' | 'groups' | 'manual' | 'file'
export type RecurrenceKind = 'daily' | 'weekly' | 'every_x_hours' | 'times_per_day'

export type WizardDraft = {
  name: string
  connectionIds: string[]

  audienceMode: AudienceMode
  tags: string[]
  groupIds: string[]
  groupTargetMode: 'group' | 'members'
  groupTagOnCreate: string
  manualRows: { name: string; phone: string }[]
  /** Tag já resolvida de um público manual/arquivo salvo antes (modo edição). */
  resolvedAudienceTag: string | null
  applyTag: string

  variants: WizardVariant[]

  scheduleType: 'immediate' | 'once' | 'recurring'
  onceAt: string
  recKind: RecurrenceKind
  recTime: string
  recWeekdays: number[]
  recEveryHours: number
  recTimesPerDay: number
  recStartDate: string
  recEndDate: string
  recMaxOccurrences: string
  workingHoursEnabled: boolean
  whStart: string
  whEnd: string
  whWeekdays: number[]
  dailyCapEnabled: boolean
  dailyCap: string
  timezoneEnabled: boolean
  timezone: string

  speed: CampaignSpeedInput

  consent: boolean
}

export const DEFAULT_TZ = 'America/Sao_Paulo'

let variantSeq = 0
export function newVariantKey(): string {
  variantSeq += 1
  return `v${Date.now()}-${variantSeq}`
}

export function emptyDraft(tier: string): WizardDraft {
  return {
    name: '',
    connectionIds: [],
    audienceMode: 'all',
    tags: [],
    groupIds: [],
    groupTargetMode: 'members',
    groupTagOnCreate: 'campanha-grupo',
    manualRows: [{ name: '', phone: '' }],
    resolvedAudienceTag: null,
    applyTag: '',
    variants: [{ key: newVariantKey(), body: '', media: [] }],
    scheduleType: 'immediate',
    onceAt: '',
    recKind: 'daily',
    recTime: '09:00',
    recWeekdays: [1, 2, 3, 4, 5],
    recEveryHours: 6,
    recTimesPerDay: 2,
    recStartDate: '',
    recEndDate: '',
    recMaxOccurrences: '',
    workingHoursEnabled: false,
    whStart: '08:00',
    whEnd: '18:00',
    whWeekdays: [1, 2, 3, 4, 5],
    dailyCapEnabled: false,
    dailyCap: '',
    timezoneEnabled: false,
    timezone: DEFAULT_TZ,
    speed: { preset: defaultSpeedPreset(tier) },
    consent: false,
  }
}

export function draftToSchedule(d: WizardDraft): CampaignScheduleInput {
  const schedule: CampaignScheduleInput = { type: d.scheduleType }
  if (d.scheduleType === 'once' && d.onceAt) {
    schedule.onceAt = new Date(d.onceAt).toISOString()
  }
  if (d.scheduleType === 'recurring') {
    schedule.recurrence = {
      kind: d.recKind,
      ...(d.recKind === 'daily' || d.recKind === 'weekly' ? { time: d.recTime } : {}),
      ...(d.recKind === 'weekly' ? { weekdays: d.recWeekdays } : {}),
      ...(d.recKind === 'every_x_hours' ? { everyHours: d.recEveryHours } : {}),
      ...(d.recKind === 'times_per_day' ? { timesPerDay: d.recTimesPerDay } : {}),
      ...(d.recStartDate ? { startDate: d.recStartDate } : {}),
      ...(d.recEndDate ? { endDate: d.recEndDate } : {}),
      ...(d.recMaxOccurrences && Number(d.recMaxOccurrences) > 0
        ? { maxOccurrences: Number(d.recMaxOccurrences) }
        : {}),
    }
  }
  if (d.workingHoursEnabled) {
    schedule.workingHours = { start: d.whStart, end: d.whEnd, weekdays: d.whWeekdays }
  }
  if (d.dailyCapEnabled && Number(d.dailyCap) > 0) {
    schedule.dailyCap = Number(d.dailyCap)
  }
  return schedule
}

export function draftToVariants(d: WizardDraft): CampaignVariantInput[] {
  return d.variants
    .filter((v) => v.body.trim().length > 0 || v.media.length > 0)
    .map((v) => ({
      body: v.body,
      mediaAssetIds: v.media.map((m) => m.assetId),
    }))
}

/** Reconstrói o draft a partir de uma campanha existente (modo edição). */
export function draftFromCampaign(input: {
  campaign: {
    name: string
    segmentFilter: string | null
    scheduleJson: string | null
    speedJson: string | null
    timezone: string | null
    applyTagOnDispatch: string | null
  }
  connections: WizardConnection[]
  variants: Array<{
    id: string
    body: string
    media: Array<{ id: string; filename: string; kind: string; mimeType: string }>
  }>
  tier: string
}): WizardDraft {
  const d = emptyDraft(input.tier)
  const { campaign } = input
  d.name = campaign.name
  d.connectionIds = input.connections.map((c) => c.id)
  d.applyTag = campaign.applyTagOnDispatch ?? ''
  d.timezone = campaign.timezone ?? DEFAULT_TZ
  d.timezoneEnabled = d.timezone !== DEFAULT_TZ

  try {
    const filter = JSON.parse(campaign.segmentFilter ?? '{"type":"all"}')
    if (filter.type === 'tags' && Array.isArray(filter.tags)) {
      d.audienceMode = 'tags'
      d.tags = filter.tags
    } else if (filter.type === 'groups') {
      d.audienceMode = 'groups'
      d.groupIds = filter.groupIds ?? []
      d.groupTargetMode = filter.targetMode === 'group' ? 'group' : 'members'
      d.groupTagOnCreate = Array.isArray(filter.tagOnCreate) ? filter.tagOnCreate.join(', ') : ''
    }
  } catch {
    // filtro ilegível → mantém 'all'
  }

  try {
    const s = JSON.parse(campaign.scheduleJson ?? '{"type":"immediate"}')
    d.scheduleType = s.type === 'once' || s.type === 'recurring' ? s.type : 'immediate'
    if (s.onceAt) d.onceAt = toLocalDatetimeInput(s.onceAt)
    if (s.recurrence) {
      d.recKind = s.recurrence.kind ?? 'daily'
      d.recTime = s.recurrence.time ?? d.recTime
      d.recWeekdays = s.recurrence.weekdays ?? d.recWeekdays
      d.recEveryHours = s.recurrence.everyHours ?? d.recEveryHours
      d.recTimesPerDay = s.recurrence.timesPerDay ?? d.recTimesPerDay
      d.recStartDate = s.recurrence.startDate ?? ''
      d.recEndDate = s.recurrence.endDate ?? ''
      d.recMaxOccurrences = s.recurrence.maxOccurrences ? String(s.recurrence.maxOccurrences) : ''
    }
    if (s.workingHours) {
      d.workingHoursEnabled = true
      d.whStart = s.workingHours.start ?? d.whStart
      d.whEnd = s.workingHours.end ?? d.whEnd
      d.whWeekdays = s.workingHours.weekdays ?? d.whWeekdays
    }
    if (s.dailyCap) {
      d.dailyCapEnabled = true
      d.dailyCap = String(s.dailyCap)
    }
  } catch {
    // agendamento ilegível → mantém imediato
  }

  try {
    const speed = JSON.parse(campaign.speedJson ?? 'null')
    if (speed?.preset) d.speed = speed
  } catch {
    // velocidade ilegível → mantém preset padrão
  }

  // Plano pode ter mudado desde o salvamento — velocidade fora do plano volta
  // ao padrão permitido em vez de estourar 403 na hora de salvar.
  const policy = getSpeedPolicy(input.tier)
  if (!policy.allowedPresets.includes(d.speed.preset)) {
    d.speed = { preset: defaultSpeedPreset(input.tier) }
  }
  if (d.speed.pauseEveryN && !policy.burstPauseAllowed) {
    d.speed = { ...d.speed, pauseEveryN: undefined, pauseMinMinutes: undefined, pauseMaxMinutes: undefined }
  }

  if (input.variants.length > 0) {
    d.variants = input.variants.map((v) => ({
      key: newVariantKey(),
      body: v.body,
      media: v.media.map((m) => ({
        assetId: m.id,
        filename: m.filename,
        kind: m.kind,
        mimeType: m.mimeType,
        previewUrl: null,
      })),
    }))
  }

  return d
}

function toLocalDatetimeInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (America/Sao_Paulo)' },
  { value: 'America/Manaus', label: 'Manaus (America/Manaus)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (America/Cuiaba)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (America/Fortaleza)' },
  { value: 'America/Recife', label: 'Recife (America/Recife)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (America/Rio_Branco)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (America/Noronha)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { value: 'Europe/Lisbon', label: 'Lisboa (Europe/Lisbon)' },
  { value: 'America/New_York', label: 'Nova York (America/New_York)' },
  { value: 'UTC', label: 'UTC' },
]
