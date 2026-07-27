import { describe, expect, test } from 'bun:test'
import { createEventEnvelope, isChannel, normalizePhone } from './index'

describe('@naia/channel-core', () => {
  test('reconhece somente canais suportados', () => {
    expect(isChannel('whatsapp')).toBe(true)
    expect(isChannel('telegram')).toBe(true)
    expect(isChannel('discord')).toBe(false)
  })

  test('normaliza telefone sem aplicar regra de produto', () => {
    expect(normalizePhone('+55 (11) 99999-0000')).toBe('5511999990000')
  })

  test('cria envelope técnico versionado', () => {
    const event = createEventEnvelope('adapter.ready', { connectionId: 'connection-1' }, {
      id: 'event-1',
      occurredAt: '2026-07-24T12:00:00.000Z',
    })

    expect(event).toEqual({
      id: 'event-1',
      type: 'adapter.ready',
      version: 1,
      occurredAt: '2026-07-24T12:00:00.000Z',
      payload: { connectionId: 'connection-1' },
    })
  })
})
