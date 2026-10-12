import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Cake,
  Check,
  Clock,
  Copy,
  Hourglass,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Plus,
  Send,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Webhook,
  Workflow,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getSpeedPolicy, canCreateAutomation, formatAutomationLimit } from '@naia/entitlements'
import {
  createAutomation,
  deleteAutomation,
  fetchAutomations,
  fetchConnections,
  toggleAutomation,
  updateAutomation,
  type AutomationPayload,
  type AutomationStepInput,
} from '../../../lib/actions'
import { Button, Card, EmptyState, ErrorNote, PageHeader, StatusBadge, Switch } from '../../../components/ui'
import { TIMEZONES } from '../../../components/campaign-wizard/types'
import { createHeadConfig } from '~/lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/automations')({ head: () => createHeadConfig('Automações — Naia Campanhas'),
  loader: async ({ params }) => {
    const [automations, connections] = await Promise.all([
      fetchAutomations({ data: params.workspaceId }),
      fetchConnections({ data: params.workspaceId }),
    ])
    return { automations, connections }
  },
  component: AutomationsPage,
})

type AutomationType = 'birthday' | 'webhook' | 'tag_added' | 'contact_created'

type AutomationRow = {
  id: string
  name: string
  type: AutomationType
  active: boolean
  sendTime: string
  timezone: string
  contentJson: string
  stepsJson: string
  stopOnTagsJson: string
  speedJson: string
  lastEvaluatedDate: string | null
  lastResultJson: string
  triggerTag: string | null
  webhookUrl: string | null
  activeEnrollments: number
  connections: Array<{ id: string; name: string; channel: string; status: string }>
}

type StepForm = {
  id: string
  action: 'message' | 'delay' | 'add_tag'
  content: Array<{ body: string; mediaAssetIds?: string[] }>
  delayHours: number
  tag: string
}

type FormState = {
  name: string
  type: AutomationType
  connectionIds: string[]
  bodies: string[]
  steps: StepForm[]
  stopOnTags: string[]
  triggerTag: string
  sendTime: string
  timezone: string
  speedPreset: 'lento' | 'medio' | 'rapido' | 'manual'
}

const TRIGGERS: Record<AutomationType, { icon: LucideIcon; label: string; description: string }> = {
  birthday: { icon: Cake, label: 'Aniversário', description: 'Todo dia, para quem faz aniversário' },
  webhook: { icon: Webhook, label: 'Webhook externo', description: 'Carrinho abandonado, checkout, seu sistema' },
  tag_added: { icon: Tag, label: 'Tag adicionada', description: 'Quando o contato ganha uma tag' },
  contact_created: { icon: UserPlus, label: 'Novo contato', description: 'Boas-vindas a quem entra na base' },
}

function stepId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function messageStep(body: string): StepForm {
  return { id: stepId(), action: 'message', content: [{ body }], delayHours: 24, tag: '' }
}

function emptyForm(type: AutomationType = 'birthday'): FormState {
  const base: FormState = {
    name: 'Aniversário dos contatos',
    type,
    connectionIds: [],
    bodies: ['Feliz aniversário, {{nome}}! 🎉'],
    steps: [],
    stopOnTags: [],
    triggerTag: '',
    sendTime: '09:00',
    timezone: 'America/Sao_Paulo',
    speedPreset: 'medio',
  }
  if (type === 'webhook') {
    return {
      ...base,
      name: 'Carrinho abandonado',
      steps: [
        messageStep('Oi {{nome}}! Vi que você deixou itens no carrinho 🛒 Finalize por aqui: {{cart_url}}'),
        { id: stepId(), action: 'delay', content: [{ body: '' }], delayHours: 24, tag: '' },
        messageStep('{{nome}}, seu carrinho ainda está te esperando! Finalize hoje e ganhe 10% off com o cupom VOLTEI10: {{cart_url}}'),
      ],
      stopOnTags: ['comprou'],
    }
  }
  if (type === 'tag_added') {
    return { ...base, name: 'Sequência da tag', steps: [messageStep('Oi {{nome}}! Tenho uma condição especial pra você.')] }
  }
  if (type === 'contact_created') {
    return { ...base, name: 'Boas-vindas', steps: [messageStep('Bem-vindo, {{nome}}! 👋 Que bom ter você por aqui.')] }
  }
  return base
}

