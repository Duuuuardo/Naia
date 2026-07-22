import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { requireApi } from './session.server'
import { SESSION_COOKIE } from './vianova'
import { requireEnv } from './env'
import { parseApiError } from './api-error'

/** Extrai mensagem segura do erro Eden Treaty sem expor JSON bruto. */
function err(value: unknown, fallback: string): string {
  return parseApiError(value, fallback)
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

export const fetchWorkspaces = createServerFn().handler(async () => {
  const api = await requireApi()
  const { data } = await api.workspaces.get()
  return data?.workspaces ?? []
})

export const fetchWorkspace = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data, error } = await api.workspaces({ workspaceId }).get()
    if (error || !data || !('workspace' in data)) return null
    return data
  })

export const createWorkspace = createServerFn()
  .validator((data: { name: string; industry?: string; description?: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces.post({
      name: data.name,
      industry: data.industry,
      description: data.description,
    })
    if (error) return { error: err(error.value, 'Erro ao criar workspace.') }
    return { workspace: res?.workspace }
  })

export const updateWorkspaceSettings = createServerFn()
  .validator((data: {
    workspaceId: string
    name?: string
    description?: string
    location?: string
    industry?: string
    avatarUrl?: string
  }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { workspaceId, ...fields } = data
    const { error } = await api.workspaces({ workspaceId }).patch(fields)
    if (error) return { error: err(error.value, 'Erro ao salvar configurações.') }
    return { ok: true as const }
  })

export const fetchPermissions = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data, error } = await api.workspaces({ workspaceId }).permissions.get()
    if (error || !data || !('permissions' in data)) return null
    return data
  })

export const updatePermissions = createServerFn()
  .validator((data: {
    workspaceId: string
    admin: Record<string, boolean>
    member: Record<string, boolean>
  }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).permissions.patch({
      admin: data.admin as never,
      member: data.member as never,
    })
    if (error) return { error: err(error.value, 'Erro ao salvar permissões.') }
    return res
  })

// ─── Members / Invites ───────────────────────────────────────────────────────

export const fetchMembers = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data } = await api.workspaces({ workspaceId }).members.get()
    return data?.members ?? []
  })

export const fetchInvites = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data } = await api.workspaces({ workspaceId }).invites.get()
    return data?.invites ?? []
  })

export const createInvite = createServerFn()
  .validator((data: { workspaceId: string; email: string; role: 'admin' | 'member' }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).invites.post({
      email: data.email,
      role: data.role,
    })
    if (error) return { error: err(error.value, 'Erro ao convidar.') }
    return { invite: res?.invite, emailQueued: res?.emailQueued }
  })

export const revokeInvite = createServerFn()
  .validator((data: { workspaceId: string; inviteId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    await api.workspaces({ workspaceId: data.workspaceId }).invites({ inviteId: data.inviteId }).delete()
    return { ok: true }
  })

export const updateMemberRole = createServerFn()
  .validator((data: { workspaceId: string; memberId: string; role: 'admin' | 'member' }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await api.workspaces({ workspaceId: data.workspaceId }).members({ memberId: data.memberId }).patch({
      role: data.role,
    })
    if (error) return { error: err(error.value, 'Erro ao alterar papel.') }
    return { ok: true }
  })

export const removeMember = createServerFn()
  .validator((data: { workspaceId: string; memberId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await api.workspaces({ workspaceId: data.workspaceId }).members({ memberId: data.memberId }).delete()
    if (error) return { error: err(error.value, 'Erro ao remover membro.') }
    return { ok: true }
  })

export const acceptInvite = createServerFn()
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const api = await requireApi()
    const { data, error } = await api.invites({ token }).accept.post()
    if (error) return { error: err(error.value, 'Convite inválido.') }
    return { workspace: data?.workspace }
  })

// ─── Contacts ────────────────────────────────────────────────────────────────

export const fetchContacts = createServerFn()
  .validator((data: { workspaceId: string; search?: string; tag?: string; channel?: string; isGroup?: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res } = await api.workspaces({ workspaceId: data.workspaceId }).contacts.get({
      query: { search: data.search, tag: data.tag, channel: data.channel, isGroup: data.isGroup },
    })
    return { contacts: (res?.contacts ?? []) as Array<any>, total: res?.total ?? 0 }
  })


