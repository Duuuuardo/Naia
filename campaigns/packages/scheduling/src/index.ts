// Funções puras de agendamento, pacing e templating — zero I/O, cobertas por
// `bun test`. Toda aritmética de calendário é wall-clock no fuso da campanha
// via TZDate (DST-correta); os instantes retornados são Date UTC prontos para
// persistir em `campaigns.next_run_at`.

import { TZDate } from '@date-fns/tz'
import type { Schedule, Speed, SpeedChannel, WorkingHours } from '@naia/schemas'
import { SPEED_PRESET_RANGES } from '@naia/schemas'

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'
const DEFAULT_TIME = '09:00'
// Janela usada por times_per_day quando a campanha não define workingHours
const FALLBACK_WINDOW = { start: '08:00', end: '20:00' }
const MAX_LOOKAHEAD_DAYS = 400

function parseHM(hm: string): { h: number; m: number } {
  const [h = 0, m = 0] = hm.split(':').map((n) => Number.parseInt(n, 10))
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 }
}

function tzView(instant: Date, tz: string): TZDate {
  return new TZDate(instant.getTime(), tz)
}

/** Dia (wall-clock em tz) deslocado `offsetDays` a partir de `instant`, no horário h:m. */
function dayAt(instant: Date, tz: string, offsetDays: number, h: number, m: number): TZDate {
  const view = tzView(instant, tz)
  return new TZDate(view.getFullYear(), view.getMonth(), view.getDate() + offsetDays, h, m, 0, 0, tz)
}

/** TZDate serializa com offset; persistência e testes esperam Date UTC puro. */
function toUtc(d: Date): Date {
  return new Date(d.getTime())
}

function dayKey(d: TZDate): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function withinDateBounds(key: string, startDate?: string, endDate?: string): boolean {
  if (startDate && key < startDate) return false
  if (endDate && key > endDate) return false
  return true
}

function pastEndDate(key: string, endDate?: string): boolean {
  return Boolean(endDate && key > endDate)
}

// ─── Próxima execução ────────────────────────────────────────────────────────

/**
 * Próximo instante de execução estritamente depois de `from`, ou null quando a
 * campanha não tem mais execuções (immediate, once já executado, recorrência
 * esgotada por endDate/maxOccurrences).
 */
export function computeNextRunAt(
  schedule: Schedule,
  from: Date,
  tz: string,
  occurrenceCount: number,
): Date | null {
  if (schedule.type === 'immediate') return null

  if (schedule.type === 'once') {
    if (occurrenceCount >= 1 || !schedule.onceAt) return null
    const at = new Date(schedule.onceAt)
    // Agendamento no passado dispara no próximo tick
    return at > from ? at : from
  }

  const rec = schedule.recurrence
  if (!rec) return null
  if (rec.maxOccurrences && occurrenceCount >= rec.maxOccurrences) return null

  if (rec.kind === 'every_x_hours') {
    const hours = rec.everyHours ?? 1
    let candidate = new Date(from.getTime() + hours * 3_600_000)
    if (rec.startDate) {
      const startOfWindow = new TZDate(`${rec.startDate}T00:00:00`, tz)
      if (candidate < startOfWindow) candidate = toUtc(startOfWindow)
    }
    return pastEndDate(dayKey(tzView(candidate, tz)), rec.endDate) ? null : candidate
  }

  if (rec.kind === 'times_per_day') {
    const n = rec.timesPerDay ?? 1
    const window = schedule.workingHours ?? FALLBACK_WINDOW
    const { h: sh, m: sm } = parseHM(window.start)
    const { h: eh, m: em } = parseHM(window.end)
    const startMin = sh * 60 + sm
    const windowMin = Math.max(eh * 60 + em - startMin, 0)
    const step = n > 0 ? windowMin / n : windowMin
    const weekdays = schedule.workingHours?.weekdays

    for (let d = 0; d < MAX_LOOKAHEAD_DAYS; d++) {
      const day = dayAt(from, tz, d, 0, 0)
      const key = dayKey(day)
      if (pastEndDate(key, rec.endDate)) return null
      if (!withinDateBounds(key, rec.startDate, rec.endDate)) continue
      if (weekdays && weekdays.length > 0 && !weekdays.includes(day.getDay())) continue
      for (let k = 0; k < n; k++) {
        const total = startMin + Math.floor(k * step)
        const candidate = dayAt(from, tz, d, Math.floor(total / 60), total % 60)
        if (candidate > from) return toUtc(candidate)
      }
    }
    return null
  }

  // daily / weekly
  const { h, m } = parseHM(rec.time ?? DEFAULT_TIME)
  const weekdays = rec.kind === 'weekly' ? (rec.weekdays ?? []) : null
  if (weekdays && weekdays.length === 0) return null

  for (let d = 0; d < MAX_LOOKAHEAD_DAYS; d++) {
    const candidate = dayAt(from, tz, d, h, m)
    const key = dayKey(candidate)
    if (pastEndDate(key, rec.endDate)) return null
    if (!withinDateBounds(key, rec.startDate, rec.endDate)) continue
    if (weekdays && !weekdays.includes(candidate.getDay())) continue
    if (candidate > from) return toUtc(candidate)
  }
  return null
}

