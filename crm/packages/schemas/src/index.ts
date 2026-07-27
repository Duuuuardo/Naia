// ─── Gerentes (managers) ─────────────────────────────────────────────────────
// Managers acessam o painel de gestão em crm.naia.website com conta Vianova.
// Diferente dos agents do inbox (auth própria email+senha em slug.crm.*).

export type ManagerRole = 'owner' | 'admin'

// ─── Agentes (inbox) ─────────────────────────────────────────────────────────
// Agents atendem no inbox em slug.crm.* com auth própria. O superadmin é o
// "owner" desse contexto: gerencia agentes, conexões, filas, permissões, bot
// e funis. O auto-agente do owner do workspace nasce superadmin.

export type AgentRole = 'superadmin' | 'admin' | 'agent'

// ─── Permissões por papel ────────────────────────────────────────────────────
// Cada área do painel pode ser liberada ou ocultada por papel. O Owner sempre
// tem tudo; admin segue a matriz do workspace (editável pelo Owner, salva em
// workspaces.rolePermissions) ou os defaults abaixo.
// Conexões NÃO são área de manager: migraram para o contexto do agente
// (superadmin), ver AGENT_PERMISSION_KEYS.

export const PERMISSION_KEYS = [
  'agents',
  'members',
  'billing',
  'settings',
] as const
export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export type RolePermissionMap = Record<PermissionKey, boolean>

// Overrides parciais por papel, persistidos em workspaces.role_permissions.
// Null/ausência de chave = cai no default de DEFAULT_ROLE_PERMISSIONS.
export type WorkspaceRolePermissions = Partial<Record<ManagerRole, Partial<RolePermissionMap>>>

export const OWNER_PERMISSIONS: RolePermissionMap = {
  agents: true,
  members: true,
  billing: true,
  settings: true,
}

export const DEFAULT_ROLE_PERMISSIONS: Record<ManagerRole, RolePermissionMap> = {
  owner: OWNER_PERMISSIONS,
  admin: {
    agents: true,
    members: true,
    billing: true,
    settings: true,
  },
}

export function effectivePermissions(
  role: ManagerRole,
  overrides: WorkspaceRolePermissions | null | undefined,
): RolePermissionMap {
  if (role === 'owner') return OWNER_PERMISSIONS
  return { ...DEFAULT_ROLE_PERMISSIONS[role], ...overrides?.[role] }
}

// ─── Permissões de agente ────────────────────────────────────────────────────
// Áreas administrativas do contexto do agente que um admin pode ou não acessar.
// O superadmin sempre tem tudo (é o owner do conceito); admin segue a matriz
// (editável pelo superadmin) ou os defaults; agent nunca acessa estas áreas.

export const AGENT_PERMISSION_KEYS = [
  'conversations_assign',
  // Gestão de tags (sistema unificado de tags de contatos e conversas).
  // A chave segue 'labels' por compatibilidade com overrides já persistidos.
  'labels',
  'quick_replies_manage',
  'reports',
] as const
export type AgentPermissionKey = (typeof AGENT_PERMISSION_KEYS)[number]

export type AgentPermissionMap = Record<AgentPermissionKey, boolean>

// Overrides parciais por papel de agente. Null/ausência de chave = cai no
// default de DEFAULT_AGENT_PERMISSIONS.
export type WorkspaceAgentPermissions = Partial<Record<'admin' | 'agent', Partial<AgentPermissionMap>>>

export const SUPERADMIN_PERMISSIONS: AgentPermissionMap = {
  conversations_assign: true,
  labels: true,
  quick_replies_manage: true,
  reports: true,
}

export const DEFAULT_AGENT_PERMISSIONS: Record<'admin' | 'agent', AgentPermissionMap> = {
  admin: SUPERADMIN_PERMISSIONS,
  agent: {
    conversations_assign: false,
    labels: false,
    quick_replies_manage: false,
    reports: false,
  },
}

export function effectiveAgentPermissions(
  role: AgentRole,
  overrides: WorkspaceAgentPermissions | null | undefined,
): AgentPermissionMap {
  if (role === 'superadmin') return SUPERADMIN_PERMISSIONS
  return { ...DEFAULT_AGENT_PERMISSIONS[role], ...overrides?.[role] }
}

// ─── Mídia ───────────────────────────────────────────────────────────────────
// Referência a um arquivo no storage do CRM (MinIO). Equivalente ao MediaRef
// do Campaigns, mas definido aqui — os produtos nunca compartilham código de
// runtime. Usado em messages.attachments e nos jobs de outbound/inbound.

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

export type MediaRef = {
  storageKey: string
  mimeType: string
  kind: MediaKind
  filename: string
}

// ─── Bot flows ───────────────────────────────────────────────────────────────
// Definition persistida em bot_flows.definition (jsonb). Estrutura flexível
// de nós/arestas — o `data` de cada nó é específico do kind e validado pela
// API/engine (texto da mensagem, opções do menu, expressão da condição, nome
// da variável em collect_input, alvo do handoff...).

export type BotNodeKind =
  | 'start'
  | 'message'
  | 'menu'
  // Mensagem com botões clicáveis: inline keyboard nativa no Telegram;
  // no WhatsApp degrada para lista numerada (responder com o número).
  | 'buttons'
  | 'condition'
  | 'collect_input'
  // Espera N segundos/minutos antes de seguir para o próximo nó.
  | 'delay'
  | 'assign_queue'
  | 'assign_agent'
  // Encerra a sessão (completed) e resolve a conversa; data { message?: string }
  // envia uma despedida opcional antes de fechar.
  | 'close_conversation'
  // Adiciona/remove tag da conversa; data { action: 'add'|'remove', tagId }.
  | 'manage_tag'
  // Chamada HTTP externa; data { url, method?: 'GET'|'POST', saveToVariable?: string }.
  | 'webhook'
  | 'end'

// Validação da entrada coletada pelo nó `collect_input` (vai no `data` do nó).
// 'text' aceita qualquer texto; as demais rejeitam entradas inválidas e
// reenviam a pergunta ao contato.
export type BotInputValidation = 'text' | 'number' | 'email' | 'phone'

// Operador do nó `condition` (vai no `data` do nó como
// { variable, operator, value }). Comparação case-insensitive com trim:
// 'contains' = o valor da variável contém o valor esperado; 'equals' = igual.
export type BotConditionOperator = 'contains' | 'equals'

export type BotFlowNode = {
  id: string
  kind: BotNodeKind
  position?: { x: number; y: number }
  data: Record<string, unknown>
}

export type BotFlowEdge = {
  id: string
  source: string
  target: string
  // Saída nomeada do nó de origem (ex.: opção de menu, ramo true/false da
  // condição). Ausente = aresta única de sequência.
  sourceHandle?: string
}

export type BotFlowDefinition = {
  nodes: BotFlowNode[]
  edges: BotFlowEdge[]
}

// ─── Horários de atendimento ─────────────────────────────────────────────────
// Configuração por workspace (workspace_settings.business_hours). Cada dia da
// semana (0 = domingo, 6 = sábado) tem janela de início/fim em 'HH:mm' no
// fuso do workspace. Dia ausente na lista = fechado o dia inteiro.

export type BusinessHoursDay = {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6
  start: string
  end: string
}

// Comportamento fora do horário de atendimento:
// - 'none': nada acontece, a conversa segue o fluxo normal;
// - 'auto_reply': responde com a mensagem customizável de fora de horário;
// - 'bot': inicia o fluxo de bot específico de fora de horário (opcional);
// - 'both': auto_reply + bot.
export type OutOfHoursMode = 'none' | 'auto_reply' | 'bot' | 'both'