export const createContact = createServerFn()
  .validator((data: {
    workspaceId: string
    name: string
    telegramChatId?: string | null
    whatsappPhone?: string | null
    email?: string | null
    birthDate?: string | null
    company?: string | null
    notes?: string | null
    avatarUrl?: string | null
    tags?: string[]
    optInStatus?: boolean
  }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts.post({
      name: data.name,
      telegramChatId: data.telegramChatId || undefined,
      whatsappPhone: data.whatsappPhone || undefined,
      email: data.email,
      birthDate: data.birthDate,
      company: data.company,
      notes: data.notes,
      avatarUrl: data.avatarUrl,
      tags: data.tags,
      optInStatus: data.optInStatus,
    })
    if (error) return { error: err(error.value, 'Erro ao criar contato.') }
    return { ok: true }
  })

export const updateContact = createServerFn()
  .validator((data: {
    workspaceId: string
    contactId: string
    name?: string
    telegramChatId?: string | null
    whatsappPhone?: string | null
    email?: string | null
    birthDate?: string | null
    company?: string | null
    notes?: string | null
    avatarUrl?: string | null
    tags?: string[]
    optInStatus?: boolean
  }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts({ contactId: data.contactId }).patch({
      name: data.name,
      telegramChatId: data.telegramChatId,
      whatsappPhone: data.whatsappPhone,
      email: data.email,
      birthDate: data.birthDate,
      company: data.company,
      notes: data.notes,
      avatarUrl: data.avatarUrl,
      tags: data.tags,
      optInStatus: data.optInStatus,
    })
    if (error) return { error: err(error.value, 'Erro ao atualizar contato.') }
    return res
  })


export const deleteContact = createServerFn()
  .validator((data: { workspaceId: string; contactId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts({ contactId: data.contactId }).delete()
    if (error) return { error: err(error.value, 'Erro ao apagar contato.') }
    return { ok: true }
  })

export const importContacts = createServerFn()
  .validator((data: { workspaceId: string; csv: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts.import.post({
      csv: data.csv,
    })
    if (error) return { error: err(error.value, 'Erro ao importar contatos.') }
    return res
  })

export const fetchContactTags = createServerFn()
  .validator((data: { workspaceId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts.tags.get()
    if (error || !res) return { tags: [], items: [] }
    return res as { tags: string[]; items: Array<{ id: string; name: string; color: string; description: string | null; isCustom: boolean }> }
  })

export const createContactTag = createServerFn()
  .validator((data: { workspaceId: string; name: string; color?: string; description?: string | null }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).contacts.tags as any).post({
      name: data.name,
      color: data.color,
      description: data.description,
    })
    if (error) return { error: err(error.value, 'Erro ao criar tag.') }
    return res
  })

export const updateContactTag = createServerFn()
  .validator((data: { workspaceId: string; tagId: string; name?: string; color?: string; description?: string | null }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).contacts.tags({ tagId: data.tagId }) as any).patch({
      name: data.name,
      color: data.color,
      description: data.description,
    })
    if (error) return { error: err(error.value, 'Erro ao atualizar tag.') }
    return res
  })

export const deleteContactTag = createServerFn()
  .validator((data: { workspaceId: string; tagId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }).contacts.tags({ tagId: data.tagId }) as any).delete()
    if (error) return { error: err(error.value, 'Erro ao deletar tag.') }
    return { ok: true }
  })


export const mergeContacts = createServerFn()
  .validator((data: { workspaceId: string; targetContactId: string; sourceContactIds: string[] }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts.merge.post({
      targetContactId: data.targetContactId,
      sourceContactIds: data.sourceContactIds,
    })
    if (error) return { error: err(error.value, 'Erro ao unificar contatos.') }
    return res
  })

export const addContactIdentity = createServerFn()
  .validator((data: { workspaceId: string; contactId: string; channelType: string; channelIdentifier: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).contacts({ contactId: data.contactId }).identities.post({
      channelType: data.channelType as never,
      channelIdentifier: data.channelIdentifier,
      isPrimary: false,
    })
    if (error) return { error: err(error.value, 'Erro ao adicionar identidade.') }
    return res
  })

