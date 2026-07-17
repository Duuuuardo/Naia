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
  test('immediate não agenda nada', () => {
    expect(computeNextRunAt({ type: 'immediate' }, at('2026-07-16T12:00:00Z'), SP, 0)).toBeNull()
  })

  test('once futuro retorna o instante; já executado retorna null', () => {
    const s: Schedule = { type: 'once', onceAt: '2026-07-20T14:00:00.000Z' }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-20T14:00:00.000Z',
    )
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 1)).toBeNull()
  })

  test('once no passado dispara no próximo tick (retorna from)', () => {
    const s: Schedule = { type: 'once', onceAt: '2026-07-01T14:00:00.000Z' }
    const from = at('2026-07-16T12:00:00Z')
    expect(computeNextRunAt(s, from, SP, 0)?.getTime()).toBe(from.getTime())
  })

  test('daily às 09:00 SP — antes e depois do horário', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'daily', time: '09:00' } }
    // 08:00 SP (11:00Z) → hoje 09:00 SP = 12:00Z
    expect(computeNextRunAt(s, at('2026-07-16T11:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-16T12:00:00.000Z',
    )
    // 10:00 SP → amanhã 09:00 SP
    expect(computeNextRunAt(s, at('2026-07-16T13:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-17T12:00:00.000Z',
    )
  })

  test('daily respeita startDate, endDate e maxOccurrences', () => {
    const s: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'daily', time: '09:00', startDate: '2026-07-20', endDate: '2026-07-21' },
    }
    const from = at('2026-07-16T12:00:00Z')
    expect(computeNextRunAt(s, from, SP, 0)?.toISOString()).toBe('2026-07-20T12:00:00.000Z')
    // depois do último dia → null
    expect(computeNextRunAt(s, at('2026-07-21T13:00:00Z'), SP, 2)).toBeNull()
    const capped: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'daily', time: '09:00', maxOccurrences: 3 },
    }
    expect(computeNextRunAt(capped, from, SP, 3)).toBeNull()
  })

  test('weekly só nos dias escolhidos (sexta = 5)', () => {
    const s: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'weekly', time: '10:00', weekdays: [5] },
    }
    // 2026-07-16 é quinta; próxima sexta 17/07 10:00 SP = 13:00Z
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-17T13:00:00.000Z',
    )
    // sexta 14:00Z (11:00 SP, depois das 10:00) → sexta seguinte 24/07
    expect(computeNextRunAt(s, at('2026-07-17T14:00:00Z'), SP, 1)?.toISOString()).toBe(
      '2026-07-24T13:00:00.000Z',
    )
  })

  test('weekly sem weekdays → null', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'weekly', time: '10:00', weekdays: [] } }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)).toBeNull()
  })

  test('every_x_hours soma horas e respeita endDate', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'every_x_hours', everyHours: 6 } }
    expect(computeNextRunAt(s, at('2026-07-16T12:00:00Z'), SP, 0)?.toISOString()).toBe(
      '2026-07-16T18:00:00.000Z',
    )
    const ending: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'every_x_hours', everyHours: 6, endDate: '2026-07-16' },
    }
    // 22:00 SP + 6h cai em 17/07 → null
    expect(computeNextRunAt(ending, at('2026-07-17T01:00:00Z'), SP, 3)).toBeNull()
  })

  test('times_per_day distribui na janela', () => {
    const s: Schedule = {
      type: 'recurring',
      recurrence: { kind: 'times_per_day', timesPerDay: 3 },
      workingHours: { start: '09:00', end: '18:00', weekdays: [] },
    }
    // slots: 09:00, 12:00, 15:00 SP. Às 10:00 SP (13:00Z) → 12:00 SP (15:00Z)
    expect(computeNextRunAt(s, at('2026-07-16T13:00:00Z'), SP, 1)?.toISOString()).toBe(
      '2026-07-16T15:00:00.000Z',
    )
    // depois do último slot → primeiro slot de amanhã
    expect(computeNextRunAt(s, at('2026-07-16T19:00:00Z'), SP, 3)?.toISOString()).toBe(
      '2026-07-17T12:00:00.000Z',
    )
  })

  test('daily é wall-clock através do DST (America/New_York)', () => {
    const s: Schedule = { type: 'recurring', recurrence: { kind: 'daily', time: '09:00' } }
    // 07/03/2026: EST (UTC-5), 09:00 = 14:00Z. DST começa 08/03.
    expect(computeNextRunAt(s, at('2026-03-07T15:00:00Z'), NY, 0)?.toISOString()).toBe(
      '2026-03-08T13:00:00.000Z', // EDT (UTC-4)
    )
    // Volta do DST: 01/11/2026 → 09:00 EST = 14:00Z
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

  test('dentro e fora da janela', () => {
    // quinta 16/07 10:00 SP
    expect(isWithinWorkingHours(s, at('2026-07-16T13:00:00Z'), SP)).toBe(true)
    // quinta 19:00 SP
    expect(isWithinWorkingHours(s, at('2026-07-16T22:00:00Z'), SP)).toBe(false)
    // sábado 18/07 10:00 SP
    expect(isWithinWorkingHours(s, at('2026-07-18T13:00:00Z'), SP)).toBe(false)
  })

  test('sem workingHours → sempre dentro', () => {
    expect(isWithinWorkingHours({ type: 'immediate' }, at('2026-07-16T03:00:00Z'), SP)).toBe(true)
  })

  test('janela atravessando a meia-noite', () => {
    const night: Schedule = {
      type: 'immediate',
      workingHours: { start: '20:00', end: '06:00', weekdays: [] },
    }
    expect(isWithinWorkingHours(night, at('2026-07-16T02:00:00Z'), SP)).toBe(true) // 23:00 SP
    expect(isWithinWorkingHours(night, at('2026-07-16T15:00:00Z'), SP)).toBe(false) // 12:00 SP
  })

  test('nextWindowStart pula pro próximo dia útil', () => {
    // sexta 17/07 19:00 SP (22:00Z) → segunda 20/07 09:00 SP (12:00Z)
    expect(nextWindowStart(s, at('2026-07-17T22:00:00Z'), SP).toISOString()).toBe(
      '2026-07-20T12:00:00.000Z',
    )
    // dentro da janela → retorna o próprio instante
    const now = at('2026-07-16T13:00:00Z')
    expect(nextWindowStart(s, now, SP).getTime()).toBe(now.getTime())
  })

  test('startOfNextDay e dayKeyInTz', () => {
    // 16/07 23:30 SP (17/07 02:30Z) → meia-noite de 17/07 SP = 03:00Z
    expect(startOfNextDay(at('2026-07-17T02:30:00Z'), SP).toISOString()).toBe(
      '2026-07-17T03:00:00.000Z',
    )
    expect(dayKeyInTz(at('2026-07-17T02:30:00Z'), SP)).toBe('2026-07-16')
  })
})