// ─── Janela de funcionamento ─────────────────────────────────────────────────

function windowContains(wh: WorkingHours, view: TZDate): boolean {
  if (wh.weekdays.length > 0 && !wh.weekdays.includes(view.getDay())) return false
  const { h: sh, m: sm } = parseHM(wh.start)
  const { h: eh, m: em } = parseHM(wh.end)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  const nowMin = view.getHours() * 60 + view.getMinutes()
  if (endMin <= startMin) {
    // Janela atravessa a meia-noite (ex.: 20:00–06:00)
    return nowMin >= startMin || nowMin < endMin
  }
  return nowMin >= startMin && nowMin < endMin
}

export function isWithinWorkingHours(schedule: Schedule, now: Date, tz: string): boolean {
  if (!schedule.workingHours) return true
  return windowContains(schedule.workingHours, tzView(now, tz))
}

/** Próximo instante em que a janela abre (o próprio `now` se já estiver aberta). */
export function nextWindowStart(schedule: Schedule, now: Date, tz: string): Date {
  const wh = schedule.workingHours
  if (!wh) return now
  if (windowContains(wh, tzView(now, tz))) return now
  const { h, m } = parseHM(wh.start)
  for (let d = 0; d < 8; d++) {
    const candidate = dayAt(now, tz, d, h, m)
    if (candidate <= now) continue
    if (wh.weekdays.length > 0 && !wh.weekdays.includes(candidate.getDay())) continue
    return toUtc(candidate)
  }
  return now
}

/** Meia-noite do dia seguinte no fuso — base do rollover do teto diário. */
export function startOfNextDay(now: Date, tz: string): Date {
  return toUtc(dayAt(now, tz, 1, 0, 0))
}

/** Chave 'YYYY-MM-DD' do dia corrente no fuso — para contar envios do dia. */
export function dayKeyInTz(now: Date, tz: string): string {
  return dayKey(tzView(now, tz))
}

/** O horário 'HH:mm' de hoje (no fuso) já passou? Usado pelo tick diário de automações. */
export function isPastTimeOfDay(now: Date, tz: string, hm: string): boolean {
  const view = tzView(now, tz)
  const { h, m } = parseHM(hm)
  return view.getHours() * 60 + view.getMinutes() >= h * 60 + m
}

// ─── Velocidade ──────────────────────────────────────────────────────────────

export function speedRangeSeconds(speed: Speed, channel: SpeedChannel): { min: number; max: number } {
  if (speed.preset === 'manual') {
    const min = speed.minSeconds ?? 30
    return { min, max: Math.max(speed.maxSeconds ?? min, min) }
  }
  return SPEED_PRESET_RANGES[speed.preset][channel]
}