export const deleteContactIdentity = createServerFn()
  .validator((data: { workspaceId: string; contactId: string; identityId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    await api.workspaces({ workspaceId: data.workspaceId }).contacts({ contactId: data.contactId }).identities({ identityId: data.identityId }).delete()
    return { ok: true }
  })

// ─── Connections ─────────────────────────────────────────────────────────────

export const fetchConnections = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data } = await api.workspaces({ workspaceId }).connections.get()
    return data?.connections ?? []
  })

export const createTelegramUserConnection = createServerFn()
  .validator((data: { workspaceId: string; name: string; phone: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections as any)['telegram-user'].post({
      name: data.name,
      phone: data.phone,
    })
    if (error) return { error: err(error.value, 'Erro ao conectar conta do Telegram.') }
    return { ok: true }
  })

export const submitTelegramLoginCode = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string; code: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['telegram-code'].post({
      code: data.code,
    })
    if (error) return { error: err(error.value, 'Erro ao enviar código.') }
    return { ok: true }
  })

export const submitTelegramLoginPassword = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string; password: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['telegram-password'].post({
      password: data.password,
    })
    if (error) return { error: err(error.value, 'Erro ao enviar senha.') }
    return { ok: true }
  })

export const createWhatsAppConnection = createServerFn()
  .validator((data: { workspaceId: string; name: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await api.workspaces({ workspaceId: data.workspaceId }).connections.whatsapp.post({
      name: data.name,
    })
    if (error) return { error: err(error.value, 'Erro ao criar conexão WhatsApp.') }
    return { ok: true }
  })

export const deleteConnection = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    await api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }).delete()
    return { ok: true }
  })

export const reconnectWhatsApp = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    await api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }).reconnect.post()
    return { ok: true }
  })

export const fetchConnectionContactsSync = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['contacts-sync'].get()
    if (error) return { error: err(error.value, 'Erro ao buscar contatos da conexão.') }
    return { contacts: res?.contacts ?? [] }
  })

export const fetchConnectionGroupsSync = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['groups-sync'].get()
    if (error) return { error: err(error.value, 'Erro ao buscar grupos da conexão.') }
    return { groups: res?.groups ?? [] }
  })

export const importConnectionContacts = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string; contacts: Array<{ name: string; phoneOrId: string; avatarUrl?: string | null }>; tags?: string[] }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['import-contacts'].post({
      contacts: data.contacts,
      tags: data.tags,
    })
    if (error) return { error: err(error.value, 'Erro ao importar contatos.') }
    return res
  })

export const importConnectionGroups = createServerFn()
  .validator((data: {
    workspaceId: string
    connectionId: string
    groups: Array<{
      id: string
      subject: string
      size?: number
      desc?: string
      participants?: Array<{ id: string; admin?: string | null; phoneNumber?: string | null }>
    }>
    tags?: string[]
  }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['import-groups'].post({
      groups: data.groups,
      tags: data.tags,
    })
    if (error) return { error: err(error.value, 'Erro ao importar grupos.') }
    return res
  })

export const importGroupMembers = createServerFn()
  .validator((data: { workspaceId: string; connectionId: string; groupJid: string; tags?: string[] }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).connections({ connectionId: data.connectionId }) as any)['import-group-members'].post({
      groupJid: data.groupJid,
      tags: data.tags,
    })
    if (error) return { error: err(error.value, 'Erro ao importar membros do grupo.') }
    return res
  })

export const syncContactGroupMembers = createServerFn()
  .validator((data: { workspaceId: string; contactId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).contacts({ contactId: data.contactId }) as any)['sync-members'].post()
    if (error) return { error: err(error.value, 'Erro ao sincronizar membros do grupo.') }
    return res
  })


// ─── Campaigns & Dashboard ───────────────────────────────────────────────────

export const fetchDashboardStats = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data } = await (api.workspaces({ workspaceId }) as unknown as { dashboard: { get: () => Promise<{ data?: any }> } }).dashboard.get()
    return data ?? null
  })