describe('velocidade', () => {
  test('presets resolvem ranges por canal', () => {
    expect(speedRangeSeconds({ preset: 'medio' }, 'whatsapp')).toEqual({ min: 30, max: 60 })
    expect(speedRangeSeconds({ preset: 'rapido' }, 'telegram')).toEqual({ min: 1, max: 3 })
  })

  test('manual usa min/max do usuário', () => {
    expect(speedRangeSeconds({ preset: 'manual', minSeconds: 45, maxSeconds: 90 }, 'whatsapp')).toEqual({
      min: 45,
      max: 90,
    })
  })

  test('randomIntervalMs fica dentro do range', () => {
    const speed: Speed = { preset: 'lento' }
    for (let i = 0; i < 50; i++) {
      const ms = randomIntervalMs(speed, 'whatsapp')
      expect(ms).toBeGreaterThanOrEqual(60_000)
      expect(ms).toBeLessThanOrEqual(180_000)
    }
  })

  test('burstPauseMs entre 1 e 15 min por padrão', () => {
    for (let i = 0; i < 50; i++) {
      const ms = burstPauseMs({ preset: 'medio', pauseEveryN: 20 })
      expect(ms).toBeGreaterThanOrEqual(60_000)
      expect(ms).toBeLessThanOrEqual(15 * 60_000)
    }
  })
})

describe('aniversário', () => {
  test('todayMonthDay no fuso', () => {
    // 17/07 02:00Z ainda é 16/07 em SP
    expect(todayMonthDay(at('2026-07-17T02:00:00Z'), SP)).toBe('07-16')
  })

  test('formatos de birthDate', () => {
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
  test('variáveis padrão e custom fields', () => {
    const out = renderTemplate('Oi {{nome}}, seu tel é {{telefone}} e o cupom é {{cupom}}', {
      name: 'Ana',
      whatsappPhone: '+5511999999999',
      customFields: JSON.stringify({ cupom: 'NAIA10' }),
    })
    expect(out).toBe('Oi Ana, seu tel é +5511999999999 e o cupom é NAIA10')
  })

  test('variável desconhecida vira vazio', () => {
    expect(renderTemplate('{{inexistente}}!', { name: null, customFields: '{}' })).toBe('!')
  })
})
