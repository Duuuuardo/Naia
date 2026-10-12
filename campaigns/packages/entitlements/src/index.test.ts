import { describe, expect, it } from 'bun:test'
import { coerceSpeedToPolicy, defaultSpeedPreset, getSpeedPolicy } from './index'

describe('defaultSpeedPreset', () => {
  it('free only has 'lento' — the default is 'lento'', () => {
    expect(defaultSpeedPreset('free')).toBe('lento')
  })

  it('plans with 'medio' available use 'medio' as default', () => {
    expect(defaultSpeedPreset('starter')).toBe('medio')
    expect(defaultSpeedPreset('pro')).toBe('medio')
    expect(defaultSpeedPreset('scale')).toBe('medio')
  })

  it('unknown tier falls back to the free policy', () => {
    expect(defaultSpeedPreset('nao-existe')).toBe('lento')
  })
})

describe('coerceSpeedToPolicy', () => {
  it('an out-of-plan preset falls back to the plan default (downgrade)', () => {
    expect(coerceSpeedToPolicy({ preset: 'rapido' }, 'free', ['whatsapp'])).toEqual({ preset: 'lento' })
    expect(coerceSpeedToPolicy({ preset: 'rapido' }, 'starter', ['whatsapp'])).toEqual({ preset: 'medio' })
  })

  it('an allowed preset passes through untouched', () => {
    expect(coerceSpeedToPolicy({ preset: 'lento' }, 'free', ['whatsapp'])).toEqual({ preset: 'lento' })
    expect(coerceSpeedToPolicy({ preset: 'rapido' }, 'pro', ['whatsapp'])).toEqual({ preset: 'rapido' })
  })

  it('manual below the plan floor is clamped per channel', () => {
    const coerced = coerceSpeedToPolicy({ preset: 'manual', minSeconds: 15, maxSeconds: 18 }, 'pro', ['whatsapp'])
    expect(coerced.minSeconds).toBe(20)
    expect(coerced.maxSeconds).toBeUndefined()
  })

  it('manual within the floor passes through untouched', () => {
    const speed = { preset: 'manual' as const, minSeconds: 30, maxSeconds: 60 }
    expect(coerceSpeedToPolicy(speed, 'pro', ['whatsapp'])).toEqual(speed)
  })

  it('a mixed campaign clamps by the highest floor across channels', () => {
    const coerced = coerceSpeedToPolicy({ preset: 'manual', minSeconds: 2 }, 'pro', ['whatsapp', 'telegram'])
    expect(coerced.minSeconds).toBe(20)
  })

  it('burst pause disappears when the plan does not allow it', () => {
    const coerced = coerceSpeedToPolicy(
      { preset: 'lento', pauseEveryN: 30, pauseMinMinutes: 1, pauseMaxMinutes: 15 },
      'free',
      ['whatsapp'],
    )
    expect(coerced).toEqual({ preset: 'lento' })
  })

  it('manual falls back to the plan default when manual is not allowed', () => {
    const coerced = coerceSpeedToPolicy({ preset: 'manual', minSeconds: 5 }, 'starter', ['whatsapp'])
    expect(coerced).toEqual({ preset: 'medio' })
  })
})

describe('getSpeedPolicy', () => {
  it('free has neither burst pause nor manual', () => {
    const policy = getSpeedPolicy('free')
    expect(policy.allowedPresets).toEqual(['lento'])
    expect(policy.burstPauseAllowed).toBe(false)
    expect(policy.manualFloorSeconds).toBeNull()
  })
})
