import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import type { RolePermissionMap, WorkspaceRolePermissions } from '@crm/schemas'
import { apiClient } from './api'
import { SESSION_COOKIE } from './vianova'

// Todas as chamadas ao crm-api que precisam da identidade do manager passam
// aqui (server-side), anexando o JWT de sessão do cookie httpOnly.
function token(): string | undefined {
  return getCookie(SESSION_COOKIE) ?? undefined
}

export type WorkspaceListItem = {
  id: string
  name: string
  slug: string
  avatarUrl: string | null
  role: 'owner' | 'admin'
  plan: string | null
  status: string | null
}

export const fetchWorkspaces = createServerFn().handler(async (): Promise<WorkspaceListItem[]> => {
  const { data } = await apiClient(token()).workspaces.get()
  return (data?.workspaces ?? []) as WorkspaceListItem[]
})

export const createWorkspace = createServerFn()
  .validator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const res = await apiClient(token()).workspaces.post({ name: data.name })
    const body = res.data as { ok?: boolean; workspace?: { id: string; name: string; slug: string }; error?: string } | null
    if (!body?.ok || !body.workspace) {
      return { error: body?.error ?? 'Erro ao criar workspace.' }
    }
    return { workspace: body.workspace }
  })

export const fetchWorkspace = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }) => {
    const { data: res } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .get()
    return res
  })

export type DashboardStats = {
  summary: {
    agentsCount: number
    activeAgentsCount: number
    connectionsCount: number
    activeConnectionsCount: number
    activeConversationsCount: number
    unassignedConversationsCount: number
  }
  conversationsByStatus: {
    open: number
    assigned: number
    pending: number
    resolved: number
  }
  recentConversations: Array<{
    id: string
    status: 'open' | 'assigned' | 'pending' | 'resolved'
    assignedAgentId: string | null
    updatedAt: string | Date
    contactName: string
    originChannel: 'whatsapp' | 'telegram' | null
  }>
}

export const fetchDashboardStats = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }): Promise<DashboardStats> => {
    const { data: response, error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .dashboard.get()

    if (error || !response || !('summary' in response)) {
      throw new Error('Não foi possível carregar o painel.')
    }
    return response as DashboardStats
  })

export const updateWorkspaceSettings = createServerFn()
  .validator((data: {
    workspaceId: string
    name: string
    description: string
    location: string
    industry: string
    avatarUrl: string
  }) => data)
  .handler(async ({ data }) => {
    const { workspaceId, ...body } = data
    const { data: response, error } = await apiClient(token())
      .workspaces({ workspaceId })
      .patch(body)

    if (error || !response || !('workspace' in response)) {
      return { error: 'Não foi possível salvar as configurações.' }
    }
    return { workspace: response.workspace }
  })

export type AgentItem = {
  id: string
  name: string
  email: string
  role: 'superadmin' | 'admin' | 'agent'
  activatedAt: string | null
  lastLoginAt: string | null
}

export const fetchAgents = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }): Promise<AgentItem[]> => {
    const { data: res } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .agents.get()
    return ((res as { agents?: AgentItem[] })?.agents ?? []) as AgentItem[]
  })

export type CreateAgentResult = {
  agentId: string | null
  message: string | null
  upgradeUrl: string | null
}

export const createAgent = createServerFn()
  .validator((data: { workspaceId: string; name: string; email: string; role: 'admin' | 'agent' }) => data)
  .handler(async ({ data }): Promise<CreateAgentResult> => {
    const res = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .agents.post({ name: data.name, email: data.email, role: data.role })
    const body = res.data as { agent?: { id: string }; message?: string; upgradeUrl?: string } | null
    return {
      agentId: body?.agent?.id ?? null,
      message: body?.message ?? null,
      upgradeUrl: body?.upgradeUrl ?? null,
    }
  })

export const deleteAgent = createServerFn()
  .validator((data: { workspaceId: string; agentId: string }) => data)
  .handler(async ({ data }) => {
    await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .agents({ agentId: data.agentId })
      .delete()
    return { ok: true }
  })

export const resendActivation = createServerFn()
  .validator((data: { workspaceId: string; agentId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .agents({ agentId: data.agentId })['resend-activation'].post()
    return { ok: true }
  })

export type ConnectionItem = {
  id: string
  name: string
  kind: 'whatsapp' | 'telegram'
  status: 'active' | 'error' | 'disconnected'
  createdAt: string
}

export const fetchConnections = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }): Promise<ConnectionItem[]> => {
    const { data: response } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .connections.get()
    return ((response as { connections?: ConnectionItem[] })?.connections ?? []) as ConnectionItem[]
  })

export const createConnection = createServerFn()
  .validator((data: { workspaceId: string; name: string; kind: 'whatsapp' | 'telegram' }) => data)
  .handler(async ({ data }) => {
    const { workspaceId, ...body } = data
    const { data: response, error } = await apiClient(token())
      .workspaces({ workspaceId })
      .connections.post(body)

    if (error || !response || !('connection' in response)) {
      const message = response && 'message' in response ? response.message : 'Não foi possível criar a conexão.'
      return { error: message }
    }
    return { connection: response.connection as ConnectionItem }
  })

