import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'

// JSON puro: o retorno das server fns precisa ser serializável (Record<string,
// unknown> não passa na validação de serialização do TanStack Start).
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// Espelha BotFlowDefinition de @crm/schemas, mas com data em JsonValue
// (serializável nas server fns). Estruturalmente atribuível ao tipo da API.
export type BotNodeKind =
  | 'start'
  | 'message'
  | 'menu'
  | 'buttons'
  | 'condition'
  | 'collect_input'
  | 'delay'
  | 'assign_queue'
  | 'assign_agent'
  | 'end'
  | 'close_conversation'
  | 'manage_tag'
  | 'webhook'

export type BotFlowNode = {
  id: string
  kind: BotNodeKind
  position?: { x: number; y: number }
  data: Record<string, JsonValue>
}

export type BotFlowEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

export type BotFlowDefinition = { nodes: BotFlowNode[]; edges: BotFlowEdge[] }

// Sessão do inbox = auth PRÓPRIA do CRM (email/senha), independente do
// Vianova. O token JWT do agente fica num cookie httpOnly na origem web;
// as chamadas ao crm-api anexam esse token como Bearer. Um segundo cookie
// (também httpOnly) guarda o perfil do agente (nome/role) como cache — o
// getInboxAgent sempre revalida na API (GET /inbox/me) e atualiza esse cookie.

const INBOX_COOKIE = 'crm_inbox_token'
const INBOX_AGENT_COOKIE = 'crm_inbox_agent'
const isProduction = process.env.NODE_ENV === 'production'

function decodeAgent(token: string): { agentId?: string; workspaceId?: string } | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

function inboxToken(): string | undefined {
  return getCookie(INBOX_COOKIE) ?? undefined
}

export type InboxAgentRole = 'superadmin' | 'admin' | 'agent'

export type InboxAgentInfo = { id: string; name: string; role: InboxAgentRole }

const agentCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
  maxAge: 60 * 60 * 24,
} as const

export const inboxLogin = createServerFn()
  .validator((data: { slug: string; email: string; password: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; agent: InboxAgentInfo | null; message: string | null }> => {
    const res = await apiClient().inbox.auth.login.post({
      email: data.email,
      password: data.password,
      workspaceSlug: data.slug,
    })
    const body = res.data as { ok?: boolean; agent?: InboxAgentInfo; token?: string; message?: string } | null
    if (!body?.ok || !body.token) {
      return { ok: false, agent: null, message: body?.message ?? 'Email ou senha inválidos.' }
    }
    setCookie(INBOX_COOKIE, body.token, agentCookieOptions)
    if (body.agent) {
      setCookie(INBOX_AGENT_COOKIE, JSON.stringify(body.agent), agentCookieOptions)
    }
    return { ok: true, agent: body.agent ?? null, message: null }
  })

export const inboxActivate = createServerFn()
  .validator((data: { slug: string; token: string; password: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; message: string | null }> => {
    const res = await apiClient().inbox.auth.activate.post({
      token: data.token,
      password: data.password,
      workspaceSlug: data.slug,
    })
    const body = res.data as { ok?: boolean; message?: string } | null
    return { ok: body?.ok ?? false, message: body?.message ?? null }
  })

// Retorna o agentId da sessão atual (ou null). Usado como guarda.
export const getInboxAgentId = createServerFn().handler(async (): Promise<string | null> => {
  const token = inboxToken()
  if (!token) return null
  return decodeAgent(token)?.agentId ?? null
})

// Perfil do agente logado (nome + role). Busca fresco na API (GET /inbox/me —
// a role vem do banco, então promoções/rebaixamentos valem na hora) e atualiza
// o cookie local; se a chamada falhar, cai no cookie gravado no login.
export const getInboxAgent = createServerFn().handler(async (): Promise<InboxAgentInfo | null> => {
  const token = inboxToken()
  if (token) {
    const res = await apiClient(token).inbox.me.get().catch(() => null)
    const me = res?.data as InboxAgentInfo | null
    if (me?.id && me?.role) {
      setCookie(INBOX_AGENT_COOKIE, JSON.stringify({ id: me.id, name: me.name, role: me.role }), agentCookieOptions)
      return { id: me.id, name: me.name, role: me.role }
    }
  }
  const raw = getCookie(INBOX_AGENT_COOKIE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as InboxAgentInfo
    if (!parsed?.id || !parsed?.role) return null
    return parsed
  } catch {
    return null
  }
})

// Expõe o token para uso do WebSocket no cliente (é o token do próprio agente).
export const getInboxToken = createServerFn().handler(async (): Promise<string | null> => {
  return inboxToken() ?? null
})

export const inboxLogout = createServerFn().handler(async (): Promise<{ ok: boolean }> => {
  deleteCookie(INBOX_COOKIE, { path: '/' })
  deleteCookie(INBOX_AGENT_COOKIE, { path: '/' })
  return { ok: true }
})

// ─── Conversas ───────────────────────────────────────────────────────────────

export type ConversationStatus = 'open' | 'assigned' | 'pending' | 'resolved'

// 'active' = open + assigned (abas "Abertos" da lista): a API aceita um único
// status por chamada, então a server fn faz as duas e intercala os resultados.
export type ConversationStatusFilter = ConversationStatus | 'active'

export type ConversationLastMessage = {
  // Conteúdo já vem truncado em ~80 chars pela API.
  content: string
  kind: 'text' | 'image' | 'audio' | 'video' | 'document'
  direction: 'inbound' | 'outbound'
  sentAt: string
}

export type ConversationListItem = {
  id: string
  protocol: number
  status: ConversationStatus
  // Título manual (renomear conversa); null = exibe o nome do contato.
  title: string | null
  assignedAgentId: string | null
  queueId: string | null
  queueName: string | null
  // Bot atendendo a conversa agora (badge "Chatbot atendendo" na lista).
  activeBotFlowId: string | null
  activeBotFlowName: string | null
  labels: string[]
  updatedAt: string
  contactId: string
  contactName: string
  // Null quando o contato ainda não tem identity primária (legado/sem canal).
  originChannel: 'whatsapp' | 'telegram' | null
  lastMessage: ConversationLastMessage | null
  unreadCount: number
}

export const fetchConversations = createServerFn()
  .validator(
    (data: { filter?: 'mine' | 'unassigned' | 'all'; status?: ConversationStatusFilter; queue?: string }) => data,
  )
  .handler(async ({ data }): Promise<ConversationListItem[]> => {
    const client = apiClient(inboxToken())
    const fetchPage = async (status?: ConversationStatus): Promise<ConversationListItem[]> => {
      const res = await client.inbox.conversations.get({
        query: { filter: data.filter, status, queue: data.queue },
      })
      return ((res.data as { conversations?: ConversationListItem[] })?.conversations ?? []) as ConversationListItem[]
    }
    if (data.status === 'active') {
      const [open, assigned] = await Promise.all([fetchPage('open'), fetchPage('assigned')])
      return [...open, ...assigned]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 100)
    }
    return fetchPage(data.status)
  })

export type MessageAttachmentItem = {
  storageKey: string
  mimeType: string
  kind: 'image' | 'video' | 'audio' | 'document'
  filename: string
}

export type MessageItem = {
  id: string
  direction: 'inbound' | 'outbound'
  content: string
  kind: string
  status: string
  sentAt: string
  attachments?: MessageAttachmentItem[]
}

export type ConversationTransferItem = {
  id: string
  note: string | null
  createdAt: string
  fromAgentId: string | null
  fromAgentName: string | null
  fromQueueId: string | null
  fromQueueName: string | null
  toAgentId: string | null
  toAgentName: string | null
  toQueueId: string | null
  toQueueName: string | null
  transferredByAgentId: string
  transferredByAgentName: string | null
}

export const fetchConversation = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .get()
    const body = res.data as {
      conversation?: { id: string; status: string; contactId: string; title: string | null }
      contact?: { name: string; avatarUrl: string | null }
      messages?: MessageItem[]
      notes?: { id: string; content: string; createdAt: string }[]
      transfers?: ConversationTransferItem[]
      activeBotFlow?: { id: string; name: string } | null
    } | null
    return {
      conversation: body?.conversation ?? null,
      contact: body?.contact ?? null,
      messages: (body?.messages ?? []) as MessageItem[],
      notes: body?.notes ?? [],
      transfers: (body?.transfers ?? []) as ConversationTransferItem[],
      activeBotFlow: body?.activeBotFlow ?? null,
    }
  })