export const fetchCampaigns = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data } = await api.workspaces({ workspaceId }).campaigns.get({ query: {} })
    return data?.campaigns ?? []
  })

export const fetchCampaign = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).campaigns({ campaignId: data.campaignId }).get()
    if (error || !res || !('campaign' in res)) return null
    return res
  })

export const fetchCampaignMessages = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string; runId?: string; status?: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res } = await api.workspaces({ workspaceId: data.workspaceId }).campaigns({ campaignId: data.campaignId }).messages.get({
      query: { runId: data.runId, status: data.status },
    })
    return res?.messages ?? []
  })

export type CampaignVariantInput = { body: string; mediaAssetIds?: string[] }
export type CampaignScheduleInput = {
  type: 'immediate' | 'once' | 'recurring'
  onceAt?: string
  recurrence?: {
    kind: 'daily' | 'weekly' | 'every_x_hours' | 'times_per_day'
    time?: string
    weekdays?: number[]
    everyHours?: number
    timesPerDay?: number
    startDate?: string
    endDate?: string
    maxOccurrences?: number
  }
  workingHours?: { start: string; end: string; weekdays: number[] }
  dailyCap?: number
}
export type CampaignSpeedInput = {
  preset: 'lento' | 'medio' | 'rapido' | 'manual'
  minSeconds?: number
  maxSeconds?: number
  pauseEveryN?: number
  pauseMinMinutes?: number
  pauseMaxMinutes?: number
}

// Shape mínimo serializável devolvido pelas mutações — o suficiente pro
// redirect pós-criação; telas de leitura usam fetchCampaign/fetchAutomations.
export type CampaignRef = { id: string; status: string }
export type AutomationRef = { id: string; active: boolean }

export type CampaignPayload = {
  workspaceId: string
  name: string
  connectionIds: string[]
  variants: CampaignVariantInput[]
  segmentFilter?: unknown
  schedule?: CampaignScheduleInput
  speed?: CampaignSpeedInput
  timezone?: string
  applyTagOnDispatch?: string | null
}

export const createCampaign = createServerFn()
  .validator((data: CampaignPayload) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { workspaceId, ...payload } = data
    const { data: res, error } = await api.workspaces({ workspaceId }).campaigns.post(payload as never)
    if (error) return { error: err(error.value, 'Erro ao criar campanha.') }
    return { campaign: (res as { campaign?: CampaignRef })?.campaign }
  })

export const updateCampaign = createServerFn()
  .validator((data: Partial<CampaignPayload> & { workspaceId: string; campaignId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { workspaceId, campaignId, ...payload } = data
    const { data: res, error } = await api.workspaces({ workspaceId }).campaigns({ campaignId }).patch(payload as never)
    if (error) return { error: err(error.value, 'Erro ao atualizar campanha.') }
    return { campaign: (res as { campaign?: CampaignRef })?.campaign }
  })

export const dispatchCampaign = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string; consent: boolean }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    if (!data.consent) return { error: 'É necessário confirmar o consentimento do público antes de disparar.' }
    const { data: res, error } = await api
      .workspaces({ workspaceId: data.workspaceId })
      .campaigns({ campaignId: data.campaignId })
      .dispatch.post({ consent: true })
    if (error) return { error: err(error.value, 'Erro ao disparar campanha.') }
    return { message: (res as { message?: string })?.message }
  })

export const pauseCampaign = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await api.workspaces({ workspaceId: data.workspaceId }).campaigns({ campaignId: data.campaignId }).pause.post()
    if (error) return { error: err(error.value, 'Erro ao pausar campanha.') }
    return { ok: true as const }
  })

export const resumeCampaign = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await api.workspaces({ workspaceId: data.workspaceId }).campaigns({ campaignId: data.campaignId }).resume.post()
    if (error) return { error: err(error.value, 'Erro ao retomar campanha.') }
    return { message: (res as { message?: string })?.message }
  })

export const updateCampaignSchedule = createServerFn()
  .validator((data: {
    workspaceId: string
    campaignId: string
    schedule: CampaignScheduleInput
    timezone?: string
    speed?: CampaignSpeedInput
  }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { workspaceId, campaignId, ...payload } = data
    const { data: res, error } = await api.workspaces({ workspaceId }).campaigns({ campaignId }).schedule.patch(payload as never)
    if (error) return { error: err(error.value, 'Erro ao alterar agendamento.') }
    return { campaign: (res as { campaign?: CampaignRef })?.campaign }
  })

