import { describe, expect, test } from 'bun:test'
import type { Schedule, Speed } from '@naia/schemas'
import {
  burstPauseMs,
  computeNextRunAt,
  dayKeyInTz,
  isWithinWorkingHours,
  matchesBirthdayToday,
  nextWindowStart,
  randomIntervalMs,
  renderTemplate,
  speedRangeSeconds,
  startOfNextDay,
  todayMonthDay,
} from './index'

const SP = 'America/Sao_Paulo' // UTC-3 fixo (sem DST desde 2019)
const NY = 'America/New_York' // DST: útil pra validar wall-clock

const at = (iso: string) => new Date(iso)

describe('computeNextRunAt', () => {
  test('immediate schedules nothing', () => {
    expect(computeNextRunAt({ type: 'immediate' }, at('2026-07-16T12:00:00Z'), SP, 0)).toBeNull()
  })

  test('a future once returns the instant; already executed returns null', () => {
    const s: Schedule = { type: 'once', onceAt: '2026-07-20T14:00:00.000Z' }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-20T14:00:00.000Z',
    )
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 1)).toBeNull()
  })

  test('a past once fires on the next tick (returns from)', () => {
    const s: Schedule = { type: 'once', onceAt: '2026-07-01T14:00:00.000Z' }
    const from = at('2026-07-16T12:00:00Z')
    expect(computeNextRunAt(s, from, SP, 0)?.getTime()).toBe(from.getTime())
  })

  test('daily at 09:00 SP — before and after the time', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'daily', time: '09:00' } }
    expect(computeNextRunAt(s, at('2026-07-16T11:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-16T12:00:00.000Z',
    )
    expect(computeNextRunAt(s, at('2026-07-16T13:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-17T12:00:00.000Z',
    )
  })

  test('daily respects startDate, endDate and maxOccurrences', () => {
    const s: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'daily', time: '09:00', startDate: '2026-07-20', endDate: '2026-07-21' },
    }
    const from = at('2026-07-16T12:00:00Z')
    expect(computeNextRunAt(s, from, SP, 0)?.toISOString()).toBe('2026-07-20T12:00:00.000Z')
    expect(computeNextRunAt(s, at('2026-07-21T13:00:00Z'), SP, 2)).toBeNull()
    const capped: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'daily', time: '09:00', maxOccurrences: 3 },
    }
    expect(computeNextRunAt(capped, from, SP, 3)).toBeNull()
  })

  test('weekly only on chosen days (friday = 5)', () => {
    const s: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'weekly', time: '10:00', weekdays: [5] },
    }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-17T13:00:00.000Z',
    )
    expect(computeNextRunAt(s, at('2026-07-17T14:00:00Z'), SP, 1)?.toISOString()).toBe(
      '2026-07-24T13:00:00.000Z',
    )
  })

  test('weekly without weekdays → null', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'weekly', time: '10:00', weekdays: [] } }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)).toBeNull()
  })

  test('every_x_hours adds hours and respects endDate', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'every_x_hours', everyHours: 6 } }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-16T18:00:00.000Z',
    )
    const ending: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'every_x_hours', everyHours: 6, endDate: '2026-07-16' },
    }
    expect(computeNextRunAt(ending, at('2026-07-17T01:00:00Z'), SP, 3)).toBeNull()
  })

  test('times_per_day distributes within the window', () => {
    const s: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'times_per_day', timesPerDay: 3 },
      workingHours: { start: '09:00', end: '18:00', weekdays: [] },
    }
    expect(computeNextRunAt(s, at('2026-07-16T13:00:00Z'), SP, 1)?.toISOString()).toBe(
      '2026-07-16T15:00:00.000Z',
    )
    expect(computeNextRunAt(s, at('2026-07-16T19:00:00Z'), SP, 3)?.toISOString()).toBe(
      '2026-07-17T12:00:00.000Z',
    )
  })

  test('daily is wall-clock across DST (America/New_York)', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'daily', time: '09:00' } }
    expect(computeNextRunAt(s, at('2026-03-07T15:00:00Z'), NY, 0)?.toISOString()).toBe(
      '2026-03-08T13:00:00.000Z', // EDT (UTC-4)
    )
    expect(computeNextRunAt(s, at('2026-10-31T14:00:00Z'), NY, 0)?.toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    )
  })
})

