import '@xyflow/react/dist/style.css'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  CircleCheck,
  CircleStop,
  FlaskConical,
  GitBranch,
  List,
  ListTree,
  MessageSquare,
  MousePointerClick,
  Paperclip,
  Pause,
  Play,
  Plus,
  Tag,
  TextCursorInput,
  Timer,
  Trash2,
  UserCheck,
  Webhook,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import { Button, Card, ErrorNote, Modal } from '../../../components/ui'
import { FlowSimulator } from '../../../components/bot/flow-simulator'
import {
  fetchAgentsAdmin,
  fetchBot,
  fetchBotStats,
  fetchFiles,
  fetchQueues,
  fetchTags,
  getInboxAgent,
  pauseBot,
  publishBot,
  updateBot,
  type BotFlowDefinition,
  type BotNodeKind,
  type BotStats,
  type BotStatus,
  type BotTriggerKind,
  type InboxFileItem,
  type JsonValue,
  type QueueItem,
  type TagItem,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/bot/$botId')({
  head: () => createHeadConfig('Editor de fluxo — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async ({ params }) => {
    const agent = (await getInboxAgent())!
    const bot = await fetchBot({ data: { botId: params.botId } })
    if (!bot) throw redirect({ to: '/inbox/bot' })
    const queues = await fetchQueues().catch(() => [] as QueueItem[])
    // Tags do workspace: opções do nó manage_tag.
    const tags = await fetchTags().catch(() => [] as TagItem[])
    // Agentes: fetchAgentsAdmin é superadmin-only; sem acesso, deriva dos membros das filas.
    let agentOptions = (await fetchAgentsAdmin().catch(() => [])).map((a) => ({
      id: a.id,
      name: a.name,
    }))
    if (agentOptions.length === 0) {
      const seen = new Map<string, string>()
      for (const queue of queues) {
        for (const member of queue.members) {
          if (!seen.has(member.agentId)) seen.set(member.agentId, member.agentName)
        }
      }
      agentOptions = [...seen.entries()].map(([id, name]) => ({ id, name }))
    }
    return { agent, bot, queues, agentOptions, tags }
  },
  component: BotEditorPage,
})

// ─── Metadados dos tipos de nó ───────────────────────────────────────────────

const kindMeta: Record<BotNodeKind, { label: string; icon: LucideIcon; chip: string }> = {
  start: { label: 'Início', icon: Play, chip: 'bg-success-500/10 text-success-500' },
  message: { label: 'Mensagem', icon: MessageSquare, chip: 'bg-brand-50 text-brand-600' },
  menu: { label: 'Menu', icon: List, chip: 'bg-blue-50 text-blue-600' },
  buttons: { label: 'Botões', icon: MousePointerClick, chip: 'bg-brand-500/10 text-brand-700' },
  condition: { label: 'Condição', icon: GitBranch, chip: 'bg-amber-50 text-amber-600' },
  collect_input: { label: 'Coletar resposta', icon: TextCursorInput, chip: 'bg-neutral-100 text-dark-800' },
  delay: { label: 'Aguardar', icon: Timer, chip: 'bg-warning-500/10 text-warning-500' },
  assign_queue: { label: 'Enviar para fila', icon: ListTree, chip: 'bg-blue-50 text-blue-600' },
  assign_agent: { label: 'Atribuir agente', icon: UserCheck, chip: 'bg-neutral-100 text-dark-800' },
  end: { label: 'Fim', icon: CircleStop, chip: 'bg-error-500/10 text-error-500' },
  close_conversation: { label: 'Resolver conversa', icon: CircleCheck, chip: 'bg-success-500/10 text-success-500' },
  manage_tag: { label: 'Gerenciar tag', icon: Tag, chip: 'bg-amber-50 text-amber-600' },
  webhook: { label: 'Webhook', icon: Webhook, chip: 'bg-blue-50 text-blue-600' },
}

// Tipos que o superadmin pode adicionar pela paleta (start é único e fixo).
const paletteKinds: BotNodeKind[] = [
  'message',
  'menu',
  'buttons',
  'condition',
  'collect_input',
  'delay',
  'assign_queue',
  'assign_agent',
  'manage_tag',
  'webhook',
  'close_conversation',
  'end',
]

const statusMeta: Record<BotStatus, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-neutral-100 text-neutral-500' },
  active: { label: 'Ativo', className: 'bg-success-500/10 text-success-500' },
  paused: { label: 'Pausado', className: 'bg-warning-500/10 text-warning-600' },
}

