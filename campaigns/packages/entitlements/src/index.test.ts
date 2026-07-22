import { describe, expect, it } from 'bun:test'
import { coerceSpeedToPolicy, defaultSpeedPreset, getSpeedPolicy } from './index'

describe('defaultSpeedPreset', () => {
  it('free só tem lento — o padrão é lento', () => {
    expect(defaultSpeedPreset('free')).toBe('lento')
  })

  it('planos com medio disponível usam medio como padrão', () => {
    expect(defaultSpeedPreset('starter')).toBe('medio')
    expect(defaultSpeedPreset('pro')).toBe('medio')
    expect(defaultSpeedPreset('scale')).toBe('medio')
  })

  it('tier desconhecido cai na política do free', () => {
    expect(defaultSpeedPreset('nao-existe')).toBe('lento')
  })
})

describe('coerceSpeedToPolicy', () => {
  it('preset fora do plano volta ao padrão do plano (downgrade)', () => {
    expect(coerceSpeedToPolicy({ preset: 'rapido' }, 'free', ['whatsapp'])).toEqual({ preset: 'lento' })
    expect(coerceSpeedToPolicy({ preset: 'rapido' }, 'starter', ['whatsapp'])).toEqual({ preset: 'medio' })
  })

  it('preset permitido passa intacto', () => {
    expect(coerceSpeedToPolicy({ preset: 'lento' }, 'free', ['whatsapp'])).toEqual({ preset: 'lento' })
    expect(coerceSpeedToPolicy({ preset: 'rapido' }, 'pro', ['whatsapp'])).toEqual({ preset: 'rapido' })
  })

  it('manual abaixo do piso do plano é clampado por canal', () => {
    // scale (piso 15s WhatsApp) → pro (piso 20s): minSeconds sobe pro piso
    const coerced = coerceSpeedToPolicy({ preset: 'manual', minSeconds: 15, maxSeconds: 18 }, 'pro', ['whatsapp'])
    expect(coerced.minSeconds).toBe(20)
    // maxSeconds abaixo do novo piso é descartado
    expect(coerced.maxSeconds).toBeUndefined()
  })

  it('manual dentro do piso passa intacto', () => {
    const speed = { preset: 'manual' as const, minSeconds: 30, maxSeconds: 60 }
    expect(coerceSpeedToPolicy(speed, 'pro', ['whatsapp'])).toEqual(speed)
  })

  it('campanha mista clampa pelo piso mais alto entre os canais', () => {
    const coerced = coerceSpeedToPolicy({ preset: 'manual', minSeconds: 2 }, 'pro', ['whatsapp', 'telegram'])
    expect(coerced.minSeconds).toBe(20)
  })

  it('pausa de rajada some quando o plano não a permite', () => {
    const coerced = coerceSpeedToPolicy(
      { preset: 'lento', pauseEveryN: 30, pauseMinMinutes: 1, pauseMaxMinutes: 15 },
      'free',
      ['whatsapp'],
    )
    expect(coerced).toEqual({ preset: 'lento' })
  })

  it('manual vira o padrão do plano quando manual não é permitido', () => {
    const coerced = coerceSpeedToPolicy({ preset: 'manual', minSeconds: 5 }, 'starter', ['whatsapp'])
    expect(coerced).toEqual({ preset: 'medio' })
  })
})

describe('getSpeedPolicy', () => {
  it('free não tem pausa de rajada nem manual', () => {
    const policy = getSpeedPolicy('free')
    expect(policy.allowedPresets).toEqual(['lento'])
    expect(policy.burstPauseAllowed).toBe(false)
    expect(policy.manualFloorSeconds).toBeNull()
  })
})