function parseJsonArray<T>(json: string): T[] {
  try {
    const value = JSON.parse(json)
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

function formFromAutomation(a: AutomationRow): FormState {
  let bodies: string[] = ['']
  const content = parseJsonArray<{ body?: string }>(a.contentJson)
  if (content.length > 0) bodies = content.map((c) => c.body ?? '')

  const rawSteps = parseJsonArray<AutomationStepInput>(a.stepsJson)
  let steps: StepForm[] = rawSteps.map((s) => ({
    id: s.id || stepId(),
    action: s.action,
    content: s.content && s.content.length > 0 ? s.content : [{ body: '' }],
    delayHours: s.delayHours ?? 24,
    tag: s.tag ?? '',
  }))
  if (a.type !== 'birthday' && steps.length === 0 && content.length > 0) {
    steps = [{ id: stepId(), action: 'message', content: content.map((c) => ({ body: c.body ?? '' })), delayHours: 24, tag: '' }]
  }

  let speedPreset: FormState['speedPreset'] = 'medio'
  try {
    const s = JSON.parse(a.speedJson)
    if (s?.preset) speedPreset = s.preset
  } catch {
  }
  return {
    name: a.name,
    type: a.type,
    connectionIds: a.connections.map((c) => c.id),
    bodies,
    steps,
    stopOnTags: parseJsonArray<string>(a.stopOnTagsJson),
    triggerTag: a.triggerTag ?? '',
    sendTime: a.sendTime,
    timezone: a.timezone,
    speedPreset,
  }
}

function describeLastRun(a: AutomationRow): string | null {
  let result: { matched?: number; campaignId?: string; skipReason?: string } = {}
  try {
    result = JSON.parse(a.lastResultJson)
  } catch {
    return null
  }
  if (a.type === 'birthday') {
    if (!a.lastEvaluatedDate) return null
    const today = new Date().toISOString().slice(0, 10)
    const when = a.lastEvaluatedDate === today ? 'Hoje' : a.lastEvaluatedDate.split('-').reverse().join('/')
    if (result.skipReason) return `${when}: ${result.skipReason}`
    if (!result.matched) return `${when}: nenhum aniversariante`
    return `${when}: ${result.matched} aniversariante${result.matched === 1 ? '' : 's'}${result.campaignId ? ' → campanha criada' : ''}`
  }
  if (result.skipReason) return `Último disparo: ${result.skipReason}`
  return null
}

const SPEED_LABELS: Record<string, string> = { lento: 'Lento', medio: 'Médio', rapido: 'Rápido', manual: 'Manual' }

function speedLabel(speedJson: string): string {
  try {
    return SPEED_LABELS[JSON.parse(speedJson)?.preset] ?? 'Médio'
  } catch {
    return 'Médio'
  }
}

function TagChipsInput({
  value,
  onChange,
  placeholder,
  inputId,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  inputId?: string
}) {
  const [draft, setDraft] = useState('')

  function commit() {
    const tag = draft.trim().replace(/,+$/, '')
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 py-1.5 focus-within:border-brand-500">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
          <Tag size={10} aria-hidden="true" />
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-brand-500 transition-colors hover:text-brand-700"
            aria-label={`Remover tag ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-24 flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-neutral-400"
      />
    </div>
  )
}

function AddStepRow({ onAdd }: { onAdd: (action: StepForm['action']) => void }) {
  const options: Array<{ action: StepForm['action']; icon: LucideIcon; label: string }> = [
    { action: 'message', icon: MessageSquareText, label: 'Mensagem' },
    { action: 'delay', icon: Hourglass, label: 'Espera' },
    { action: 'add_tag', icon: Tag, label: 'Tag' },
  ]
  return (
    <div className="relative flex items-center gap-1.5 py-1 pl-12">
      {options.map((opt) => (
        <button
          key={opt.action}
          type="button"
          onClick={() => onAdd(opt.action)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2.5 py-1 text-[11px] font-bold text-neutral-500 transition duration-150 ease-out hover:border-brand-500 hover:text-brand-600 active:scale-[0.97]"
        >
          <Plus size={11} aria-hidden="true" />
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={copied ? Check : Copy}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Copiada!' : label}
    </Button>
  )
}

const WEBHOOK_EXAMPLE = `{
  "contact": { "phone": "5511999998888", "name": "Ana" },
  "variables": { "cart_url": "https://loja.com/cart/abc123" }
}`

function AutomationPaywall({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white">
            <Workflow size={20} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-bold text-dark-800">Automações disponíveis a partir do plano Pro</h3>
            <p className="mt-0.5 text-sm text-neutral-600 leading-relaxed max-w-xl">
              Recupere carrinhos abandonados, dê boas-vindas automáticas a cada contato novo e lembre aniversários
              sem apertar botão. Disponível no Pro e ilimitado no Scale.
            </p>
          </div>
        </div>
        <a
          href={`/${workspaceId}/billing`}
          className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md bg-brand-500 text-sm font-semibold text-white hover:bg-brand-600 shadow-xs transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] shrink-0"
        >
          Fazer upgrade para o Pro
          <Send size={14} aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}

function AutomationsPage() {
  const { automations, connections } = Route.useLoaderData()
  const { workspaceId } = Route.useParams()
  const { entitlements } = useLoaderData({ from: '/_app/$workspaceId' })
  const router = useRouter()

  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policy = getSpeedPolicy(entitlements?.tier ?? 'free')
  const activeConnections = connections.filter((c) => c.status === 'active')
  const rows = automations as AutomationRow[]
  const editingRow = editing && editing !== 'new' ? rows.find((a) => a.id === editing) : undefined

  const automationLimit = entitlements?.automations ?? 0
  const activeCount = rows.filter((a) => a.active).length
  const allowsAutomations = automationLimit !== 0
  const atAutomationLimit = allowsAutomations && automationLimit > 0 && activeCount >= automationLimit
  const canAddNew = allowsAutomations && !atAutomationLimit

  function openNew() {
    setForm(emptyForm('webhook'))
    setEditing('new')
    setError(null)
  }

  function openEdit(a: AutomationRow) {
    setForm(formFromAutomation(a))
    setEditing(a.id)
    setError(null)
  }

  function setSteps(steps: StepForm[]) {
    setForm((f) => ({ ...f, steps }))
  }

  function addStep(index: number, action: StepForm['action']) {
    const step: StepForm =
      action === 'message'
        ? messageStep('')
        : { id: stepId(), action, content: [{ body: '' }], delayHours: 24, tag: '' }
    setSteps([...form.steps.slice(0, index), step, ...form.steps.slice(index)])
  }

  function updateStep(id: string, patch: Partial<StepForm>) {
    setSteps(form.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  async function save() {
    if (!form.name.trim()) return setError('Dê um nome à automação.')
    if (form.connectionIds.length === 0) return setError('Selecione ao menos uma conexão.')

    const payload: Omit<AutomationPayload, 'workspaceId'> = {
      name: form.name.trim(),
      type: form.type,
      connectionIds: form.connectionIds,
      sendTime: form.sendTime,
      timezone: form.timezone,
      speed: { preset: form.speedPreset },
    }

    if (form.type === 'birthday') {
      const bodies = form.bodies.map((b) => b.trim()).filter(Boolean)
      if (bodies.length === 0) return setError('Escreva ao menos uma mensagem.')
      payload.content = bodies.map((body) => ({ body }))
    } else {
      if (form.type === 'tag_added' && !form.triggerTag.trim()) {
        return setError('Informe a tag que dispara a automação.')
      }
      const steps: AutomationStepInput[] = []
      for (const step of form.steps) {
        if (step.action === 'message') {
          const content = step.content.filter((v) => v.body.trim())
          if (content.length === 0) return setError('Todo passo de mensagem precisa de texto.')
          steps.push({ id: step.id, action: 'message', content })
        } else if (step.action === 'delay') {
          if (!step.delayHours || step.delayHours < 1) return setError('Todo passo de espera precisa de horas (mínimo 1).')
          steps.push({ id: step.id, action: 'delay', delayHours: step.delayHours })
        } else {
          if (!step.tag.trim()) return setError('Todo passo de tag precisa do nome da tag.')
          steps.push({ id: step.id, action: 'add_tag', tag: step.tag.trim() })
        }
      }
      if (!steps.some((s) => s.action === 'message')) return setError('Adicione ao menos um passo de mensagem.')
      payload.steps = steps
      payload.stopOnTags = form.stopOnTags
      if (form.type === 'tag_added') payload.triggerTag = form.triggerTag.trim()
    }

    setBusy(true)
    setError(null)
    const result =
      editing === 'new'
        ? await createAutomation({ data: { workspaceId, ...payload } })
        : await updateAutomation({ data: { workspaceId, automationId: editing!, ...payload } })
    setBusy(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
      return
    }
    const createdId =
      editing === 'new' && result && 'automation' in result ? (result.automation as { id?: string } | undefined)?.id : undefined
    if (form.type === 'webhook' && createdId) {
      setEditing(createdId)
    } else {
      setEditing(null)
    }
    await router.invalidate()
  }

  async function handleToggle(automationId: string) {
    await toggleAutomation({ data: { workspaceId, automationId } })
    await router.invalidate()
  }

  async function handleDelete(automationId: string) {
    if (!confirm('Excluir esta automação? As campanhas já criadas por ela são mantidas e a régua em andamento é interrompida.')) return
    await deleteAutomation({ data: { workspaceId, automationId } })
    if (editing === automationId) setEditing(null)
    await router.invalidate()
  }

  const isBirthday = form.type === 'birthday'

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Automações
            {allowsAutomations && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  atAutomationLimit
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-brand-50 text-brand-600 border border-brand-200'
                }`}
              >
                <Workflow size={11} aria-hidden="true" />
                {activeCount} de {formatAutomationLimit(entitlements)} ativas
              </span>
            )}
          </span>
        }
        subtitle="Gatilhos que disparam mensagens sozinhos: aniversário, carrinho abandonado, tag ou contato novo."
      >
        {canAddNew ? (
          <Button className="w-full sm:w-auto" icon={Plus} onClick={openNew}>Nova automação</Button>
        ) : atAutomationLimit ? (
          <a
            href={`/${workspaceId}/billing`}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md bg-brand-500 text-sm font-semibold text-white hover:bg-brand-600 shadow-xs transition-[transform,background-color] duration-150 ease-out active:scale-[0.97]"
          >
            Comprar automação extra
            <Send size={14} aria-hidden="true" />
          </a>
        ) : null}
      </PageHeader>

      {!allowsAutomations && <div className="mb-5"><AutomationPaywall workspaceId={workspaceId} /></div>}

      {rows.length === 0 && editing === null ? (
        <EmptyState
          icon={Webhook}
          title="Recupere carrinhos abandonados, dê boas-vindas a cada contato novo e lembre aniversários sem apertar botão. Escolha o gatilho e a sequência dispara sozinha."
          action={
            canAddNew ? (
              <Button icon={Plus} onClick={openNew}>Criar primeira automação</Button>
            ) : !allowsAutomations ? (
              <a
                href={`/${workspaceId}/billing`}
                className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md bg-brand-500 text-sm font-semibold text-white hover:bg-brand-600 shadow-xs transition-[transform,background-color] duration-150 ease-out active:scale-[0.97]"
              >
                Fazer upgrade para o Pro
                <Send size={14} aria-hidden="true" />
              </a>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((automation) => {
            const trigger = TRIGGERS[automation.type] ?? TRIGGERS.birthday
            const TriggerIcon = trigger.icon
            const lastRun = describeLastRun(automation)
            return (
              <Card key={automation.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-600">
                      <TriggerIcon size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-dark-800">{automation.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span>{trigger.label}{automation.type === 'tag_added' && automation.triggerTag ? `: ${automation.triggerTag}` : ''}</span>
                        {automation.type === 'birthday' && (
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} aria-hidden="true" />
                            Envia às {automation.sendTime}
                          </span>
                        )}
                        {automation.activeEnrollments > 0 && (
                          <span className="inline-flex items-center gap-1 font-medium text-brand-600">
                            <Users size={11} aria-hidden="true" />
                            {automation.activeEnrollments} na sequência
                          </span>
                        )}
                        <span>{speedLabel(automation.speedJson)}</span>
                        {automation.connections.map((conn) => (
                          <span key={conn.id} className="inline-flex items-center gap-1">
                            {conn.channel === 'telegram' ? (
                              <Send size={11} className="text-sky-500" aria-hidden="true" />
                            ) : (
                              <MessageCircle size={11} className="text-emerald-500" aria-hidden="true" />
                            )}
                            {conn.name}
                            {conn.status !== 'active' && <StatusBadge status={conn.status} />}
                          </span>
                        ))}
                      </p>
                      {lastRun && <p className="mt-1 text-xs text-neutral-400">{lastRun}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {automation.webhookUrl && <CopyButton text={automation.webhookUrl} label="Copiar URL do webhook" />}
                    <Switch
                      checked={automation.active}
                      onChange={() => handleToggle(automation.id)}
                      aria-label={automation.active ? 'Desativar automação' : 'Ativar automação'}
                    />
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => openEdit(automation)}>
                      Editar
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDelete(automation.id)}
                      className="grid size-8 place-items-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-error-500/10 hover:text-error-500"
                      aria-label={`Excluir ${automation.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {editing !== null && (
        <Card className="mt-5 p-5">
          <div className="mb-4 flex items-center justify-between border-b border-neutral-100 pb-3">
            <h2 className="text-base font-bold text-dark-800">
              {editing === 'new' ? 'Nova automação' : 'Editar automação'}
            </h2>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-neutral-400 transition-colors hover:text-dark-800"
              aria-label="Fechar edição"
            >
              <X size={16} />
            </button>
          </div>

          {/* Gatilho: escolha na criação; fixo na edição */}
          <div className="mb-5">
            <span className="mb-1.5 block text-sm font-medium text-dark-800">Quando iniciar</span>
            {editing === 'new' ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Gatilho da automação">
                {(Object.keys(TRIGGERS) as AutomationType[]).map((type) => {
                  const trigger = TRIGGERS[type]
                  const TriggerIcon = trigger.icon
                  const selected = form.type === type
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm(emptyForm(type))}
                      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition duration-150 ease-out active:scale-[0.98] ${
                        selected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-md ${
                          selected ? 'bg-brand-500 text-white' : 'bg-brand-100 text-brand-600'
                        }`}
                      >
                        <TriggerIcon size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-dark-800">{trigger.label}</span>
                        <span className="block text-[11px] leading-snug text-neutral-500">{trigger.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-lg bg-brand-100 px-3 py-1.5 text-sm font-medium text-brand-700">
                {(() => {
                  const TriggerIcon = TRIGGERS[form.type].icon
                  return <TriggerIcon size={14} aria-hidden="true" />
                })()}
                {TRIGGERS[form.type].label}
              </span>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label htmlFor="auto-name">Nome</label>
                <input
                  id="auto-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              {form.type === 'tag_added' && (
                <div>
                  <label htmlFor="auto-trigger-tag">Tag que dispara</label>
                  <input
                    id="auto-trigger-tag"
                    type="text"
                    value={form.triggerTag}
                    onChange={(e) => setForm({ ...form, triggerTag: e.target.value })}
                    placeholder="ex: lead-quente"
                  />
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Sempre que um contato ganhar esta tag, ele entra na sequência.
                  </p>
                </div>
              )}

              <div>
                <span className="mb-1 block text-sm font-medium text-dark-800">Conexões de envio</span>
                {activeConnections.length === 0 ? (
                  <p className="text-xs text-neutral-500">Nenhuma conexão ativa. Conecte um canal primeiro.</p>
                ) : (
                  <div className="space-y-1.5">
                    {activeConnections.map((conn) => {
                      const selected = form.connectionIds.includes(conn.id)
                      return (
                        <label key={conn.id} className="flex cursor-pointer items-center gap-2 text-sm text-dark-800">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setForm({
                                ...form,
                                connectionIds: selected
                                  ? form.connectionIds.filter((id) => id !== conn.id)
                                  : [...form.connectionIds, conn.id],
                              })
                            }
                            className="size-4 accent-brand-500"
                          />
                          {conn.channel === 'telegram' ? (
                            <Send size={13} className="text-sky-500" aria-hidden="true" />
                          ) : (
                            <MessageCircle size={13} className="text-emerald-500" aria-hidden="true" />
                          )}
                          {conn.name}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {isBirthday && (
                  <div>
                    <label htmlFor="auto-time">Horário do envio</label>
                    <input
                      id="auto-time"
                      type="time"
                      value={form.sendTime}
                      onChange={(e) => setForm({ ...form, sendTime: e.target.value })}
                      className="h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="auto-speed">Velocidade</label>
                  <select
                    id="auto-speed"
                    value={form.speedPreset}
                    onChange={(e) => setForm({ ...form, speedPreset: e.target.value as FormState['speedPreset'] })}
                  >
                    {policy.allowedPresets.filter((p) => p !== 'manual').map((preset) => (
                      <option key={preset} value={preset}>{SPEED_LABELS[preset]}</option>
                    ))}
                  </select>
                </div>
                {!isBirthday && (
                  <div>
                    <label htmlFor="auto-tz">Fuso horário</label>
                    <select
                      id="auto-tz"
                      value={form.timezone}
                      onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {isBirthday && (
                <div>
                  <label htmlFor="auto-tz">Fuso horário</label>
                  <select
                    id="auto-tz"
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {!isBirthday && (
                <div>
                  <label htmlFor="auto-stop-tags">Parar se o contato ganhar a tag</label>
                  <TagChipsInput
                    inputId="auto-stop-tags"
                    value={form.stopOnTags}
                    onChange={(stopOnTags) => setForm({ ...form, stopOnTags })}
                    placeholder="Digite a tag e aperte Enter (ex: comprou)"
                  />
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Freio de mão: se o contato ganhar uma destas tags, a sequência dele para na hora.
                  </p>
                </div>
              )}

              {form.type === 'webhook' && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-dark-800">
                    <Webhook size={13} className="text-brand-600" aria-hidden="true" />
                    URL do webhook
                  </p>
                  {editingRow?.webhookUrl ? (
                    <>
                      <code className="mt-1.5 block truncate rounded bg-neutral-0 px-2 py-1.5 font-mono text-[11px] text-neutral-600">
                        {editingRow.webhookUrl}
                      </code>
                      <div className="mt-1.5">
                        <CopyButton text={editingRow.webhookUrl} label="Copiar URL" />
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-neutral-500">
                      Salve a automação para gerar a URL exclusiva dela.
                    </p>
                  )}
                  <p className="mt-2 text-[11px] font-medium text-neutral-500">Envie um POST com JSON neste formato:</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-neutral-0 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-neutral-600">{WEBHOOK_EXAMPLE}</pre>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                    Tudo que vier em <code className="font-mono">variables</code> vira variável na mensagem, como{' '}
                    <code className="font-mono">{'{{cart_url}}'}</code>.
                  </p>
                </div>
              )}
            </div>

            {isBirthday ? (
              <div>
                <span className="mb-1 block text-sm font-medium text-dark-800">Mensagens (alternadas entre aniversariantes)</span>
                <div className="space-y-2">
                  {form.bodies.map((body, index) => (
                    <div key={index} className="relative">
                      <textarea
                        value={body}
                        onChange={(e) =>
                          setForm({ ...form, bodies: form.bodies.map((b, i) => (i === index ? e.target.value : b)) })
                        }
                        rows={3}
                        placeholder={'Feliz aniversário, {{nome}}! 🎉'}
                      />
                      {form.bodies.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, bodies: form.bodies.filter((_, i) => i !== index) })}
                          className="absolute right-2 top-2 grid size-6 place-items-center rounded text-neutral-400 transition-colors hover:text-error-500"
                          aria-label={`Remover mensagem ${index + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {form.bodies.length < 4 && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, bodies: [...form.bodies, ''] })}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700"
                  >
                    <Plus size={13} aria-hidden="true" />
                    Adicionar variação
                  </button>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  Use {'{{nome}}'} para personalizar. A automação verifica o campo de nascimento dos contatos todos os
                  dias e cria uma campanha só com os aniversariantes. Contatos com opt-out ficam de fora.
                </p>
              </div>
            ) : (
              <div>
                <span className="mb-1 block text-sm font-medium text-dark-800">Sequência de passos</span>
                <div className="relative">
                  {/* trilho vertical da timeline */}
                  <span className="absolute bottom-4 left-5 top-4 w-px bg-neutral-200" aria-hidden="true" />

                  {form.steps.map((step, index) => (
                    <div key={step.id}>
                      {index > 0 && <AddStepRow onAdd={(action) => addStep(index, action)} />}

                      {step.action === 'message' ? (
                        <div className="relative flex items-start gap-3">
                          <span className="relative z-10 mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600 ring-4 ring-neutral-0">
                            <MessageSquareText size={16} aria-hidden="true" />
                          </span>
                          <div className="relative min-w-0 flex-1 rounded-lg border border-neutral-200 p-2.5">
                            <textarea
                              value={step.content[0]?.body ?? ''}
                              onChange={(e) =>
                                updateStep(step.id, {
                                  content: [{ ...step.content[0], body: e.target.value }, ...step.content.slice(1)],
                                })
                              }
                              rows={3}
                              placeholder={'Oi {{nome}}! ...'}
                              className="w-full resize-y border-0 bg-transparent p-0 text-sm outline-none placeholder:text-neutral-400"
                            />
                            <button
                              type="button"
                              onClick={() => setSteps(form.steps.filter((s) => s.id !== step.id))}
                              className="absolute right-2 top-2 grid size-6 place-items-center rounded text-neutral-400 transition-colors hover:text-error-500"
                              aria-label="Remover passo de mensagem"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ) : step.action === 'delay' ? (
                        <div className="relative flex items-center gap-3">
                          <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600 ring-4 ring-neutral-0">
                            <Hourglass size={15} aria-hidden="true" />
                          </span>
                          <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 py-1.5 pl-3 pr-1.5 text-sm text-dark-800">
                            Aguardar
                            <input
                              type="number"
                              min={1}
                              value={step.delayHours}
                              onChange={(e) => updateStep(step.id, { delayHours: Math.max(1, Number(e.target.value) || 1) })}
                              className="h-7 w-16 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-center text-sm"
                              aria-label="Horas de espera"
                            />
                            horas
                            <span className="text-[11px] text-neutral-400">{step.delayHours >= 24 ? `≈ ${Math.round(step.delayHours / 24)} dia${step.delayHours >= 48 ? 's' : ''}` : ''}</span>
                            <button
                              type="button"
                              onClick={() => setSteps(form.steps.filter((s) => s.id !== step.id))}
                              className="grid size-6 place-items-center rounded-full text-neutral-400 transition-colors hover:text-error-500"
                              aria-label="Remover espera"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="relative flex items-center gap-3">
                          <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600 ring-4 ring-neutral-0">
                            <Tag size={15} aria-hidden="true" />
                          </span>
                          <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 py-1.5 pl-3 pr-1.5 text-sm text-dark-800">
                            Adicionar tag
                            <input
                              type="text"
                              value={step.tag}
                              onChange={(e) => updateStep(step.id, { tag: e.target.value })}
                              placeholder="ex: recebeu-oferta"
                              className="h-7 w-36 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm"
                              aria-label="Nome da tag"
                            />
                            <button
                              type="button"
                              onClick={() => setSteps(form.steps.filter((s) => s.id !== step.id))}
                              className="grid size-6 place-items-center rounded-full text-neutral-400 transition-colors hover:text-error-500"
                              aria-label="Remover passo de tag"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <AddStepRow onAdd={(action) => addStep(form.steps.length, action)} />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  A sequência roda passo a passo para cada contato que entrar. Use {'{{nome}}'} e as variáveis do
                  gatilho na mensagem. Contatos com opt-out nunca recebem.
                </p>
              </div>
            )}
          </div>

          {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

          <div className="mt-5 flex justify-end gap-2 border-t border-neutral-100 pt-4">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button loading={busy} onClick={save}>
              {editing === 'new' ? 'Criar automação' : 'Salvar alterações'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