export const sendMessage = createServerFn()
  .validator((data: { conversationId: string; content: string; attachmentFileIds?: string[] }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .messages.post({ content: data.content, attachmentFileIds: data.attachmentFileIds })
    return { ok: true }
  })

export const assignToMe = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .assign.post({})
    return { ok: !res.error }
  })

export const resolveConversation = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .resolve.post()
    return { ok: !res.error }
  })

// Transfere a conversa para outro agente OU outra fila (exatamente um destino).
export const transferConversation = createServerFn()
  .validator((data: { conversationId: string; toAgentId?: string; toQueueId?: string; note?: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .transfer.post({ toAgentId: data.toAgentId, toQueueId: data.toQueueId, note: data.note })
    return { ok: true }
  })

// Histórico de transferências da conversa (com nomes de agentes/filas).
export const fetchConversationTransfers = createServerFn()
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ data }): Promise<ConversationTransferItem[]> => {
    const res = await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .get()
    return ((res.data as { transfers?: ConversationTransferItem[] })?.transfers ?? []) as ConversationTransferItem[]
  })

// Renomeia a conversa (null volta a exibir o nome do contato).
export const renameConversation = createServerFn()
  .validator((data: { conversationId: string; title: string | null }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .title.patch({ title: data.title })
    return { ok: true }
  })

// ─── Admin: agentes (superadmin) ─────────────────────────────────────────────

export type AdminAgentItem = {
  id: string
  name: string
  email: string
  role: InboxAgentRole
  activatedAt: string | null
  lastLoginAt: string | null
  createdAt: string
}

export const fetchAgentsAdmin = createServerFn().handler(async (): Promise<AdminAgentItem[]> => {
  const res = await apiClient(inboxToken()).inbox.admin.agents.get()
  return ((res.data as { agents?: AdminAgentItem[] })?.agents ?? []) as AdminAgentItem[]
})

export const updateAgentRole = createServerFn()
  .validator((data: { agentId: string; role: InboxAgentRole }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.agents({ id: data.agentId }).role.patch({ role: data.role })
    return { ok: true }
  })