export const cancelCampaign = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    await api.workspaces({ workspaceId: data.workspaceId }).campaigns({ campaignId: data.campaignId }).cancel.post()
    return { ok: true }
  })

export const fetchCampaignRuns = createServerFn()
  .validator((data: { workspaceId: string; campaignId: string; page?: number }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res } = await api
      .workspaces({ workspaceId: data.workspaceId })
      .campaigns({ campaignId: data.campaignId })
      .runs.get({ query: { page: data.page } })
    return { runs: (res as { runs?: Array<any> })?.runs ?? [], total: (res as { total?: number })?.total ?? 0 }
  })

export const fetchSendsTimeseries = createServerFn()
  .validator((data: { workspaceId: string; tz?: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api as any).workspaces[data.workspaceId].dashboard.timeseries.get({
      $query: { tz: data.tz },
    })
    
    if (error) {
      console.error('[fetchSendsTimeseries] erro na API:', error?.status, JSON.stringify(error?.value))
    }
    return (res ?? { perDay: [], perHour: [], timezone: 'America/Sao_Paulo' }) as {
      perDay: Array<{ date: string; sent: number; failed: number }>
      perHour: Array<{ hour: string; sent: number }>
      timezone: string
    }
  })

// ─── Mídia ───────────────────────────────────────────────────────────────────

export const presignMediaUpload = createServerFn()
  .validator((data: { workspaceId: string; filename: string; mimeType: string; sizeBytes: number }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).media.presign.post({
      filename: data.filename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
    })
    if (error) return { error: err(error.value, 'Erro ao preparar upload.') }
    return res as { assetId: string; kind: string; storageKey: string; uploadUrl: string }
  })

export const confirmMediaUpload = createServerFn()
  .validator((data: { workspaceId: string; assetId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).media({ assetId: data.assetId }).confirm.post()
    if (error) return { error: err(error.value, 'Erro ao confirmar upload.') }
    return res as { asset: { id: string; kind: string; filename: string; mimeType: string } }
  })

export const fetchMediaUrl = createServerFn()
  .validator((data: { workspaceId: string; assetId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).media({ assetId: data.assetId }).url.get()
    return (res ?? null) as { url: string; mimeType: string; kind: string } | null
  })

// ─── Audiência (manual + arquivo) ────────────────────────────────────────────

export const bulkUpsertContacts = createServerFn()
  .validator((data: { workspaceId: string; rows: Array<{ name: string; phone: string }>; tags?: string[] }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).contacts as any)['bulk-upsert'].post({
      rows: data.rows,
      tags: data.tags,
    })
    if (error) return { error: err(error.value, 'Erro ao salvar contatos.') }
    return res as { created: number; updated: number; failed: number; errors: string[]; contactIds: string[]; tags: string[] }
  })

export const importContactsFile = createServerFn()
  .validator((data: { workspaceId: string; filename: string; mimeType: string; contentBase64: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    if (!data.workspaceId || !data.contentBase64) return { error: 'Arquivo ou workspace ausente.' }
    const bytes = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0))
    const file = new File([bytes], data.filename, { type: data.mimeType })
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }).contacts as any)['import-file'].post({ file })
    if (error) return { error: err(error.value, 'Erro ao importar arquivo.') }
    return res as { imported: number; skipped: number; failed: number; errors: string[]; tag: string }
  })

// ─── Automações ──────────────────────────────────────────────────────────────

export type AutomationStepInput = {
  id: string
  action: 'message' | 'delay' | 'add_tag'
  content?: CampaignVariantInput[]
  delayHours?: number
  tag?: string
}

export type AutomationPayload = {
  workspaceId: string
  name: string
  type: 'birthday' | 'webhook' | 'tag_added' | 'contact_created'
  connectionIds: string[]
  content?: CampaignVariantInput[]
  steps?: AutomationStepInput[]
  stopOnTags?: string[]
  triggerTag?: string
  sendTime?: string
  timezone?: string
  speed?: CampaignSpeedInput
  active?: boolean
}