export const deleteConnection = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string }) => data)
  .handler(async ({ data }) => {
    const { error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .connections({ connectionId: data.connectionId })
      .delete()
    return error ? { error: 'Não foi possível remover a conexão.' } : { ok: true as const }
  })

export type NotificationItem = {
  id: string
  type: 'billing' | 'security' | 'product' | 'marketing'
  title: string
  body: string | null
  readAt: string | null
  actionUrl: string | null
  actionLabel: string | null
  source: string
  sourceProductSlug: string | null
  sourceWorkspaceId: string | null
  sourceWorkspaceName: string | null
  createdAt: string
  metadata: Record<string, string | number | boolean | null> | null
}

export const fetchNotifications = createServerFn()
  .validator((data: { page?: number; productSlug?: string }) => data)
  .handler(async ({ data }): Promise<{ notifications: NotificationItem[]; total: number; page: number; hasMore?: boolean }> => {
    const query: Record<string, string | number> = { page: data.page ?? 1 }
    if (data.productSlug) query.product_slug = data.productSlug

    const { data: response, error } = await apiClient(token()).notifications.get({ query })
    if (error || !response || typeof response !== 'object' || !('notifications' in response)) {
      throw new Error('Erro ao carregar notificações.')
    }

    return response as { notifications: NotificationItem[]; total: number; page: number; hasMore?: boolean }
  })

export const fetchUnreadNotificationCount = createServerFn().handler(async (): Promise<{ count: number }> => {
  const { data: response, error } = await apiClient(token()).notifications['unread-count'].get()
  if (error || !response || typeof response !== 'object' || !('count' in response)) {
    throw new Error('Erro ao carregar notificações não lidas.')
  }
  return response as { count: number }
})

export const markNotificationRead = createServerFn()
  .validator((notificationId: string) => notificationId)
  .handler(async ({ data: notificationId }) => {
    const { error } = await apiClient(token()).notifications({ id: notificationId }).read.post()
    return error ? { error: 'Erro ao marcar notificação como lida.' } : { ok: true as const }
  })

export const markAllNotificationsRead = createServerFn().handler(async () => {
  const { error } = await apiClient(token()).notifications['read-all'].post()
  return error ? { error: 'Erro ao marcar notificações como lidas.' } : { ok: true as const }
})

// ─── Membros (managers) / Convites / Permissões ──────────────────────────────
// Managers acessam o painel de gestão com conta Vianova — distinto dos agents
// do inbox (auth própria em slug.crm.*).

export type MemberItem = {
  id: string
  vianovaUserId: string
  role: 'owner' | 'admin'
  name: string | null
  email: string | null
  pictureUrl: string | null
  createdAt: string | Date
}

export type InviteItem = {
  id: string
  email: string
  role: 'owner' | 'admin'
  status: 'pending' | 'accepted' | 'expired'
  expiresAt: string | Date | null
  createdAt: string | Date
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    return value.message
  }
  return fallback
}

export const fetchMembers = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }): Promise<MemberItem[]> => {
    const { data: res, error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .members.get()
    if (error) throw new Error('Erro ao carregar membros.')
    return ((res as { members?: MemberItem[] } | null)?.members ?? []) as MemberItem[]
  })

export const fetchInvites = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }): Promise<InviteItem[]> => {
    const { data: res, error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .invites.get()
    if (error) throw new Error('Erro ao carregar convites.')
    return ((res as { invites?: InviteItem[] } | null)?.invites ?? []) as InviteItem[]
  })

