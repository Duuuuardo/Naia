// Checagens de entitlement do CRM. Toda ação relevante (criar agente, conexão,
// aceitar conversa) passa por aqui — nunca inline no route handler.
// A forma do entitlement espelha a tabela `entitlements` do @crm/db.

export interface CrmEntitlements {
  plan: string
  status: string
  agentsLimit: number
  connectionsLimit: number
  activeConversationsLimit: number
  managersLimit: number
}

export type EntitlementCheckResult = { allowed: true } | { allowed: false; reason: string }

// -1 = ilimitado (plano Scale).
const isUnlimited = (limit: number): boolean => limit < 0

export function hasActiveSubscription(e: CrmEntitlements): EntitlementCheckResult {
  return e.status === 'active'
    ? { allowed: true }
    : { allowed: false, reason: 'A assinatura do CRM não está ativa para este workspace.' }
}

export function canAddAgent(e: CrmEntitlements, currentAgents: number): EntitlementCheckResult {
  if (isUnlimited(e.agentsLimit) || currentAgents < e.agentsLimit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de agentes atingido (${e.agentsLimit}). Faça upgrade para adicionar mais atendentes.`,
  }
}

export function canAddConnection(e: CrmEntitlements, currentConnections: number): EntitlementCheckResult {
  if (isUnlimited(e.connectionsLimit) || currentConnections < e.connectionsLimit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de conexões atingido (${e.connectionsLimit}). Faça upgrade para adicionar mais canais.`,
  }
}

export function canAcceptConversation(e: CrmEntitlements, activeConversations: number): EntitlementCheckResult {
  if (isUnlimited(e.activeConversationsLimit) || activeConversations < e.activeConversationsLimit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de conversas ativas atingido (${e.activeConversationsLimit}). Faça upgrade para atender mais clientes simultaneamente.`,
  }
}

// `projected` = managers ativos + convites pendentes — o convite novo é
// bloqueado quando essa projeção atinge o limite do plano.
export function canAddManager(e: CrmEntitlements, projected: number): EntitlementCheckResult {
  if (isUnlimited(e.managersLimit) || projected < e.managersLimit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de gerentes atingido (${e.managersLimit}). Faça upgrade para adicionar mais gerentes ao workspace.`,
  }
}

// Limites de filas, pipelines e bots derivam do plano — ainda não há colunas
// próprias no entitlement sincronizado pelo Vianova. free → 1, starter → 3,
// pro/scale → ilimitado. Plano desconhecido cai no conservador (1).
// Decisão (M2): equipes (teams) e tags NÃO têm limite por plano — ilimitados
// em qualquer plano, sem checagem de entitlement. Mantido assim de propósito:
// são recursos organizacionais leves, não alavancas de upgrade.
function planFeatureLimit(plan: string): number {
  if (plan === 'pro' || plan === 'scale') return -1
  if (plan === 'starter') return 3
  return 1
}

export function canAddQueue(e: CrmEntitlements, currentCount: number): EntitlementCheckResult {
  const limit = planFeatureLimit(e.plan)
  if (isUnlimited(limit) || currentCount < limit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de filas atingido (${limit}). Faça upgrade para criar mais filas de atendimento.`,
  }
}

export function canAddPipeline(e: CrmEntitlements, currentCount: number): EntitlementCheckResult {
  const limit = planFeatureLimit(e.plan)
  if (isUnlimited(limit) || currentCount < limit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de funis atingido (${limit}). Faça upgrade para criar mais funis de vendas.`,
  }
}

export function canActivateBot(e: CrmEntitlements, currentActiveCount: number): EntitlementCheckResult {
  const limit = planFeatureLimit(e.plan)
  if (isUnlimited(limit) || currentActiveCount < limit) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `Limite de bots ativos atingido (${limit}). Faça upgrade para manter mais fluxos publicados.`,
  }
}

export function formatLimit(limit: number): string {
  return isUnlimited(limit) ? 'ilimitado' : String(limit)
}