describe('working hours', () => {
  const s: Schedule = {
    type: 'immediate',
    workingHours: { start: '09:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
  }

  test('inside and outside the window', () => {
    expect(isWithinWorkingHours(s, at('2026-07-16T13:00:00Z'), SP)).toBe(true)
    expect(isWithinWorkingHours(s, at('2026-07-16T22:00:00Z'), SP)).toBe(false)
    expect(isWithinWorkingHours(s, at('2026-07-18T13:00:00Z'), SP)).toBe(false)
  })

  test('without workingHours → always inside', () => {
    expect(isWithinWorkingHours({ type: 'immediate' }, at('2026-07-16T03:00:00Z'), SP)).toBe(true)
  })

  test('a window crossing midnight', () => {
    const night: Schedule = {
      type: 'immediate',
      workingHours: { start: '20:00', end: '06:00', weekdays: [] },
    }
    expect(isWithinWorkingHours(night, at('2026-07-16T02:00:00Z'), SP)).toBe(true) // 23:00 SP
    expect(isWithinWorkingHours(night, at('2026-07-16T15:00:00Z'), SP)).toBe(false) // 12:00 SP
  })

  test('nextWindowStart skips to the next working day', () => {
    expect(nextWindowStart(s, at('2026-07-17T22:00:00Z'), SP).toISOString()).toBe(
      '2026-07-20T12:00:00.000Z',
    )
    const now = at('2026-07-16T13:00:00Z')
    expect(nextWindowStart(s, now, SP).getTime()).toBe(now.getTime())
  })

  test('startOfNextDay and dayKeyInTz', () => {
    expect(startOfNextDay(at('2026-07-17T02:30:00Z'), SP).toISOString()).toBe(
      '2026-07-17T03:00:00.000Z',
    )
    expect(dayKeyInTz(at('2026-07-17T02:30:00Z'), SP)).toBe('2026-07-16')
  })
})

describe('speed', () => {
  test('presets resolve ranges per channel', () => {
    expect(speedRangeSeconds({ preset: 'medio' }, 'whatsapp')).toEqual({ min: 30, max: 60 })
    expect(speedRangeSeconds({ preset: 'rapido' }, 'telegram')).toEqual({ min: 1, max: 3 })
  })

  test("manual uses the user's min/max", () => {
    expect(speedRangeSeconds({ preset: 'manual', minSeconds: 45, maxSeconds: 90 }, 'whatsapp')).toEqual({
      min: 45,
      max: 90,
    })
  })

  test('randomIntervalMs stays within the range', () => {
    const speed: Speed = { preset: 'lento' }
    for (let i = 0; i < 50; i++) {
      const ms = randomIntervalMs(speed, 'whatsapp')
      expect(ms).toBeGreaterThanOrEqual(60_000)
      expect(ms).toBeLessThanOrEqual(180_000)
    }
  })

  test('burstPauseMs between 1 and 15 min by default', () => {
    for (let i = 0; i < 50; i++) {
      const ms = burstPauseMs({ preset: 'medio', pauseEveryN: 20 })
      expect(ms).toBeGreaterThanOrEqual(60_000)
      expect(ms).toBeLessThanOrEqual(15 * 60_000)
    }
  })
})

describe('birthday', () => {
  test('todayMonthDay in the timezone', () => {
    expect(todayMonthDay(at('2026-07-17T02:00:00Z'), SP)).toBe('07-16')
  })

  test('birthDate formats', () => {
    expect(matchesBirthdayToday('1990-07-16', '07-16')).toBe(true)
    expect(matchesBirthdayToday('16/07', '07-16')).toBe(true)
    expect(matchesBirthdayToday('16/7', '07-16')).toBe(true)
    expect(matchesBirthdayToday('16/07/1990', '07-16')).toBe(true)
    expect(matchesBirthdayToday('1990-07-15', '07-16')).toBe(false)
    expect(matchesBirthdayToday('lixo', '07-16')).toBe(false)
    expect(matchesBirthdayToday(null, '07-16')).toBe(false)
  })
})

describe('renderTemplate', () => {
  test('default variables and custom fields', () => {
    const out = renderTemplate('Oi {{nome}}, seu tel é {{telefone}} e o cupom é {{cupom}}', {
      name: 'Ana',
      whatsappPhone: '+5511999999999',
      customFields: JSON.stringify({ cupom: 'NAIA10' }),
    })
    expect(out).toBe('Oi Ana, seu tel é +5511999999999 e o cupom é NAIA10')
  })

  test('unknown variable becomes empty', () => {
    expect(renderTemplate('{{inexistente}}!', { name: null, customFields: '{}' })).toBe('!')
  })
})