export const createInvite = createServerFn()
  .validator((data: { workspaceId: string; email: string; role: 'admin' }) => data)
  .handler(async ({ data }) => {
    const { data: res, error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .invites.post({ email: data.email, role: data.role })
    if (error) return { error: errorMessage(error.value, 'Erro ao enviar convite.') }
    return { invite: (res as { invite?: InviteItem } | null)?.invite }
  })

export const revokeInvite = createServerFn()
  .validator((data: { workspaceId: string; inviteId: string }) => data)
  .handler(async ({ data }) => {
    const { error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .invites({ inviteId: data.inviteId })
      .delete()
    if (error) return { error: errorMessage(error.value, 'Erro ao revogar convite.') }
    return { ok: true as const }
  })

export const updateMemberRole = createServerFn()
  .validator((data: { workspaceId: string; managerId: string; role: 'owner' | 'admin' }) => data)
  .handler(async ({ data }) => {
    const { error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .members({ managerId: data.managerId })
      .patch({ role: data.role })
    if (error) return { error: errorMessage(error.value, 'Erro ao alterar papel.') }
    return { ok: true as const }
  })

export const removeMember = createServerFn()
  .validator((data: { workspaceId: string; managerId: string }) => data)
  .handler(async ({ data }) => {
    const { error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .members({ managerId: data.managerId })
      .delete()
    if (error) return { error: errorMessage(error.value, 'Erro ao remover membro.') }
    return { ok: true as const }
  })

export const acceptInvite = createServerFn()
  .validator((inviteToken: string) => inviteToken)
  .handler(async ({ data: inviteToken }) => {
    const { data: res, error } = await apiClient(token()).invites({ token: inviteToken }).accept.post()
    if (error) return { error: errorMessage(error.value, 'Convite inválido ou expirado.') }
    return { workspace: (res as { workspace?: { id: string } } | null)?.workspace }
  })

export type PermissionMatrix = {
  permissions: WorkspaceRolePermissions
  canEdit: boolean
}

export const fetchPermissions = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }): Promise<PermissionMatrix | null> => {
    const { data: res, error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .permissions.get()
    if (error || !res || typeof res !== 'object' || !('permissions' in res)) return null
    return res as PermissionMatrix
  })

export const updatePermissions = createServerFn()
  .validator((data: { workspaceId: string; admin: RolePermissionMap }) => data)
  .handler(async ({ data }) => {
    const { data: res, error } = await apiClient(token())
      .workspaces({ workspaceId: data.workspaceId })
      .permissions.patch({ admin: data.admin })
    if (error) return { error: errorMessage(error.value, 'Erro ao salvar permissões.') }
    return res
  })

// ─── Billing ─────────────────────────────────────────────────────────────────

export type BillingCatalog = {
  plans: Array<{
    id: string
    tier: string
    name: string
    description: string | null
    priceCents: number
    limits: Record<string, number>
    sortOrder: number
  }>
  addons: Array<{
    id: string
    key: string
    name: string
    description: string | null
    unitLabel: string | null
    priceCents: number
    limitsPerUnit: Record<string, number>
  }>
}

export type BillingSubscription = {
  id: string
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  hasStripeSubscription: boolean
  isOwner: boolean
  plan: { id: string; tier: string; name: string; priceCents: number } | null
  addons: Array<{
    addonTypeId: string
    quantity: number
    key: string
    name: string
    unitLabel: string | null
    priceCents: number
    limitsPerUnit: Record<string, number>
  }>
}

function billingError(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback
  if ('message' in value && typeof value.message === 'string') return value.message
  if ('error' in value && typeof value.error === 'string') return value.error
  return fallback
}

export const fetchPlans = createServerFn().handler(async (): Promise<BillingCatalog | null> => {
  const { data, error } = await apiClient(token()).billing.plans.get()
  if (error || !data || typeof data !== 'object' || !('plans' in data)) return null
  return data as BillingCatalog
})

export const fetchManageBillingUrl = createServerFn().handler(async (): Promise<string | undefined> => {
  const { data } = await apiClient(token()).billing['manage-url'].get()
  return (data as { url?: string } | null)?.url
})

export const fetchBillingSubscription = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }): Promise<{ subscription: BillingSubscription | null } | { error: string }> => {
    const { data, error } = await apiClient(token()).billing.subscription.get({
      query: { workspace_id: workspaceId },
    })
    if (error) return { error: billingError(error.value, 'Erro ao carregar assinatura.') }
    return data as { subscription: BillingSubscription | null }
  })

export const startBillingCheckout = createServerFn()
  .validator((data: {
    workspaceId: string
    workspaceName: string
    planId: string
    successUrl: string
    cancelUrl: string
  }) => data)
  .handler(async ({ data }): Promise<{
    checkoutUrl?: string
    changed?: boolean
    scheduled?: boolean
    activated?: boolean
    effectiveAt?: string
  } | { error: string }> => {
    const { data: result, error } = await apiClient(token()).billing.checkout.post({
      product_slug: 'naia-crm',
      workspace_id: data.workspaceId,
      workspace_name: data.workspaceName,
      plan_id: data.planId,
      success_url: data.successUrl,
      cancel_url: data.cancelUrl,
    })
    if (error) return { error: billingError(error.value, 'Erro ao iniciar a mudança de plano.') }
    return result as {
      checkoutUrl?: string
      changed?: boolean
      scheduled?: boolean
      activated?: boolean
      effectiveAt?: string
    }
  })

export const updateBillingAddon = createServerFn()
  .validator((data: {
    subscriptionId: string
    addonTypeId: string
    quantity: number
    exists: boolean
  }) => data)
  .handler(async ({ data }): Promise<{ chargedNowCents?: number } | { error: string }> => {
    if (data.exists) {
      const { data: result, error } = await apiClient(token())
        .billing.subscriptions({ id: data.subscriptionId })
        .addons({ addonTypeId: data.addonTypeId })
        .patch({ quantity: data.quantity })
      if (error) return { error: billingError(error.value, 'Erro ao atualizar o add-on.') }
      return result as { chargedNowCents?: number }
    }

    const { data: result, error } = await apiClient(token())
      .billing.subscriptions({ id: data.subscriptionId })
      .addons.post({ addon_type_id: data.addonTypeId, quantity: data.quantity })
    if (error) return { error: billingError(error.value, 'Erro ao adicionar o add-on.') }
    return result as { chargedNowCents?: number }
  })