export const resendAgentActivationInbox = createServerFn()
  .validator((data: { agentId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.agents({ id: data.agentId })['resend-activation'].post()
    return { ok: true }
  })

// ─── Admin: conexões (superadmin) ────────────────────────────────────────────

export type AdminConnectionItem = {
  id: string
  name: string
  kind: 'whatsapp' | 'telegram'
  status: 'active' | 'error' | 'disconnected'
  defaultQueueId: string | null
  // Mensagem de boas-vindas enviada em conversa nova quando nenhum bot atende
  // primeiro (contrato do backend em implementação paralela).
  welcomeMessage: string | null
  createdAt: string
}

export const fetchConnectionsAdmin = createServerFn().handler(async (): Promise<AdminConnectionItem[]> => {
  const res = await apiClient(inboxToken()).inbox.admin.connections.get()
  return ((res.data as { connections?: AdminConnectionItem[] })?.connections ?? []) as AdminConnectionItem[]
})

export const createConnectionInbox = createServerFn()
  .validator((data: { name: string; kind: 'whatsapp' | 'telegram'; token?: string; defaultQueueId?: string }) => data)
  .handler(async ({ data }): Promise<AdminConnectionItem | null> => {
    const res = await apiClient(inboxToken()).inbox.admin.connections.post({
      name: data.name,
      kind: data.kind,
      token: data.token,
      defaultQueueId: data.defaultQueueId,
    })
    return ((res.data as { connection?: AdminConnectionItem })?.connection ?? null) as AdminConnectionItem | null
  })

export const deleteConnectionInbox = createServerFn()
  .validator((data: { connectionId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.connections({ id: data.connectionId }).delete()
    return { ok: true }
  })

export const reconnectConnectionInbox = createServerFn()
  .validator((data: { connectionId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.connections({ id: data.connectionId }).reconnect.post()
    return { ok: true }
  })

// PATCH /inbox/admin/connections/:id — por ora só a mensagem de boas-vindas.
// A resposta traz a linha atualizada (sem createdAt) — a tela mescla localmente.
export const updateConnectionInbox = createServerFn()
  .validator((data: { connectionId: string; welcomeMessage: string | null }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; welcomeMessage: string | null }> => {
    const res = await apiClient(inboxToken())
      .inbox.admin.connections({ id: data.connectionId })
      .patch({ welcomeMessage: data.welcomeMessage })
    const connection = (res.data as { connection?: { welcomeMessage: string | null } } | null)?.connection
    if (res.error || !connection) return { ok: false, welcomeMessage: null }
    return { ok: true, welcomeMessage: connection.welcomeMessage }
  })

export type ConnectionStatus = {
  connectionId: string
  socketStatus?: string
  qr?: string | null
}

export const fetchConnectionStatus = createServerFn()
  .validator((data: { connectionId: string }) => data)
  .handler(async ({ data }): Promise<ConnectionStatus> => {
    const res = await apiClient(inboxToken()).inbox.admin.connections({ id: data.connectionId }).status.get()
    return (res.data ?? { connectionId: data.connectionId }) as ConnectionStatus
  })

// ─── Admin: filas (superadmin) ───────────────────────────────────────────────

export type QueueMemberItem = { queueId: string; agentId: string; agentName: string }

export type QueueItem = {
  id: string
  workspaceId: string
  name: string
  color: string
  description: string | null
  createdAt: string
  members: QueueMemberItem[]
}

export const fetchQueues = createServerFn().handler(async (): Promise<QueueItem[]> => {
  const res = await apiClient(inboxToken()).inbox.admin.queues.get()
  return ((res.data as { queues?: QueueItem[] })?.queues ?? []) as QueueItem[]
})

export const createQueue = createServerFn()
  .validator((data: { name: string; color: string; description?: string }) => data)
  .handler(async ({ data }): Promise<QueueItem | null> => {
    const res = await apiClient(inboxToken()).inbox.admin.queues.post({
      name: data.name,
      color: data.color,
      description: data.description,
    })
    return ((res.data as { queue?: QueueItem })?.queue ?? null) as QueueItem | null
  })

export const updateQueue = createServerFn()
  .validator((data: { queueId: string; name?: string; color?: string; description?: string }) => data)
  .handler(async ({ data }): Promise<QueueItem | null> => {
    const { queueId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.admin.queues({ id: queueId }).patch(body)
    return ((res.data as { queue?: QueueItem })?.queue ?? null) as QueueItem | null
  })

export const deleteQueue = createServerFn()
  .validator((data: { queueId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.queues({ id: data.queueId }).delete()
    return { ok: true }
  })

export const setQueueMembers = createServerFn()
  .validator((data: { queueId: string; agentIds: string[] }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.queues({ id: data.queueId }).members.put({ agentIds: data.agentIds })
    return { ok: true }
  })

// ─── Admin: equipes (superadmin) ─────────────────────────────────────────────

export type TeamMemberItem = { teamId: string; agentId: string; agentName: string }
export type TeamQueueItem = { id: string; name: string }

// Linha crua da tabela teams (é o que o PATCH retorna).
export type TeamRow = {
  id: string
  workspaceId: string
  name: string
  color: string
  description: string | null
  createdAt: string
}

// Listagem/criação trazem membros e filas vinculadas junto.
export type TeamItem = TeamRow & {
  members: TeamMemberItem[]
  queues: TeamQueueItem[]
}

export const fetchTeams = createServerFn().handler(async (): Promise<TeamItem[]> => {
  const res = await apiClient(inboxToken()).inbox.admin.teams.get()
  return ((res.data as { teams?: TeamItem[] })?.teams ?? []) as TeamItem[]
})

export const createTeam = createServerFn()
  .validator((data: { name: string; color: string; description?: string }) => data)
  .handler(async ({ data }): Promise<TeamItem | null> => {
    const res = await apiClient(inboxToken()).inbox.admin.teams.post({
      name: data.name,
      color: data.color,
      description: data.description,
    })
    return ((res.data as { team?: TeamItem })?.team ?? null) as TeamItem | null
  })

// PATCH retorna só a linha da equipe (sem members/queues).
export const updateTeam = createServerFn()
  .validator((data: { teamId: string; name?: string; color?: string; description?: string }) => data)
  .handler(async ({ data }): Promise<TeamRow | null> => {
    const { teamId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.admin.teams({ id: teamId }).patch(body)
    return ((res.data as { team?: TeamRow })?.team ?? null) as TeamRow | null
  })

export const deleteTeam = createServerFn()
  .validator((data: { teamId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.teams({ id: data.teamId }).delete()
    return { ok: true }
  })

// Substitui os membros da equipe (só agentes do próprio workspace são aceitos).
export const setTeamMembers = createServerFn()
  .validator((data: { teamId: string; agentIds: string[] }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.teams({ id: data.teamId }).members.put({ agentIds: data.agentIds })
    return { ok: true }
  })

// Atribui (ou remove, com null) a equipe responsável pela fila.
export const assignQueueTeam = createServerFn()
  .validator((data: { queueId: string; teamId: string | null }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.admin.queues({ id: data.queueId }).team.patch({ teamId: data.teamId })
    return { ok: true }
  })

// ─── Admin: configurações do workspace (horários de atendimento) ─────────────

export type BusinessHoursEntry = { day: number; start: string; end: string }
export type OutOfHoursMode = 'none' | 'auto_reply' | 'bot' | 'both'

export type InboxAdminSettings = {
  // Null = sem restrição (atendimento 24h).
  businessHours: BusinessHoursEntry[] | null
  outOfHoursMode: OutOfHoursMode
  outOfHoursMessage: string | null
  outOfHoursBotFlowId: string | null
  // Pesquisa de satisfação (CSAT) enviada ao resolver a conversa.
  // Mensagens null = textos padrão.
  csatEnabled: boolean
  csatMessage: string | null
  csatThankYouMessage: string | null
}

export const fetchAdminSettings = createServerFn().handler(async (): Promise<InboxAdminSettings> => {
  const res = await apiClient(inboxToken()).inbox.admin.settings.get()
  return res.data as InboxAdminSettings
})

// Atualização parcial: só os campos enviados são alterados.
export const updateAdminSettings = createServerFn()
  .validator(
    (data: {
      businessHours?: BusinessHoursEntry[] | null
      outOfHoursMode?: OutOfHoursMode
      outOfHoursMessage?: string | null
      outOfHoursBotFlowId?: string | null
      csatEnabled?: boolean
      csatMessage?: string | null
      csatThankYouMessage?: string | null
    }) => data,
  )
  .handler(async ({ data }): Promise<InboxAdminSettings> => {
    const res = await apiClient(inboxToken()).inbox.admin.settings.patch(data)
    return res.data as InboxAdminSettings
  })

// ─── Admin: permissões de agente (superadmin) ────────────────────────────────

export type AgentPermissionKey = 'conversations_assign' | 'labels' | 'quick_replies_manage' | 'reports'
export type AgentPermissionMap = Partial<Record<AgentPermissionKey, boolean>>

export type AgentPermissionsState = {
  overrides: { admin?: AgentPermissionMap; agent?: AgentPermissionMap }
  effective: { admin: Record<AgentPermissionKey, boolean>; agent: Record<AgentPermissionKey, boolean> }
}

export const fetchAgentPermissions = createServerFn().handler(async (): Promise<AgentPermissionsState> => {
  const res = await apiClient(inboxToken()).inbox.admin['agent-permissions'].get()
  return res.data as AgentPermissionsState
})

export const updateAgentPermissions = createServerFn()
  .validator((data: { admin?: AgentPermissionMap; agent?: AgentPermissionMap }) => data)
  .handler(async ({ data }): Promise<AgentPermissionsState> => {
    const res = await apiClient(inboxToken())
      .inbox.admin['agent-permissions'].patch({ admin: data.admin, agent: data.agent })
    return res.data as AgentPermissionsState
  })

// ─── Arquivos (biblioteca de mídia) ──────────────────────────────────────────

export type InboxFileItem = {
  id: string
  workspaceId: string
  kind: 'image' | 'video' | 'audio' | 'document'
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  status: 'pending' | 'ready'
  uploadedByAgentId: string | null
  createdAt: string
}

export type PresignResult = {
  fileId: string
  kind: 'image' | 'video' | 'audio' | 'document'
  storageKey: string
  uploadUrl: string
}

export const presignFile = createServerFn()
  .validator((data: { filename: string; mimeType: string; sizeBytes: number }) => data)
  .handler(async ({ data }): Promise<PresignResult | null> => {
    const res = await apiClient(inboxToken()).inbox.files.presign.post({
      filename: data.filename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
    })
    return (res.data ?? null) as PresignResult | null
  })

export const confirmFile = createServerFn()
  .validator((data: { fileId: string }) => data)
  .handler(async ({ data }): Promise<InboxFileItem | null> => {
    const res = await apiClient(inboxToken()).inbox.files({ id: data.fileId }).confirm.post()
    return ((res.data as { file?: InboxFileItem })?.file ?? null) as InboxFileItem | null
  })

export const fetchFiles = createServerFn()
  .validator((data: { kind?: 'image' | 'video' | 'audio' | 'document'; search?: string }) => data)
  .handler(async ({ data }): Promise<InboxFileItem[]> => {
    const res = await apiClient(inboxToken()).inbox.files.get({
      query: { kind: data.kind, search: data.search },
    })
    return ((res.data as { files?: InboxFileItem[] })?.files ?? []) as InboxFileItem[]
  })

export const fetchFileUrl = createServerFn()
  .validator((data: { fileId: string }) => data)
  .handler(async ({ data }): Promise<{ url: string; mimeType: string; kind: string } | null> => {
    const res = await apiClient(inboxToken()).inbox.files({ id: data.fileId }).url.get()
    return (res.data ?? null) as { url: string; mimeType: string; kind: string } | null
  })

export const deleteFile = createServerFn()
  .validator((data: { fileId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.files({ id: data.fileId }).delete()
    return { ok: true }
  })

// ─── Contatos ────────────────────────────────────────────────────────────────

export type ContactListItem = {
  id: string
  name: string
  email: string | null
  company: string | null
  avatarUrl: string | null
  tags: string[]
  createdAt: string
  primaryChannelType: 'whatsapp' | 'telegram' | null
  primaryChannelIdentifier: string | null
}

export type ContactDetail = {
  id: string
  workspaceId: string
  name: string
  email: string | null
  company: string | null
  birthDate: string | null
  avatarUrl: string | null
  customFields: Record<string, JsonValue>
  tags: string[]
  notes: string | null
  firstContactAt: string
  createdAt: string
  updatedAt: string
}

export type ContactIdentityItem = {
  id: string
  workspaceId: string
  contactId: string
  channelType: 'whatsapp' | 'telegram'
  channelIdentifier: string
  isPrimary: boolean
  metadata: Record<string, JsonValue>
  createdAt: string
  updatedAt: string
}

export type ContactDealItem = {
  id: string
  title: string
  status: 'open' | 'won' | 'lost'
  valueCents: number
  currency: string
  closedAt: string | null
  createdAt: string
  pipelineId: string
  pipelineName: string
  stageId: string
  stageName: string
  stageKind: 'open' | 'won' | 'lost'
}

export type ContactTransferItem = {
  id: string
  fromAgent: { id: string; name: string | null } | null
  toAgent: { id: string; name: string | null } | null
  fromQueue: { id: string; name: string | null } | null
  toQueue: { id: string; name: string | null } | null
  note: string | null
  transferredBy: { id: string; name: string | null }
  createdAt: string
}

export type ContactHistoryEntry = {
  id: string
  status: string
  createdAt: string
  resolvedAt: string | null
  connection: { kind: string; name: string }
  assignedAgent: { id: string; name: string | null } | null
  queue: { id: string; name: string | null } | null
  messageCount: number
  transfers: ContactTransferItem[]
}

export type ContactIdentityInput = {
  channelType: 'whatsapp' | 'telegram'
  channelIdentifier: string
  isPrimary?: boolean
}

export const fetchContacts = createServerFn()
  .validator((data: { search?: string; tag?: string; channel?: 'whatsapp' | 'telegram' }) => data)
  .handler(async ({ data }): Promise<ContactListItem[]> => {
    const res = await apiClient(inboxToken()).inbox.contacts.get({
      query: { search: data.search, tag: data.tag, channel: data.channel },
    })
    return ((res.data as { contacts?: ContactListItem[] })?.contacts ?? []) as ContactListItem[]
  })

export const fetchContact = createServerFn()
  .validator((data: { contactId: string }) => data)
  .handler(async ({ data }) => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).get()
    const body = res.data as {
      contact?: ContactDetail
      identities?: ContactIdentityItem[]
      deals?: ContactDealItem[]
      counts?: { conversations: number; deals: number }
    } | null
    return {
      contact: body?.contact ?? null,
      identities: (body?.identities ?? []) as ContactIdentityItem[],
      deals: (body?.deals ?? []) as ContactDealItem[],
      counts: body?.counts ?? { conversations: 0, deals: 0 },
    }
  })

export const createContact = createServerFn()
  .validator(
    (data: {
      name: string
      email?: string
      company?: string
      identities: ContactIdentityInput[]
      tags?: string[]
    }) => data,
  )
  .handler(async ({ data }) => {
    const res = await apiClient(inboxToken()).inbox.contacts.post({
      name: data.name,
      email: data.email,
      company: data.company,
      identities: data.identities,
      tags: data.tags,
    })
    const body = res.data as { contact?: ContactDetail; identities?: ContactIdentityItem[] } | null
    return { contact: body?.contact ?? null, identities: (body?.identities ?? []) as ContactIdentityItem[] }
  })

export const updateContact = createServerFn()
  .validator(
    (data: {
      contactId: string
      name?: string
      email?: string | null
      company?: string | null
      birthDate?: string | null
      avatarUrl?: string | null
      notes?: string | null
      tags?: string[]
      customFields?: Record<string, JsonValue>
    }) => data,
  )
  .handler(async ({ data }): Promise<ContactDetail | null> => {
    const { contactId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.contacts({ id: contactId }).patch(body)
    return ((res.data as { contact?: ContactDetail })?.contact ?? null) as ContactDetail | null
  })

export const addContactIdentity = createServerFn()
  .validator((data: { contactId: string } & ContactIdentityInput) => data)
  .handler(async ({ data }): Promise<ContactIdentityItem | null> => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).identities.post({
      channelType: data.channelType,
      channelIdentifier: data.channelIdentifier,
      isPrimary: data.isPrimary,
    })
    return ((res.data as { identity?: ContactIdentityItem })?.identity ?? null) as ContactIdentityItem | null
  })

export const removeContactIdentity = createServerFn()
  .validator((data: { contactId: string; identityId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).identities({ identityId: data.identityId }).delete()
    return { ok: true }
  })

export const mergeContacts = createServerFn()
  .validator((data: { contactId: string; otherContactId: string }) => data)
  .handler(async ({ data }) => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).merge.post({
      otherContactId: data.otherContactId,
    })
    const body = res.data as {
      contact?: ContactDetail
      movedIdentities?: number
      skippedIdentities?: number
    } | null
    return {
      contact: body?.contact ?? null,
      movedIdentities: body?.movedIdentities ?? 0,
      skippedIdentities: body?.skippedIdentities ?? 0,
    }
  })

export const fetchContactHistory = createServerFn()
  .validator((data: { contactId: string }) => data)
  .handler(async ({ data }): Promise<ContactHistoryEntry[]> => {
    const res = await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).history.get()
    return ((res.data as { history?: ContactHistoryEntry[] })?.history ?? []) as ContactHistoryEntry[]
  })

// ─── Contatos: exportação/importação CSV ─────────────────────────────────────

// A rota de exportação responde text/csv — o Eden entrega o corpo como string
// (já com BOM e separador ';', convenção do Excel pt-BR).
export const exportContactsCsv = createServerFn()
  .validator((data: { search?: string; tag?: string; channel?: 'whatsapp' | 'telegram' }) => data)
  .handler(async ({ data }): Promise<string | null> => {
    const res = await apiClient(inboxToken()).inbox['contacts-export'].get({
      query: { search: data.search, tag: data.tag, channel: data.channel },
    })
    return typeof res.data === 'string' ? res.data : null
  })

export type ContactImportRow = {
  name: string
  email?: string
  company?: string
  whatsapp?: string
  telegram?: string
  // Nomes de tags separados por ';'.
  tags?: string
}

export type ContactImportResult = {
  created: number
  updated: number
  skipped: number
  errors: { row: number; reason: string }[]
}

// mode 'skip' pula contatos já cadastrados (dedupe por canal+identificador);
// 'update' atualiza dados e acrescenta tags/identities novas.
export const importContacts = createServerFn()
  .validator((data: { rows: ContactImportRow[]; mode: 'skip' | 'update' }) => data)
  .handler(async ({ data }): Promise<ContactImportResult> => {
    const res = await apiClient(inboxToken()).inbox['contacts-import'].post({ rows: data.rows, mode: data.mode })
    return res.data as ContactImportResult
  })

// ─── Tags ────────────────────────────────────────────────────────────────────

// Linha crua da tabela tags (é o que o PATCH retorna).
export type TagRow = {
  id: string
  workspaceId: string
  name: string
  color: string
  createdAt: string
}

// Listagem/criação trazem a contagem de vínculos junto.
export type TagItem = TagRow & {
  contactCount: number
  conversationCount: number
}

export const fetchTags = createServerFn().handler(async (): Promise<TagItem[]> => {
  const res = await apiClient(inboxToken()).inbox.tags.get()
  return ((res.data as { tags?: TagItem[] })?.tags ?? []) as TagItem[]
})

export const createTag = createServerFn()
  .validator((data: { name: string; color: string }) => data)
  .handler(async ({ data }): Promise<TagItem | null> => {
    const res = await apiClient(inboxToken()).inbox.tags.post({ name: data.name, color: data.color })
    return ((res.data as { tag?: TagItem })?.tag ?? null) as TagItem | null
  })

// PATCH retorna só a linha da tag (sem contagens).
export const updateTag = createServerFn()
  .validator((data: { tagId: string; name?: string; color?: string }) => data)
  .handler(async ({ data }): Promise<TagRow | null> => {
    const { tagId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.tags({ id: tagId }).patch(body)
    return ((res.data as { tag?: TagRow })?.tag ?? null) as TagRow | null
  })

export const deleteTag = createServerFn()
  .validator((data: { tagId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.tags({ id: data.tagId }).delete()
    return { ok: true }
  })

// Substitui as tags do contato (qualquer agente pode vincular/desvincular).
export const setContactTags = createServerFn()
  .validator((data: { contactId: string; tagIds: string[] }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.contacts({ id: data.contactId }).tags.put({ tagIds: data.tagIds })
    return { ok: true }
  })

// Substitui as tags da conversa.
export const setConversationTags = createServerFn()
  .validator((data: { conversationId: string; tagIds: string[] }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken())
      .inbox.conversations({ id: data.conversationId })
      .tags.put({ tagIds: data.tagIds })
    return { ok: true }
  })

// ─── Funis (pipelines, estágios e deals) ─────────────────────────────────────

export type PipelineStageItem = {
  id: string
  pipelineId: string
  name: string
  color: string
  position: number
  kind: 'open' | 'won' | 'lost'
}

export type PipelineRow = {
  id: string
  workspaceId: string
  name: string
  position: number
  createdAt: string
}

export type PipelineItem = PipelineRow & {
  stages: (PipelineStageItem & { openDeals: number })[]
}

export type DealItem = {
  id: string
  workspaceId: string
  pipelineId: string
  stageId: string
  contactId: string
  conversationId: string | null
  title: string
  valueCents: number
  currency: string
  assignedAgentId: string | null
  queueId: string | null
  status: 'open' | 'won' | 'lost'
  lostReason: string | null
  position: number
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export type KanbanDealItem = DealItem & {
  contactName: string
  agentName: string | null
  queueName: string | null
}

export const fetchPipelines = createServerFn().handler(async (): Promise<PipelineItem[]> => {
  const res = await apiClient(inboxToken()).inbox.pipelines.get()
  return ((res.data as { pipelines?: PipelineItem[] })?.pipelines ?? []) as PipelineItem[]
})

export const createPipeline = createServerFn()
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<PipelineRow | null> => {
    const res = await apiClient(inboxToken()).inbox.pipelines.post({ name: data.name })
    return ((res.data as { pipeline?: PipelineRow })?.pipeline ?? null) as PipelineRow | null
  })

export const updatePipeline = createServerFn()
  .validator((data: { pipelineId: string; name?: string }) => data)
  .handler(async ({ data }): Promise<PipelineRow | null> => {
    const res = await apiClient(inboxToken()).inbox.pipelines({ id: data.pipelineId }).patch({ name: data.name })
    return ((res.data as { pipeline?: PipelineRow })?.pipeline ?? null) as PipelineRow | null
  })

export const deletePipeline = createServerFn()
  .validator((data: { pipelineId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.pipelines({ id: data.pipelineId }).delete()
    return { ok: true }
  })

export const createStage = createServerFn()
  .validator((data: { pipelineId: string; name: string; color: string; kind?: 'open' | 'won' | 'lost' }) => data)
  .handler(async ({ data }): Promise<PipelineStageItem | null> => {
    const res = await apiClient(inboxToken()).inbox.pipelines({ id: data.pipelineId }).stages.post({
      name: data.name,
      color: data.color,
      kind: data.kind,
    })
    return ((res.data as { stage?: PipelineStageItem })?.stage ?? null) as PipelineStageItem | null
  })

export const updateStage = createServerFn()
  .validator((data: { stageId: string; name?: string; color?: string; kind?: 'open' | 'won' | 'lost' }) => data)
  .handler(async ({ data }): Promise<PipelineStageItem | null> => {
    const { stageId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.stages({ id: stageId }).patch(body)
    return ((res.data as { stage?: PipelineStageItem })?.stage ?? null) as PipelineStageItem | null
  })

export const deleteStage = createServerFn()
  .validator((data: { stageId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.stages({ id: data.stageId }).delete()
    return { ok: true }
  })

export const moveStage = createServerFn()
  .validator((data: { stageId: string; direction: 'up' | 'down' }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.stages({ id: data.stageId }).move.post({ direction: data.direction })
    return { ok: true }
  })

export const fetchPipelineDeals = createServerFn()
  .validator((data: { pipelineId: string }) => data)
  .handler(async ({ data }) => {
    const res = await apiClient(inboxToken()).inbox.pipelines({ id: data.pipelineId }).deals.get()
    const body = res.data as {
      pipeline?: PipelineRow
      stages?: (PipelineStageItem & { deals: KanbanDealItem[] })[]
    } | null
    return {
      pipeline: body?.pipeline ?? null,
      stages: (body?.stages ?? []) as (PipelineStageItem & { deals: KanbanDealItem[] })[],
    }
  })

export const createDeal = createServerFn()
  .validator(
    (data: {
      pipelineId: string
      title: string
      contactId: string
      stageId?: string
      valueCents?: number
      assignedAgentId?: string
      queueId?: string
      conversationId?: string
    }) => data,
  )
  .handler(async ({ data }): Promise<DealItem | null> => {
    const { pipelineId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.pipelines({ id: pipelineId }).deals.post(body)
    return ((res.data as { deal?: DealItem })?.deal ?? null) as DealItem | null
  })

export const updateDeal = createServerFn()
  .validator(
    (data: {
      dealId: string
      title?: string
      valueCents?: number
      assignedAgentId?: string | null
      queueId?: string | null
      conversationId?: string | null
      lostReason?: string | null
    }) => data,
  )
  .handler(async ({ data }): Promise<DealItem | null> => {
    const { dealId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.deals({ id: dealId }).patch(body)
    return ((res.data as { deal?: DealItem })?.deal ?? null) as DealItem | null
  })

export const moveDeal = createServerFn()
  .validator((data: { dealId: string; stageId: string; position: number }) => data)
  .handler(async ({ data }): Promise<DealItem | null> => {
    const res = await apiClient(inboxToken()).inbox.deals({ id: data.dealId }).move.post({
      stageId: data.stageId,
      position: data.position,
    })
    return ((res.data as { deal?: DealItem })?.deal ?? null) as DealItem | null
  })

export const deleteDeal = createServerFn()
  .validator((data: { dealId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.deals({ id: data.dealId }).delete()
    return { ok: true }
  })

// ─── Bots (fluxos de chatbot) ────────────────────────────────────────────────

export type BotTriggerKind = 'new_conversation' | 'keyword' | 'always'
export type BotStatus = 'draft' | 'active' | 'paused'

export type BotListItem = {
  id: string
  name: string
  status: BotStatus
  triggerKind: BotTriggerKind
  triggerKeywords: string[]
  createdAt: string
  updatedAt: string
}

export type BotDetail = BotListItem & {
  workspaceId: string
  definition: BotFlowDefinition
  createdByAgentId: string
}

export const fetchBots = createServerFn().handler(async (): Promise<BotListItem[]> => {
  const res = await apiClient(inboxToken()).inbox.bots.get()
  return ((res.data as { bots?: BotListItem[] })?.bots ?? []) as BotListItem[]
})

export const fetchBot = createServerFn()
  .validator((data: { botId: string }) => data)
  .handler(async ({ data }): Promise<BotDetail | null> => {
    const res = await apiClient(inboxToken()).inbox.bots({ id: data.botId }).get()
    return ((res.data as { bot?: BotDetail })?.bot ?? null) as BotDetail | null
  })

export const createBot = createServerFn()
  .validator(
    (data: {
      name: string
      triggerKind: BotTriggerKind
      triggerKeywords?: string[]
      definition: BotFlowDefinition
    }) => data,
  )
  .handler(async ({ data }): Promise<BotDetail | null> => {
    const res = await apiClient(inboxToken()).inbox.bots.post({
      name: data.name,
      triggerKind: data.triggerKind,
      triggerKeywords: data.triggerKeywords,
      definition: data.definition,
    })
    return ((res.data as { bot?: BotDetail })?.bot ?? null) as BotDetail | null
  })

export const updateBot = createServerFn()
  .validator(
    (data: {
      botId: string
      name?: string
      triggerKind?: BotTriggerKind
      triggerKeywords?: string[]
      definition?: BotFlowDefinition
    }) => data,
  )
  .handler(async ({ data }): Promise<BotDetail | null> => {
    const { botId, ...body } = data
    const res = await apiClient(inboxToken()).inbox.bots({ id: botId }).patch(body)
    return ((res.data as { bot?: BotDetail })?.bot ?? null) as BotDetail | null
  })

export const deleteBot = createServerFn()
  .validator((data: { botId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.bots({ id: data.botId }).delete()
    return { ok: true }
  })

export const publishBot = createServerFn()
  .validator((data: { botId: string }) => data)
  .handler(async ({ data }): Promise<BotDetail | null> => {
    const res = await apiClient(inboxToken()).inbox.bots({ id: data.botId }).publish.post()
    return ((res.data as { bot?: BotDetail })?.bot ?? null) as BotDetail | null
  })

export const pauseBot = createServerFn()
  .validator((data: { botId: string }) => data)
  .handler(async ({ data }): Promise<BotDetail | null> => {
    const res = await apiClient(inboxToken()).inbox.bots({ id: data.botId }).pause.post()
    return ((res.data as { bot?: BotDetail })?.bot ?? null) as BotDetail | null
  })

// ─── Bots: estatísticas ──────────────────────────────────────────────────────

export type BotStatsStatus = 'running' | 'completed' | 'handed_off' | 'failed' | 'cancelled'

export type BotStats = {
  total: number
  byStatus: Record<BotStatsStatus, number>
  // Razão completed/total no período (0-1).
  completionRate: number
  perDay: { date: string; started: number; completed: number; failed: number }[]
}

// GET /inbox/bots/:id/stats — estatísticas de sessões do fluxo (superadmin).
export const fetchBotStats = createServerFn()
  .validator((data: { botId: string; days?: number }) => data)
  .handler(async ({ data }): Promise<BotStats | null> => {
    const res = await apiClient(inboxToken())
      .inbox.bots({ id: data.botId })
      .stats.get({ query: { days: data.days !== undefined ? String(data.days) : undefined } })
      .catch(() => null)
    return ((res?.data ?? null) as BotStats | null) ?? null
  })

// ─── Respostas rápidas ───────────────────────────────────────────────────────

export type QuickReplyItem = {
  id: string
  workspaceId: string
  shortcut: string
  title: string
  content: string
  createdByAgentId: string
  createdAt: string
}

export const fetchQuickReplies = createServerFn()
  .validator((data: { search?: string }) => data)
  .handler(async ({ data }): Promise<QuickReplyItem[]> => {
    const res = await apiClient(inboxToken()).inbox['quick-replies'].get({ query: { search: data.search } })
    return ((res.data as { quickReplies?: QuickReplyItem[] })?.quickReplies ?? []) as QuickReplyItem[]
  })

export const createQuickReply = createServerFn()
  .validator((data: { shortcut: string; title: string; content: string }) => data)
  .handler(async ({ data }): Promise<QuickReplyItem | null> => {
    const res = await apiClient(inboxToken()).inbox['quick-replies'].post({
      shortcut: data.shortcut,
      title: data.title,
      content: data.content,
    })
    return ((res.data as { quickReply?: QuickReplyItem })?.quickReply ?? null) as QuickReplyItem | null
  })

export const updateQuickReply = createServerFn()
  .validator((data: { quickReplyId: string; shortcut?: string; title?: string; content?: string }) => data)
  .handler(async ({ data }): Promise<QuickReplyItem | null> => {
    const { quickReplyId, ...body } = data
    const res = await apiClient(inboxToken()).inbox['quick-replies']({ id: quickReplyId }).patch(body)
    return ((res.data as { quickReply?: QuickReplyItem })?.quickReply ?? null) as QuickReplyItem | null
  })

export const deleteQuickReply = createServerFn()
  .validator((data: { quickReplyId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox['quick-replies']({ id: data.quickReplyId }).delete()
    return { ok: true }
  })

// ─── Relatórios ──────────────────────────────────────────────────────────────

export type ReportsSummary = {
  periodDays: number
  conversationsByStatus: { status: string; count: number }[]
  conversationsByQueue: { queueId: string | null; queueName: string; count: number }[]
  firstResponseByAgent: { agentId: string; agentName: string; avgSeconds: number; conversations: number }[]
  deals: {
    byStatus: { status: string; count: number; valueCents: number }[]
    openValueCents: number
    wonValueCents: number
  }
  messagesByChannel: { channel: string; count: number }[]
  transfersByAgent: { agentId: string; agentName: string; count: number }[]
  csat: {
    // Null quando não há avaliações no período.
    averageScore: number | null
    totalRatings: number
    distribution: { score: number; count: number }[]
    byAgent: { agentId: string | null; agentName: string; averageScore: number; totalRatings: number }[]
  }
}

export const fetchReportsSummary = createServerFn()
  .validator((data: { days?: number }) => data)
  .handler(async ({ data }): Promise<ReportsSummary | null> => {
    const res = await apiClient(inboxToken()).inbox.reports.summary.get({ query: { days: data.days } })
    return (res.data ?? null) as ReportsSummary | null
  })

// ─── Chat interno ────────────────────────────────────────────────────────────

export type InternalChatMessageItem = {
  id: string
  chatId: string
  senderAgentId: string
  content: string
  createdAt: string
}

export type InternalChatRow = {
  id: string
  workspaceId: string
  kind: 'dm' | 'group' | 'queue' | 'team'
  name: string | null
  queueId: string | null
  teamId: string | null
  createdByAgentId: string
  createdAt: string
}

export type InternalChatItem = InternalChatRow & {
  lastMessage: InternalChatMessageItem | null
  unreadCount: number
  members: { agentId: string; name: string }[]
}

export const fetchInternalChats = createServerFn().handler(async (): Promise<InternalChatItem[]> => {
  const res = await apiClient(inboxToken()).inbox.chats.get()
  return ((res.data as { chats?: InternalChatItem[] })?.chats ?? []) as InternalChatItem[]
})

export const createInternalChat = createServerFn()
  .validator((data: { kind: 'dm' | 'group' | 'queue' | 'team'; agentIds?: string[]; queueId?: string; teamId?: string; name?: string }) => data)
  .handler(async ({ data }): Promise<{ chat: InternalChatRow | null; existing: boolean }> => {
    const res = await apiClient(inboxToken()).inbox.chats.post({
      kind: data.kind,
      agentIds: data.agentIds,
      queueId: data.queueId,
      teamId: data.teamId,
      name: data.name,
    })
    const body = res.data as { chat?: InternalChatRow; existing?: boolean } | null
    return { chat: body?.chat ?? null, existing: body?.existing ?? false }
  })

export const fetchInternalChatMessages = createServerFn()
  .validator((data: { chatId: string; before?: string }) => data)
  .handler(async ({ data }): Promise<{ messages: InternalChatMessageItem[]; hasMore: boolean }> => {
    const res = await apiClient(inboxToken()).inbox.chats({ id: data.chatId }).messages.get({
      query: { before: data.before },
    })
    const body = res.data as { messages?: InternalChatMessageItem[]; hasMore?: boolean } | null
    return { messages: (body?.messages ?? []) as InternalChatMessageItem[], hasMore: body?.hasMore ?? false }
  })

export const sendInternalChatMessage = createServerFn()
  .validator((data: { chatId: string; content: string }) => data)
  .handler(async ({ data }): Promise<InternalChatMessageItem | null> => {
    const res = await apiClient(inboxToken()).inbox.chats({ id: data.chatId }).messages.post({ content: data.content })
    return ((res.data as unknown as { message?: InternalChatMessageItem })?.message ?? null) as InternalChatMessageItem | null
  })

export const markInternalChatRead = createServerFn()
  .validator((data: { chatId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await apiClient(inboxToken()).inbox.chats({ id: data.chatId }).read.post()
    return { ok: true }
  })
