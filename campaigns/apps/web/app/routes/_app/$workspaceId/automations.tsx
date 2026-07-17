import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Cake,
  Clock,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { getSpeedPolicy } from '@naia/entitlements'
import {
  createAutomation,
  deleteAutomation,
  fetchAutomations,
  fetchConnections,
  toggleAutomation,
  updateAutomation,
  type AutomationPayload,
} from '../../../lib/actions'
import { Button, Card, EmptyState, ErrorNote, PageHeader, StatusBadge } from '../../../components/ui'
import { ToggleRow } from '../../../components/campaign-wizard/step-settings'
import { TIMEZONES } from '../../../components/campaign-wizard/types'

export const Route = createFileRoute('/_app/$workspaceId/automations')({
  loader: async ({ params }) => {
    const [automations, connections] = await Promise.all([
      fetchAutomations({ data: params.workspaceId }),
      fetchConnections({ data: params.workspaceId }),
    ])
    return { automations, connections }
  },
  component: AutomationsPage,
})

type AutomationRow = {
  id: string
  name: string
  type: string
  active: boolean
  sendTime: string
  timezone: string
  contentJson: string
  speedJson: string
  lastEvaluatedDate: string | null
  lastResultJson: string
  connections: Array<{ id: string; name: string; channel: string; status: string }>
}

type FormState = {
  name: string
  connectionIds: string[]
  bodies: string[]
  sendTime: string
  timezone: string
  speedPreset: 'lento' | 'medio' | 'rapido' | 'manual'
}

function emptyForm(): FormState {
  return {
    name: 'Aniversário dos contatos',
    connectionIds: [],
    bodies: ['Feliz aniversário, {{nome}}! 🎉'],
    sendTime: '09:00',
    timezone: 'America/Sao_Paulo',
    speedPreset: 'medio',
  }
}

function formFromAutomation(a: AutomationRow): FormState {
  let bodies: string[] = ['']
  try {
    const content = JSON.parse(a.contentJson)
    if (Array.isArray(content) && content.length > 0) {
      bodies = content.map((c: { body?: string }) => c.body ?? '')
    }
  } catch {
    // conteúdo ilegível → começa vazio
  }
  let speedPreset: FormState['speedPreset'] = 'medio'
  try {
    const s = JSON.parse(a.speedJson)
    if (s?.preset) speedPreset = s.preset
  } catch {
    // velocidade ilegível → padrão
  }
  return {
    name: a.name,
    connectionIds: a.connections.map((c) => c.id),
    bodies,
    sendTime: a.sendTime,
    timezone: a.timezone,
    speedPreset,
  }
}

function describeLastRun(a: AutomationRow): string | null {
  if (!a.lastEvaluatedDate) return null
  let result: { matched?: number; campaignId?: string; skipReason?: string } = {}
  try {
    result = JSON.parse(a.lastResultJson)
  } catch {
    return null
  }
  const today = new Date().toISOString().slice(0, 10)
  const when = a.lastEvaluatedDate === today ? 'Hoje' : a.lastEvaluatedDate.split('-').reverse().join('/')
  if (result.skipReason) return `${when}: ${result.skipReason}`
  if (!result.matched) return `${when}: nenhum aniversariante`
  return `${when}: ${result.matched} aniversariante${result.matched === 1 ? '' : 's'}${result.campaignId ? ' → campanha criada' : ''}`
}

const SPEED_LABELS: Record<string, string> = { lento: 'Lento', medio: 'Médio', rapido: 'Rápido', manual: 'Manual' }

function speedLabel(speedJson: string): string {
  try {
    return SPEED_LABELS[JSON.parse(speedJson)?.preset] ?? 'Médio'
  } catch {
    return 'Médio'
  }
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

  function openNew() {
    setForm(emptyForm())
    setEditing('new')
    setError(null)
  }

  function openEdit(a: AutomationRow) {
    setForm(formFromAutomation(a))
    setEditing(a.id)
    setError(null)
  }

  async function save() {
    const bodies = form.bodies.map((b) => b.trim()).filter(Boolean)
    if (!form.name.trim()) return setError('Dê um nome à automação.')
    if (form.connectionIds.length === 0) return setError('Selecione ao menos uma conexão.')
    if (bodies.length === 0) return setError('Escreva ao menos uma mensagem.')

    setBusy(true)
    setError(null)
    const payload: Omit<AutomationPayload, 'workspaceId'> = {
      name: form.name.trim(),
      type: 'birthday',
      connectionIds: form.connectionIds,
      content: bodies.map((body) => ({ body })),
      sendTime: form.sendTime,
      timezone: form.timezone,
      speed: { preset: form.speedPreset },
    }
    const result =
      editing === 'new'
        ? await createAutomation({ data: { workspaceId, ...payload } })
        : await updateAutomation({ data: { workspaceId, automationId: editing!, ...payload } })
    setBusy(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
      return
    }
    setEditing(null)
    await router.invalidate()
  }

  async function handleToggle(automationId: string) {
    await toggleAutomation({ data: { workspaceId, automationId } })
    await router.invalidate()
  }

  async function handleDelete(automationId: string) {
    if (!confirm('Excluir esta automação? As campanhas já criadas por ela são mantidas.')) return
    await deleteAutomation({ data: { workspaceId, automationId } })
    if (editing === automationId) setEditing(null)
    await router.invalidate()
  }

  return (
    <div>
      <PageHeader
        title="Automações"
        subtitle="Gatilhos que criam e disparam campanhas sozinhos — hoje, aniversário do contato."
      >
        <Button icon={Plus} onClick={openNew}>Nova automação</Button>
      </PageHeader>

      {(automations as AutomationRow[]).length === 0 && editing === null ? (
        <EmptyState
          icon={Cake}
          title="Nenhuma automação criada. Configure uma mensagem de aniversário e ela vira campanha automaticamente no dia de cada contato."
          action={<Button icon={Plus} onClick={openNew}>Criar automação de aniversário</Button>}
        />
      ) : (
        <div className="space-y-3">
          {(automations as AutomationRow[]).map((automation) => {
            const lastRun = describeLastRun(automation)
            return (
              <Card key={automation.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-600">
                      <Cake size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-dark-800">{automation.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} aria-hidden="true" />
                          Envia às {automation.sendTime}
                        </span>
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
                    <button
                      type="button"
                      role="switch"
                      aria-checked={automation.active}
                      aria-label={automation.active ? 'Desativar automação' : 'Ativar automação'}
                      onClick={() => handleToggle(automation.id)}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
                        automation.active ? 'bg-brand-500' : 'bg-neutral-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow-2xs transition-transform duration-200 ease-out ${
                          automation.active ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                        aria-hidden="true"
                      />
                    </button>
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
              {editing === 'new' ? 'Nova automação de aniversário' : 'Editar automação'}
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

              <div>
                <span className="mb-1 block text-sm font-medium text-dark-800">Conexões de envio</span>
                {activeConnections.length === 0 ? (
                  <p className="text-xs text-neutral-500">Nenhuma conexão ativa — conecte um canal primeiro.</p>
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
              </div>

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
            </div>

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
                dias e cria uma campanha só com os aniversariantes — contatos com opt-out ficam de fora.
              </p>
            </div>
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