export const fetchAutomations = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data } = await (api.workspaces({ workspaceId }) as any).automations.get()
    return (data?.automations ?? []) as Array<any>
  })

export const createAutomation = createServerFn()
  .validator((data: AutomationPayload) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { workspaceId, ...payload } = data
    const { data: res, error } = await (api.workspaces({ workspaceId }) as any).automations.post(payload)
    if (error) return { error: err(error.value, 'Erro ao criar automação.') }
    return { automation: (res as { automation?: AutomationRef })?.automation }
  })

export const updateAutomation = createServerFn()
  .validator((data: Partial<AutomationPayload> & { workspaceId: string; automationId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { workspaceId, automationId, ...payload } = data
    const { data: res, error } = await (api.workspaces({ workspaceId }) as any).automations({ automationId }).patch(payload)
    if (error) return { error: err(error.value, 'Erro ao atualizar automação.') }
    return { automation: (res as { automation?: AutomationRef })?.automation }
  })

export const toggleAutomation = createServerFn()
  .validator((data: { workspaceId: string; automationId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).automations({ automationId: data.automationId }).toggle.post()
    if (error) return { error: err(error.value, 'Erro ao alternar automação.') }
    return res as { active: boolean }
  })

export const deleteAutomation = createServerFn()
  .validator((data: { workspaceId: string; automationId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).automations({ automationId: data.automationId }).delete()
    if (error) return { error: err(error.value, 'Erro ao excluir automação.') }
    return { ok: true as const }
  })

// ─── Billing ─────────────────────────────────────────────────────────────────

export const fetchPlans = createServerFn()
  .handler(async () => {
    const api = await requireApi()
    const { data, error } = await api.billing.plans.get()
    if (error || !data || !('plans' in data)) return null
    return data
  })

export const fetchManageBillingUrl = createServerFn().handler(async (): Promise<string | undefined> => {
  const api = await requireApi()
  const { data } = await api.billing['manage-url'].get()
  return (data as { url?: string } | null)?.url
})

// ─── Vianova Storage (arquivos do workspace) ─────────────────────────────────

export const fetchWorkspaceFiles = createServerFn()
  .validator((data: { workspaceId: string; status?: 'active' | 'trashed'; cursor?: string; ownerUserId?: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const query: Record<string, string | number> = { status: data.status ?? 'active', limit: 50 }
    if (data.cursor) query.cursor = data.cursor
    if (data.ownerUserId) query.ownerUserId = data.ownerUserId
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).files.get({
      query,
    })
    if (error || !res) return { error: (error?.value as { message?: string })?.message ?? 'Erro ao listar arquivos.' }
    return res as { items: Array<{ id: string; url: string; originalName: string; mimeType: string; sizeBytes: number; status: string; createdAt: string }>; nextCursor: string | null }
  })

export const fetchFileUsage = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId }) as any).files.usage.get()
    if (error || !res) return { error: (error?.value as { message?: string })?.message ?? 'Erro ao consultar uso.' }
    return res as { usedBytes: number; quotaBytes: number; maxFileSizeBytes: number; fileCount: number; percent: number }
  })

export const uploadWorkspaceFile = createServerFn({ method: 'POST' })
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error('Expected FormData')
    const workspaceId = data.get('workspaceId')?.toString()
    const file = data.get('file')
    if (!workspaceId || !(file instanceof File)) throw new Error('Dados inválidos.')
    return { workspaceId, file }
  })
  .handler(async ({ data }) => {
    const token = getCookie(SESSION_COOKIE)
    if (!token) return { error: 'Não autenticado.' }

    const form = new FormData()
    form.append('file', data.file)

    const apiUrl = requireEnv('NAIA_API_URL')
    const res = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(data.workspaceId)}/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: 'Erro ao enviar arquivo.' }))
      return { error: (body as { message?: string }).message ?? 'Erro ao enviar arquivo.' }
    }

    return (await res.json()) as { id: string; url: string; sizeBytes: number; mimeType: string; originalName: string }
  })

function mediaKindFromMime(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}