/** Intervalo aleatório (ms) entre mensagens consecutivas, conforme preset/canal. */
export function randomIntervalMs(speed: Speed, channel: SpeedChannel): number {
  const { min, max } = speedRangeSeconds(speed, channel)
  return Math.round((min + Math.random() * (max - min)) * 1000)
}

/** Pausa de rajada (ms): aleatória entre pauseMin e pauseMax minutos (padrão 1–15). */
export function burstPauseMs(speed: Speed): number {
  const min = speed.pauseMinMinutes ?? 1
  const max = Math.max(speed.pauseMaxMinutes ?? 15, min)
  return Math.round((min + Math.random() * (max - min)) * 60_000)
}

// ─── Aniversário ─────────────────────────────────────────────────────────────

/** Mês-dia corrente ('MM-DD') no fuso informado. */
export function todayMonthDay(now: Date, tz: string): string {
  const view = tzView(now, tz)
  return `${String(view.getMonth() + 1).padStart(2, '0')}-${String(view.getDate()).padStart(2, '0')}`
}

/**
 * Compara birthDate do contato ('YYYY-MM-DD', 'DD/MM' ou 'DD/MM/YYYY') com um
 * mês-dia 'MM-DD'. Formato irreconhecível → false.
 */
export function matchesBirthdayToday(birthDate: string | null | undefined, monthDay: string): boolean {
  if (!birthDate) return false
  const value = birthDate.trim()

  const iso = value.match(/^\d{4}-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}` === monthDay

  const br = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/)
  if (br) {
    const dd = String(Number.parseInt(br[1]!, 10)).padStart(2, '0')
    const mm = String(Number.parseInt(br[2]!, 10)).padStart(2, '0')
    return `${mm}-${dd}` === monthDay
  }
  return false
}

// ─── Templating ──────────────────────────────────────────────────────────────
// Tipagem estrutural (sem dep de @naia/db) para o worker e a API renderizarem
// variantes com o mesmo código.

export type TemplateContact = {
  name: string | null
  whatsappPhone?: string | null
  email?: string | null
  birthDate?: string | null
  company?: string | null
  notes?: string | null
  customFields: string
  identities?: Array<{ channelType: string; channelIdentifier: string }>
}

export function renderTemplate(template: string, contact: TemplateContact): string {
  const customFields = (() => {
    try {
      return JSON.parse(contact.customFields) as Record<string, string>
    } catch {
      return {}
    }
  })()

  const phone =
    contact.whatsappPhone ??
    contact.identities?.find((i) => i.channelType === 'whatsapp')?.channelIdentifier ??
    ''
  const email =
    contact.email ??
    contact.identities?.find((i) => i.channelType === 'email')?.channelIdentifier ??
    ''
  const discord = contact.identities?.find((i) => i.channelType === 'discord')?.channelIdentifier ?? ''
  const birthDate = contact.birthDate ?? ''
  const company = contact.company ?? ''
  const notes = contact.notes ?? ''

  return (template ?? '')
    .replace(/\{\{nome\}\}/gi, contact.name ?? '')
    .replace(/\{\{name\}\}/gi, contact.name ?? '')
    .replace(/\{\{telefone\}\}/gi, phone)
    .replace(/\{\{phone\}\}/gi, phone)
    .replace(/\{\{whatsapp\}\}/gi, phone)
    .replace(/\{\{email\}\}/gi, email)
    .replace(/\{\{nascimento\}\}/gi, birthDate)
    .replace(/\{\{birthdate\}\}/gi, birthDate)
    .replace(/\{\{empresa\}\}/gi, company)
    .replace(/\{\{company\}\}/gi, company)
    .replace(/\{\{observacoes\}\}/gi, notes)
    .replace(/\{\{obs\}\}/gi, notes)
    .replace(/\{\{notes\}\}/gi, notes)
    .replace(/\{\{discord\}\}/gi, discord)
    .replace(/\{\{(\w+)\}\}/g, (_, key) => customFields[key] ?? '')
}