const triggerOptions: { value: BotTriggerKind; label: string }[] = [
  { value: 'new_conversation', label: 'Nova conversa' },
  { value: 'keyword', label: 'Palavra-chave' },
  { value: 'always', label: 'Sempre' },
]

const validationOptions: { value: string; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
]

// ─── Tipos e helpers do canvas ───────────────────────────────────────────────

type FlowNode = Node<Record<string, JsonValue>, BotNodeKind>

function str(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function strList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Opções do nó 'buttons': [{ id, label }] — o id vira o sourceHandle da edge.
export type ButtonOption = { id: string; label: string }

function buttonOptions(value: JsonValue | undefined): ButtonOption[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is ButtonOption =>
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      typeof (v as ButtonOption).id === 'string' &&
      typeof (v as ButtonOption).label === 'string',
  )
}

// Resumo amigável do delay: 90 → 'Aguardar 1 min 30 s', 300 → 'Aguardar 5 min'.
function delaySummary(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return 'Tempo não definido'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} h`)
  if (minutes > 0) parts.push(`${minutes} min`)
  if (secs > 0 || parts.length === 0) parts.push(`${secs} s`)
  return `Aguardar ${parts.join(' ')}`
}

// Validação básica da URL do nó webhook (http/https com host).
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

function defaultData(kind: BotNodeKind): Record<string, JsonValue> {
  switch (kind) {
    case 'message':
      return { text: '' }
    case 'menu':
      return { text: '', options: ['Opção 1'] }
    case 'buttons':
      return { text: '', options: [{ id: 'opt-1', label: 'Opção 1' }] }
    case 'condition':
      return { variable: '', operator: 'contains', value: '' }
    case 'collect_input':
      return { question: '', variable: '', validation: 'text' }
    case 'delay':
      return { seconds: 60 }
    case 'assign_queue':
      return { queueId: '', queueName: '' }
    case 'assign_agent':
      return { agentId: '', agentName: '' }
    case 'close_conversation':
      return { message: '' }
    case 'manage_tag':
      return { action: 'add', tagId: '', tagName: '' }
    case 'webhook':
      return { url: '', method: 'POST', saveToVariable: '' }
    default:
      return {}
  }
}

function nodeTitle(node: FlowNode): string {
  const kind = node.type ?? 'message'
  const d = node.data
  switch (kind) {
    case 'message':
      return str(d.text).slice(0, 24) || 'Mensagem'
    case 'menu':
      return str(d.text).slice(0, 24) || 'Menu'
    case 'buttons':
      return str(d.text).slice(0, 24) || 'Botões'
    case 'condition':
      return str(d.variable) ? `Se ${str(d.variable)}` : 'Condição'
    case 'collect_input':
      return str(d.question).slice(0, 24) || 'Coletar resposta'
    case 'delay':
      return delaySummary(typeof d.seconds === 'number' ? d.seconds : 0)
    case 'assign_queue':
      return str(d.queueName) || 'Enviar para fila'
    case 'assign_agent':
      return str(d.agentName) || 'Atribuir agente'
    case 'manage_tag':
      return str(d.tagName) || 'Gerenciar tag'
    default:
      return kindMeta[kind].label
  }
}

// ─── Nó customizado ──────────────────────────────────────────────────────────

function BotNodeView({ type, data, selected }: NodeProps) {
  const kind = (type ?? 'message') as BotNodeKind
  const meta = kindMeta[kind]
  const Icon = meta.icon
  const d = data as Record<string, JsonValue>
  const options = kind === 'menu' ? strList(d.options) : []
  const buttonOpts = kind === 'buttons' ? buttonOptions(d.options) : []

  let summary: string
  switch (kind) {
    case 'start':
      summary = 'Dispara o fluxo'
      break
    case 'message':
      summary = str(d.text) || 'Mensagem vazia'
      break
    case 'menu':
      summary = str(d.text) || 'Sem texto'
      break
    case 'buttons':
      summary = str(d.text) || 'Sem texto'
      break
    case 'condition':
      summary = str(d.variable)
        ? `${str(d.variable)} ${d.operator === 'equals' ? 'é igual a' : 'contém'} "${str(d.value)}"`
        : 'Condição incompleta'
      break
    case 'collect_input': {
      const validationLabel = validationOptions.find((o) => o.value === d.validation)?.label
      summary = str(d.question)
        ? `${str(d.question)} → salva em {{${str(d.variable) || '…'}}}${validationLabel && d.validation !== 'text' ? ` (${validationLabel})` : ''}`
        : 'Pergunta não definida'
      break
    }
    case 'delay':
      summary = delaySummary(typeof d.seconds === 'number' ? d.seconds : 0)
      break
    case 'assign_queue':
      summary = str(d.queueName) || 'Fila não definida'
      break
    case 'assign_agent':
      summary = str(d.agentName) || 'Agente não definido'
      break
    case 'close_conversation':
      summary = str(d.message)
        ? `Envia “${str(d.message).slice(0, 60)}” e resolve a conversa`
        : 'Encerra o bot e resolve a conversa'
      break
    case 'manage_tag':
      summary = str(d.tagName)
        ? `${d.action === 'remove' ? 'Remove' : 'Adiciona'} a tag ${str(d.tagName)}`
        : 'Tag não definida'
      break
    case 'webhook': {
      const method = d.method === 'GET' ? 'GET' : 'POST'
      const variable = str(d.saveToVariable)
      summary = str(d.url)
        ? `${method} ${str(d.url)}${variable ? ` → {{${variable}}}` : ''}`
        : 'URL não definida'
      break
    }
    default:
      summary = 'Encerra o atendimento do bot'
  }

  return (
    <div
      className={`w-56 rounded-lg border bg-neutral-0 shadow-2xs ${
        selected ? 'border-brand-500 ring-2 ring-brand-500/15' : 'border-neutral-200'
      }`}
    >
      {kind !== 'start' && <Handle type="target" position={Position.Top} className="!bg-neutral-300" />}

      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <span className={`grid size-6 shrink-0 place-items-center rounded-md ${meta.chip}`}>
          <Icon size={13} aria-hidden="true" />
        </span>
        <span className="truncate text-xs font-bold text-dark-800">{meta.label}</span>
      </div>

      <p className="line-clamp-3 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">{summary}</p>

      {kind === 'message' && str(d.attachmentFilename) && (
        <p className="flex items-center gap-1 border-t border-neutral-50 px-3 py-1.5 text-[11px] text-neutral-400">
          <Paperclip size={11} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{str(d.attachmentFilename)}</span>
        </p>
      )}

      {kind === 'menu' &&
        options.map((option, index) => (
          <div
            key={index}
            className="relative flex items-center border-t border-neutral-50 px-3 py-1.5"
          >
            <span className="truncate text-[11px] font-medium text-dark-800">
              {option || `Opção ${index + 1}`}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={`opt-${index}`}
              className="!bg-brand-500"
            />
          </div>
        ))}

      {kind === 'condition' && (
        <>
          <div className="relative flex items-center border-t border-neutral-50 px-3 py-1.5">
            <span className="text-[11px] font-medium text-success-500">Verdadeiro</span>
            <Handle type="source" position={Position.Right} id="true" className="!bg-success-500" />
          </div>
          <div className="relative flex items-center border-t border-neutral-50 px-3 py-1.5">
            <span className="text-[11px] font-medium text-error-500">Falso</span>
            <Handle type="source" position={Position.Right} id="false" className="!bg-error-500" />
          </div>
        </>
      )}

      {kind === 'buttons' && (
        <>
          {buttonOpts.map((option, index) => (
            <div
              key={option.id}
              className="relative flex items-center border-t border-neutral-50 px-3 py-1.5"
            >
              <span className="truncate text-[11px] font-medium text-dark-800">
                {option.label || `Opção ${index + 1}`}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={option.id}
                className="!bg-brand-500"
              />
            </div>
          ))}
          {/* Saída padrão opcional: respostas que não correspondem a nenhuma opção. */}
          <div className="relative flex items-center border-t border-neutral-50 px-3 py-1.5">
            <span className="text-[11px] font-medium text-neutral-400">Outra resposta</span>
            <Handle type="source" position={Position.Right} id="default" className="!bg-neutral-300" />
          </div>
        </>
      )}

      {kind !== 'end' && kind !== 'menu' && kind !== 'condition' && kind !== 'buttons' && (
        <Handle type="source" position={Position.Bottom} className="!bg-neutral-300" />
      )}
    </div>
  )
}

const nodeTypes: NodeTypes = {
  start: BotNodeView,
  message: BotNodeView,
  menu: BotNodeView,
  buttons: BotNodeView,
  condition: BotNodeView,
  collect_input: BotNodeView,
  delay: BotNodeView,
  assign_queue: BotNodeView,
  assign_agent: BotNodeView,
  end: BotNodeView,
  close_conversation: BotNodeView,
  manage_tag: BotNodeView,
  webhook: BotNodeView,
}

// ─── Serialização e validação ────────────────────────────────────────────────

function serialize(nodes: FlowNode[], edges: Edge[]): BotFlowDefinition {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: (n.type ?? 'message') as BotNodeKind,
      position: { x: n.position.x, y: n.position.y },
      data: n.data,
    })),
    edges: edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .filter((e) => {
        // Remove saídas de menu que apontam para opções removidas.
        const source = byId.get(e.source)
        if (source?.type === 'menu' && e.sourceHandle?.startsWith('opt-')) {
          const index = Number(e.sourceHandle.slice(4))
          return index < strList(source.data.options).length
        }
        // Em buttons, a saída é o id da opção (ou 'default'); remove as órfãs.
        if (source?.type === 'buttons' && e.sourceHandle && e.sourceHandle !== 'default') {
          return buttonOptions(source.data.options).some((o) => o.id === e.sourceHandle)
        }
        return true
      })
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      })),
  }
}

function validateFlow(nodes: FlowNode[], edges: Edge[]): string[] {
  const errors: string[] = []
  const starts = nodes.filter((n) => n.type === 'start')
  if (starts.length !== 1) {
    errors.push('O fluxo precisa de exatamente um nó de início.')
    return errors
  }
  // Todo nó precisa ser alcançável a partir do início (BFS sobre as edges).
  const reachable = new Set<string>([starts[0].id])
  const queue = [starts[0].id]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source === current && !reachable.has(edge.target)) {
        reachable.add(edge.target)
        queue.push(edge.target)
      }
    }
  }
  const orphans = nodes.filter((n) => !reachable.has(n.id))
  if (orphans.length > 0) {
    errors.push(
      `Conecte ao fluxo: ${orphans.map((n) => nodeTitle(n)).join(', ')}.`,
    )
  }
  return errors
}

// ─── Editor ──────────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-md border border-neutral-200 bg-neutral-0 px-3 py-2 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none'

function BotEditorPage() {
  const { bot, queues, agentOptions, tags } = Route.useLoaderData()

  const [name, setName] = useState(bot.name)
  const [status, setStatus] = useState<BotStatus>(bot.status)
  const [triggerKind, setTriggerKind] = useState<BotTriggerKind>(bot.triggerKind)
  const [keywordsText, setKeywordsText] = useState(bot.triggerKeywords.join(', '))
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)

  const initialNodes: FlowNode[] = (
    bot.definition.nodes.length > 0
      ? bot.definition.nodes
      : [{ id: 'start', kind: 'start' as const, data: {} }]
  ).map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data,
  }))
  const initialEdges: Edge[] = bot.definition.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
  }))

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  )

  const selectedNode = nodes.find((n) => n.selected) ?? null

  function updateNodeData(nodeId: string, patch: Record<string, JsonValue>) {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    )
  }

  function deleteNode(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
  }

  function addNode(kind: BotNodeKind) {
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: kind,
        position: { x: 120 + Math.random() * 160, y: 120 + nds.length * 40 },
        data: defaultData(kind),
      },
    ])
  }

  function buildPayload() {
    return {
      name: name.trim() || bot.name,
      triggerKind,
      triggerKeywords:
        triggerKind === 'keyword'
          ? keywordsText
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean)
          : [],
      definition: serialize(nodes, edges),
    }
  }

  async function handleSave(): Promise<boolean> {
    const problems = validateFlow(nodes, edges)
    setErrors(problems)
    if (problems.length > 0) return false
    setSaving(true)
    const updated = await updateBot({ data: { botId: bot.id, ...buildPayload() } })
    setSaving(false)
    if (!updated) {
      setErrors(['Não foi possível salvar o rascunho. Tente novamente.'])
      return false
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
    return true
  }

  async function handlePublish() {
    const saved = await handleSave()
    if (!saved) return
    setPublishing(true)
    const updated = await publishBot({ data: { botId: bot.id } })
    setPublishing(false)
    if (!updated) {
      setErrors([
        'Não foi possível publicar o fluxo. Verifique o limite de bots ativos do seu plano ou se você tem permissão de superadmin.',
      ])
      return
    }
    setStatus(updated.status)
  }

  async function handlePause() {
    setPublishing(true)
    const updated = await pauseBot({ data: { botId: bot.id } })
    setPublishing(false)
    if (!updated) {
      setErrors(['Não foi possível pausar o fluxo. Tente novamente.'])
      return
    }
    setStatus(updated.status)
  }

  const statusInfo = statusMeta[status]

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <header className="flex h-14 shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-0 px-3">
        <Link
          to="/inbox/bot"
          aria-label="Voltar para a lista de fluxos"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-dark-800"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </Link>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nome do fluxo"
          className="w-44 shrink-0 rounded-md border border-transparent px-2 py-1 text-sm font-semibold text-dark-800 transition-colors hover:border-neutral-200 focus:border-brand-500 focus:outline-none"
        />

        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.className}`}>
          {statusInfo.label}
        </span>

        <select
          value={triggerKind}
          onChange={(e) => setTriggerKind(e.target.value as BotTriggerKind)}
          aria-label="Gatilho"
          className="h-8 shrink-0 rounded-md border border-neutral-200 bg-neutral-0 px-2 text-xs text-dark-800 focus:border-brand-500 focus:outline-none"
        >
          {triggerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {triggerKind === 'keyword' && (
          <input
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder="palavras, separadas, por vírgula"
            aria-label="Palavras-chave"
            className="h-8 w-48 rounded-md border border-neutral-200 bg-neutral-0 px-2 text-xs text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none"
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {savedFlash && <span className="text-xs font-medium text-success-500">Salvo</span>}
          <Button size="sm" variant="ghost" icon={FlaskConical} onClick={() => setSimulatorOpen(true)}>
            Simular
          </Button>
          <Button size="sm" variant="ghost" icon={BarChart3} onClick={() => setStatsOpen(true)}>
            Estatísticas
          </Button>
          {status === 'active' && (
            <Button size="sm" variant="ghost" icon={Pause} loading={publishing} onClick={handlePause}>
              Pausar
            </Button>
          )}
          {status !== 'active' && (
            <Button
              size="sm"
              variant="secondary"
              icon={Play}
              loading={publishing}
              onClick={handlePublish}
            >
              Publicar
            </Button>
          )}
          <Button size="sm" loading={saving} onClick={handleSave}>
            Salvar rascunho
          </Button>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="shrink-0 space-y-1.5 border-b border-neutral-200 bg-neutral-0 px-4 py-3">
          {errors.map((message, index) => (
            <ErrorNote key={index}>{message}</ErrorNote>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Paleta de nós */}
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-0 p-3">
          <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Adicionar etapa
          </p>
          <div className="space-y-1">
            {paletteKinds.map((kind) => {
              const meta = kindMeta[kind]
              const Icon = meta.icon
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => addNode(kind)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-dark-800 transition-colors hover:bg-neutral-50"
                >
                  <span className={`grid size-6 shrink-0 place-items-center rounded-md ${meta.chip}`}>
                    <Icon size={13} aria-hidden="true" />
                  </span>
                  {meta.label}
                </button>
              )
            })}
          </div>
          <p className="px-1 pt-4 text-[11px] leading-relaxed text-neutral-400">
            Arraste das saídas de um nó até o próximo para conectar as etapas.
          </p>
        </aside>

        {/* Canvas */}
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Propriedades do nó selecionado */}
        {selectedNode && (
          <NodeProperties
            key={selectedNode.id}
            node={selectedNode}
            queues={queues}
            agentOptions={agentOptions}
            tags={tags}
            onChange={(patch) => updateNodeData(selectedNode.id, patch)}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        )}
      </div>

      {/* Simulador client-side do fluxo (prévia, sem backend) */}
      <FlowSimulator
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        definition={serialize(nodes, edges)}
      />

      {/* Estatísticas do fluxo (GET /inbox/bots/:id/stats) */}
      <BotStatsModal botId={bot.id} open={statsOpen} onClose={() => setStatsOpen(false)} />
    </div>
  )
}

// ─── Painel de propriedades ──────────────────────────────────────────────────

function NodeProperties({
  node,
  queues,
  agentOptions,
  tags,
  onChange,
  onDelete,
}: {
  node: FlowNode
  queues: QueueItem[]
  agentOptions: { id: string; name: string }[]
  tags: TagItem[]
  onChange: (patch: Record<string, JsonValue>) => void
  onDelete: () => void
}) {
  const kind = (node.type ?? 'message') as BotNodeKind
  const meta = kindMeta[kind]
  const d = node.data
  const options = kind === 'menu' ? strList(d.options) : []
  const buttonOpts = kind === 'buttons' ? buttonOptions(d.options) : []

  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [files, setFiles] = useState<InboxFileItem[] | null>(null)

  async function openFilePicker() {
    setFilePickerOpen(true)
    if (files === null) {
      setFiles(await fetchFiles({ data: {} }))
    }
  }

  function setOption(index: number, value: string) {
    onChange({ options: options.map((o, i) => (i === index ? value : o)) })
  }

  function setButtonOption(index: number, label: string) {
    onChange({ options: buttonOpts.map((o, i) => (i === index ? { ...o, label } : o)) })
  }

  function addButtonOption() {
    // Próximo id opt-N livre — o id vira o sourceHandle das edges.
    const maxN = buttonOpts.reduce((acc, o) => {
      const match = /^opt-(\d+)$/.exec(o.id)
      return match ? Math.max(acc, Number(match[1])) : acc
    }, 0)
    onChange({
      options: [
        ...buttonOpts,
        { id: `opt-${maxN + 1}`, label: `Opção ${buttonOpts.length + 1}` },
      ],
    })
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-0">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <p className="text-sm font-bold text-dark-800">{meta.label}</p>
        {kind !== 'start' && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Excluir etapa"
            className="grid size-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-error-500/5 hover:text-error-500"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 p-4">
        {kind === 'start' && (
          <p className="text-xs leading-relaxed text-neutral-500">
            O fluxo sempre começa por aqui quando o gatilho dispara.
          </p>
        )}

        {kind === 'message' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Texto da mensagem</span>
              <textarea
                value={str(d.text)}
                onChange={(e) => onChange({ text: e.target.value })}
                rows={5}
                placeholder="Olá! Como posso ajudar?"
                className={`${inputClass} resize-y`}
              />
            </label>
            <div className="space-y-1">
              <span className="text-xs font-semibold text-dark-800">Anexo (opcional)</span>
              {str(d.attachmentFilename) ? (
                <div className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2">
                  <Paperclip size={13} aria-hidden="true" className="shrink-0 text-neutral-400" />
                  <span className="min-w-0 flex-1 truncate text-xs text-dark-800">
                    {str(d.attachmentFilename)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange({ attachmentFileId: '', attachmentFilename: '' })}
                    aria-label="Remover anexo"
                    className="shrink-0 text-neutral-400 transition-colors hover:text-error-500"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" icon={Paperclip} onClick={openFilePicker}>
                  Anexar da biblioteca
                </Button>
              )}
            </div>
          </>
        )}

        {kind === 'menu' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Texto do menu</span>
              <textarea
                value={str(d.text)}
                onChange={(e) => onChange({ text: e.target.value })}
                rows={3}
                placeholder="Escolha uma opção:"
                className={`${inputClass} resize-y`}
              />
            </label>
            <div className="space-y-2">
              <span className="text-xs font-semibold text-dark-800">Opções</span>
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    value={option}
                    onChange={(e) => setOption(index, e.target.value)}
                    placeholder={`Opção ${index + 1}`}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => onChange({ options: options.filter((_, i) => i !== index) })}
                    disabled={options.length <= 1}
                    aria-label={`Remover opção ${index + 1}`}
                    className="shrink-0 text-neutral-400 transition-colors hover:text-error-500 disabled:opacity-40"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              {options.length < 10 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Plus}
                  onClick={() => onChange({ options: [...options, `Opção ${options.length + 1}`] })}
                >
                  Adicionar opção
                </Button>
              )}
              <p className="text-[11px] leading-relaxed text-neutral-400">
                Cada opção vira uma saída no nó — conecte cada uma à próxima etapa.
              </p>
            </div>
          </>
        )}

        {kind === 'buttons' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Texto da mensagem</span>
              <textarea
                value={str(d.text)}
                onChange={(e) => onChange({ text: e.target.value })}
                rows={3}
                placeholder="Escolha uma opção:"
                className={`${inputClass} resize-y`}
              />
            </label>
            <div className="space-y-2">
              <span className="text-xs font-semibold text-dark-800">Opções</span>
              {buttonOpts.map((option, index) => (
                <div key={option.id} className="flex items-center gap-1.5">
                  <input
                    value={option.label}
                    onChange={(e) => setButtonOption(index, e.target.value)}
                    placeholder={`Opção ${index + 1}`}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ options: buttonOpts.filter((_, i) => i !== index) })
                    }
                    disabled={buttonOpts.length <= 1}
                    aria-label={`Remover opção ${index + 1}`}
                    className="shrink-0 text-neutral-400 transition-colors hover:text-error-500 disabled:opacity-40"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              {buttonOpts.length < 10 && (
                <Button size="sm" variant="secondary" icon={Plus} onClick={addButtonOption}>
                  Adicionar opção
                </Button>
              )}
              <p className="text-[11px] leading-relaxed text-neutral-400">
                Cada opção vira uma saída no nó — conecte cada uma à próxima etapa. No Telegram as
                opções aparecem como botões clicáveis; no WhatsApp viram uma lista numerada (o
                contato responde com o número). A saída “Outra resposta” é opcional e recebe
                qualquer resposta fora das opções.
              </p>
            </div>
          </>
        )}

        {kind === 'delay' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Tempo de espera (segundos)</span>
              <input
                type="number"
                min={1}
                value={typeof d.seconds === 'number' ? d.seconds : ''}
                onChange={(e) => {
                  const seconds = Number(e.target.value)
                  onChange({ seconds: Number.isFinite(seconds) ? Math.max(1, seconds) : 1 })
                }}
                placeholder="ex.: 300"
                className={inputClass}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              {delaySummary(typeof d.seconds === 'number' ? d.seconds : 0)} antes de seguir para a
              próxima etapa. ex.: 300 = Aguardar 5 min.
            </p>
          </>
        )}

        {kind === 'condition' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Variável</span>
              <input
                value={str(d.variable)}
                onChange={(e) => onChange({ variable: e.target.value })}
                placeholder="ex.: resposta_do_cliente"
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Operador</span>
              <select
                value={d.operator === 'equals' ? 'equals' : 'contains'}
                onChange={(e) => onChange({ operator: e.target.value })}
                className={inputClass}
              >
                <option value="contains">Contém</option>
                <option value="equals">É igual a</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Valor</span>
              <input
                value={str(d.value)}
                onChange={(e) => onChange({ value: e.target.value })}
                placeholder="ex.: sim"
                className={inputClass}
              />
            </label>
          </>
        )}

        {kind === 'collect_input' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Pergunta</span>
              <textarea
                value={str(d.question)}
                onChange={(e) => onChange({ question: e.target.value })}
                rows={3}
                placeholder="Qual é o seu e-mail?"
                className={`${inputClass} resize-y`}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Salvar na variável</span>
              <input
                value={str(d.variable)}
                onChange={(e) => onChange({ variable: e.target.value })}
                placeholder="ex.: email"
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Validação</span>
              <select
                value={typeof d.validation === 'string' ? d.validation : 'text'}
                onChange={(e) => onChange({ validation: e.target.value })}
                className={inputClass}
              >
                {validationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Respostas que não passarem na validação são pedidas de novo.
            </p>
          </>
        )}

        {kind === 'assign_queue' && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-dark-800">Fila</span>
            <select
              value={str(d.queueId)}
              onChange={(e) => {
                const queue = queues.find((q) => q.id === e.target.value)
                onChange({ queueId: e.target.value, queueName: queue?.name ?? '' })
              }}
              className={inputClass}
            >
              <option value="">Selecione…</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === 'assign_agent' && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-dark-800">Agente</span>
            <select
              value={str(d.agentId)}
              onChange={(e) => {
                const agent = agentOptions.find((a) => a.id === e.target.value)
                onChange({ agentId: e.target.value, agentName: agent?.name ?? '' })
              }}
              className={inputClass}
            >
              <option value="">Selecione…</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === 'end' && (
          <p className="text-xs leading-relaxed text-neutral-500">
            Encerra o atendimento do bot nesta conversa.
          </p>
        )}

        {kind === 'close_conversation' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">
                Mensagem de despedida <span className="font-normal text-neutral-400">(opcional)</span>
              </span>
              <textarea
                value={str(d.message)}
                onChange={(e) => onChange({ message: e.target.value })}
                rows={3}
                placeholder="Obrigado pelo contato! Estou encerrando este atendimento."
                className={`${inputClass} resize-y`}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Envia a mensagem (se preenchida), encerra o bot e marca a conversa como resolvida.
            </p>
          </>
        )}

        {kind === 'manage_tag' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Ação</span>
              <select
                value={d.action === 'remove' ? 'remove' : 'add'}
                onChange={(e) => onChange({ action: e.target.value })}
                className={inputClass}
              >
                <option value="add">Adicionar tag</option>
                <option value="remove">Remover tag</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Tag</span>
              <select
                value={str(d.tagId)}
                onChange={(e) => {
                  const tag = tags.find((t) => t.id === e.target.value)
                  onChange({ tagId: e.target.value, tagName: tag?.name ?? '' })
                }}
                className={inputClass}
              >
                <option value="">Selecione…</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            {tags.length === 0 && (
              <p className="text-[11px] leading-relaxed text-neutral-400">
                Nenhuma tag no workspace — crie tags em Admin → Tags.
              </p>
            )}
          </>
        )}

        {kind === 'webhook' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">URL</span>
              <input
                type="url"
                value={str(d.url)}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder="https://exemplo.com/hook"
                className={inputClass}
              />
            </label>
            {str(d.url) && !isValidHttpUrl(str(d.url)) && (
              <ErrorNote>Informe uma URL http(s) válida.</ErrorNote>
            )}
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">Método</span>
              <select
                value={d.method === 'GET' ? 'GET' : 'POST'}
                onChange={(e) => onChange({ method: e.target.value })}
                className={inputClass}
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-dark-800">
                Salvar resposta na variável <span className="font-normal text-neutral-400">(opcional)</span>
              </span>
              <input
                value={str(d.saveToVariable)}
                onChange={(e) => onChange({ saveToVariable: e.target.value })}
                placeholder="ex.: resultado_consulta"
                className={inputClass}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              O corpo da resposta fica disponível como {'{{variavel}}'} nas próximas mensagens.
            </p>
          </>
        )}
      </div>

      <Modal
        open={filePickerOpen}
        onClose={() => setFilePickerOpen(false)}
        title="Anexar da biblioteca"
      >
        {files === null ? (
          <div className="grid place-items-center py-8 text-neutral-300">
            <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </div>
        ) : files.length === 0 ? (
          <p className="py-4 text-sm text-neutral-500">
            Nenhum arquivo na biblioteca. Envie arquivos pela tela Arquivos.
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {files.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => {
                  onChange({ attachmentFileId: file.id, attachmentFilename: file.filename })
                  setFilePickerOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-neutral-50"
              >
                <Paperclip size={13} aria-hidden="true" className="shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-dark-800">
                  {file.filename}
                </span>
                <span className="shrink-0 text-[10px] uppercase text-neutral-400">{file.kind}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </aside>
  )
}

// ─── Estatísticas do fluxo ───────────────────────────────────────────────────

const statsStatusMeta: { key: keyof BotStats['byStatus']; label: string; className: string }[] = [
  { key: 'running', label: 'Em andamento', className: 'bg-blue-50 text-blue-600' },
  { key: 'completed', label: 'Concluídas', className: 'bg-success-500/10 text-success-500' },
  { key: 'handed_off', label: 'Transferidas', className: 'bg-amber-50 text-amber-600' },
  { key: 'failed', label: 'Falhas', className: 'bg-error-500/10 text-error-500' },
  { key: 'cancelled', label: 'Interrompidas', className: 'bg-neutral-100 text-neutral-500' },
]

function BotStatsModal({ botId, open, onClose }: { botId: string; open: boolean; onClose: () => void }) {
  const [stats, setStats] = useState<BotStats | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    fetchBotStats({ data: { botId, days: 30 } })
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, botId])

  const perDay = stats?.perDay ?? []
  const maxStarted = Math.max(...perDay.map((d) => d.started), 0)

  return (
    <Modal open={open} onClose={onClose} title="Estatísticas do fluxo">
      {loading ? (
        <div className="grid place-items-center py-10 text-neutral-300">
          <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      ) : !stats ? (
        <p className="py-6 text-center text-sm text-neutral-400">
          Estatísticas indisponíveis no momento.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-[11px] text-neutral-400">Últimos 30 dias.</p>

          {/* Totais */}
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3">
              <p className="text-[11px] font-medium text-neutral-400">Sessões iniciadas</p>
              <p className="mt-1 font-display text-xl font-extrabold text-dark-800">{stats.total}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[11px] font-medium text-neutral-400">Taxa de conclusão</p>
              <p className="mt-1 font-display text-xl font-extrabold text-dark-800">
                {Math.round(stats.completionRate * 100)}%
              </p>
            </Card>
          </div>

          {/* Por status */}
          <div className="flex flex-wrap gap-1.5">
            {statsStatusMeta.map(({ key, label, className }) => (
              <span key={key} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${className}`}>
                {label}: {stats.byStatus[key] ?? 0}
              </span>
            ))}
          </div>

          {/* Barras por dia (mesmo padrão dos gráficos de relatórios: divs com
              altura proporcional, sem lib de gráfico) */}
          <div>
            <p className="text-xs font-semibold text-dark-800">Sessões por dia</p>
            {perDay.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-400">Sem dados no período.</p>
            ) : (
              <div className="mt-2 flex h-28 items-stretch gap-1">
                {perDay.map((day) => {
                  const height =
                    maxStarted === 0 ? 0 : Math.max((day.started / maxStarted) * 100, day.started > 0 ? 4 : 0)
                  const label = new Date(`${day.date}T00:00:00`).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                  })
                  return (
                    <div
                      key={day.date}
                      className="flex min-w-0 flex-1 flex-col items-center gap-1"
                      title={`${label}: ${day.started} iniciadas · ${day.completed} concluídas · ${day.failed} falhas`}
                    >
                      <div className="flex w-full flex-1 items-end justify-center">
                        <div
                          className="w-full max-w-4 rounded-t-sm bg-brand-500"
                          style={{ height: `${height}%` }}
                          role="img"
                          aria-label={`${label}: ${day.started} sessões`}
                        />
                      </div>
                      <span className="w-full truncate text-center text-[9px] text-neutral-400">{label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