export const uploadCampaignMedia = createServerFn({ method: 'POST' })
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error('Expected FormData')
    const workspaceId = data.get('workspaceId')?.toString()
    const file = data.get('file')
    if (!workspaceId || !(file instanceof File)) throw new Error('Dados inválidos.')
    return { workspaceId, file }
  })
  .handler(async ({ data }) => {
    const token = getCookie(SESSION_COOKIE)
    if (!token) return { error: 'Não autenticado.' }

    const form = new FormData()
    form.append('file', data.file)

    const apiUrl = requireEnv('NAIA_API_URL')
    const res = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(data.workspaceId)}/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: 'Erro ao enviar arquivo.' }))
      return { error: (body as { message?: string }).message ?? 'Erro ao enviar arquivo.' }
    }

    const file = (await res.json()) as { id: string; url: string; sizeBytes: number; mimeType: string; originalName: string }
    return {
      assetId: file.id,
      filename: file.originalName,
      mimeType: file.mimeType,
      kind: mediaKindFromMime(file.mimeType),
      previewUrl: file.url,
    }
  })

export const deleteWorkspaceFile = createServerFn()
  .validator((data: { workspaceId: string; fileId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).files({ fileId: data.fileId }).delete()
    if (error) return { error: err(error.value, 'Erro ao remover arquivo.') }
    return { ok: true as const }
  })

export const restoreWorkspaceFile = createServerFn()
  .validator((data: { workspaceId: string; fileId: string }) => data)
  .handler(async ({ data }) => {
    const api = await requireApi()
    const { error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any).files({ fileId: data.fileId }).restore.post()
    if (error) return { error: err(error.value, 'Erro ao restaurar arquivo.') }
    return { ok: true as const }
  })

// ─── Notificações (proxy para central do Vianova) ────────────────────────────

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
    const api = await requireApi()
    const query: Record<string, string | number> = { page: data.page ?? 1 }
    if (data.productSlug) query.product_slug = data.productSlug
    const { data: res, error } = await api.notifications.get({ query })
    if (error || !res) return { notifications: [] as NotificationItem[], total: 0, page: 1 }
    return res as { notifications: NotificationItem[]; total: number; page: number; hasMore?: boolean }
  })

export const fetchUnreadNotificationCount = createServerFn()
  .handler(async (): Promise<{ count: number }> => {
    const api = await requireApi()
    const { data: res, error } = await api.notifications['unread-count'].get()
    if (error || !res) return { count: 0 }
    return res as { count: number }
  })

export const markNotificationRead = createServerFn()
  .validator((notificationId: string) => notificationId)
  .handler(async ({ data: notificationId }): Promise<{ ok: true }> => {
    const api = await requireApi()
    await api.notifications({ id: notificationId }).read.post()
    return { ok: true as const }
  })

export const markAllNotificationsRead = createServerFn()
  .handler(async (): Promise<{ ok: true }> => {
    const api = await requireApi()
    await api.notifications['read-all'].post()
    return { ok: true as const }
  })

export type NotificationPreferences = {
  emailOnCampaignCompleted: boolean
  emailOnCampaignFailed: boolean
  emailOnCreditsExhausted: boolean
  emailOnConnectionDisconnected: boolean
}

export const fetchNotificationPreferences = createServerFn()
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }): Promise<NotificationPreferences> => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId }) as any)['notification-preferences'].get()
    if (error || !res) {
      return {
        emailOnCampaignCompleted: true,
        emailOnCampaignFailed: true,
        emailOnCreditsExhausted: true,
        emailOnConnectionDisconnected: true,
      }
    }
    return res.preferences as NotificationPreferences
  })

export const updateNotificationPreferences = createServerFn()
  .validator((data: { workspaceId: string; preferences: Partial<NotificationPreferences> }) => data)
  .handler(async ({ data }): Promise<NotificationPreferences> => {
    const api = await requireApi()
    const { data: res, error } = await (api.workspaces({ workspaceId: data.workspaceId }) as any)['notification-preferences'].patch(data.preferences)
    if (error || !res) throw new Error('Erro ao salvar preferências.')
    return res.preferences as NotificationPreferences
  })
