import type { Entitlements, Speed, SpeedChannel, SpeedPreset } from '@naia/schemas'
import { SPEED_PRESET_RANGES } from '@naia/schemas'

export type EntitlementCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string }

export function hasActiveSubscription(e: Entitlements): EntitlementCheckResult {
  return e.status === 'active'
    ? { allowed: true }
    : { allowed: false, reason: 'Assinatura do Naia não está ativa para este workspace.' }
}

export function canAddSeat(e: Entitlements, current: number): EntitlementCheckResult {
  if (current < e.seats) {
    return { allowed: true }
  }
  const isFreeOrSingle = e.tier === 'free' || e.seats <= 1
  return {
    allowed: false,
    reason: isFreeOrSingle
      ? 'O plano Free inclui exatamente 1 assento (já ocupado pelo titular da workspace). Faça upgrade para convidar outros colaboradores.'
      : `Limite de assentos atingido (${e.seats}). Faça upgrade para convidar mais membros.`,
  }
}

export function canAddConnection(e: Entitlements, current: number): EntitlementCheckResult {
  return current < e.connections
    ? { allowed: true }
    : { allowed: false, reason: `Limite de conexões atingido (${e.connections}). Faça upgrade para adicionar mais canais.` }
}

export function canSendWithCredits(
  e: Entitlements,
  toSend: number,
): EntitlementCheckResult {
  return toSend <= e.creditsBalance
    ? { allowed: true }
    : { allowed: false, reason: e.creditsBalance <= 0
        ? 'Seus créditos de disparo acabaram. Compre mais créditos ou aguarde a renovação do ciclo.'
        : `Créditos insuficientes (${e.creditsBalance} disponíveis, ${toSend} necessários). Compre mais ou aguarde a renovação.` }
}

export function canCreateCampaign(e: Entitlements, createdThisMonth: number): EntitlementCheckResult {
  return createdThisMonth < e.campaignsPerMonth
    ? { allowed: true }
    : { allowed: false, reason: `Limite de campanhas do mês atingido (${e.campaignsPerMonth}). Faça upgrade para criar mais.` }
}

export function formatAutomationLimit(e: Entitlements): string {
  if (e.automations < 0) return 'ilimitadas'
  return `${e.automations} ${e.automations === 1 ? 'automação' : 'automações'}`
}

function automationNotAllowedReason(e: Entitlements): string {
  if (e.automations <= 0) {
    return 'Automações estão disponíveis a partir do plano Pro. Faça upgrade para criar automações.'
  }
  return `Limite de automações ativas atingido (${formatAutomationLimit(e)}). Compre uma automação extra ou faça upgrade para o Scale.`
}

export function canCreateAutomation(e: Entitlements, activeCount: number): EntitlementCheckResult {
  if (e.automations < 0 || activeCount < e.automations) {
    return { allowed: true }
  }
  return { allowed: false, reason: automationNotAllowedReason(e) }
}

export function canActivateAutomation(e: Entitlements, activeCount: number): EntitlementCheckResult {
  if (e.automations < 0 || activeCount < e.automations) {
    return { allowed: true }
  }
  return { allowed: false, reason: automationNotAllowedReason(e) }
}

export type SpeedPolicy = {
  allowedPresets: SpeedPreset[]
  manualFloorSeconds: Record<SpeedChannel, number> | null
  burstPauseAllowed: boolean
  presetRanges: typeof SPEED_PRESET_RANGES
}

const TIER_SPEED: Record<string, Omit<SpeedPolicy, 'presetRanges'>> = {
  free: { allowedPresets: ['lento'], manualFloorSeconds: null, burstPauseAllowed: false },
  starter: { allowedPresets: ['lento', 'medio'], manualFloorSeconds: null, burstPauseAllowed: true },
  pro: {
    allowedPresets: ['lento', 'medio', 'rapido', 'manual'],
    manualFloorSeconds: { whatsapp: 20, telegram: 2 },
    burstPauseAllowed: true,
  },
  scale: {
    allowedPresets: ['lento', 'medio', 'rapido', 'manual'],
    manualFloorSeconds: { whatsapp: 15, telegram: 1 },
    burstPauseAllowed: true,
  },
}

export function getSpeedPolicy(tier: string): SpeedPolicy {
  const base = TIER_SPEED[tier] ?? TIER_SPEED.free!
  return { ...base, presetRanges: SPEED_PRESET_RANGES }
}

export function defaultSpeedPreset(tier: string): SpeedPreset {
  const { allowedPresets } = getSpeedPolicy(tier)
  return allowedPresets.includes('medio') ? 'medio' : (allowedPresets[0] ?? 'lento')
}

export function coerceSpeedToPolicy(speed: Speed, tier: string, channels: SpeedChannel[]): Speed {
  const policy = getSpeedPolicy(tier)
  let result: Speed = speed

  if (!policy.allowedPresets.includes(result.preset)) {
    result = { preset: defaultSpeedPreset(tier) }
  }

  if (result.preset === 'manual') {
    const floors = channels
      .map((ch) => policy.manualFloorSeconds?.[ch])
      .filter((v): v is number => typeof v === 'number')
    const floor = floors.length > 0 ? Math.max(...floors) : 0
    if (floor > 0 && (result.minSeconds ?? 0) < floor) {
      result = {
        ...result,
        minSeconds: floor,
        maxSeconds: result.maxSeconds && result.maxSeconds >= floor ? result.maxSeconds : undefined,
      }
    }
  }

  if (result.pauseEveryN && !policy.burstPauseAllowed) {
    result = { ...result, pauseEveryN: undefined, pauseMinMinutes: undefined, pauseMaxMinutes: undefined }
  }

  return result
}

export function canUseSpeed(
  e: Entitlements,
  speed: Speed,
  channels: SpeedChannel[],
): EntitlementCheckResult {
  const policy = getSpeedPolicy(e.tier)

  if (!policy.allowedPresets.includes(speed.preset)) {
    return {
      allowed: false,
      reason: `A velocidade "${speed.preset}" não está disponível no plano ${e.tier}. Faça upgrade para desbloquear velocidades maiores.`,
    }
  }

  if (speed.pauseEveryN && !policy.burstPauseAllowed) {
    return {
      allowed: false,
      reason: `Intervalo entre rajadas de envio não está disponível no plano ${e.tier}. Faça upgrade para configurá-lo.`,
    }
  }

  if (speed.preset === 'manual') {
    if (!speed.minSeconds) {
      return { allowed: false, reason: 'Velocidade manual exige intervalo mínimo (minSeconds).' }
    }
    if (speed.maxSeconds && speed.maxSeconds < speed.minSeconds) {
      return { allowed: false, reason: 'Intervalo máximo não pode ser menor que o mínimo.' }
    }
    for (const channel of channels) {
      const floor = policy.manualFloorSeconds?.[channel]
      if (floor && speed.minSeconds < floor) {
        return {
          allowed: false,
          reason: `O plano ${e.tier} permite intervalo mínimo de ${floor}s no ${channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}. Ajuste o intervalo ou faça upgrade.`,
        }
      }
    }
  }

  return { allowed: true }
}
