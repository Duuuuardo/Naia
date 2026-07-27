import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Info, RotateCcw, SendHorizontal } from 'lucide-react'
import { Button, Modal } from '../ui'
import type { BotFlowDefinition, BotFlowNode, JsonValue } from '../../lib/inbox-session'

// ─── Simulador do fluxo (100% client-side) ───────────────────────────────────
// Executa a definition do bot no navegador: nós de mensagem viram bolhas,
// menu/buttons/collect_input/condition esperam a resposta do usuário (mesmas
// regras da engine: menu numérico 1-based → opt-N; contains/equals
// case-insensitive com trim), delay vira espera real curta (cap 2 s) e nós de
// ação (assign_queue, assign_agent, manage_tag, webhook, close_conversation)
// viram cards informativos — nada é enviado ou executado de verdade.

type SimEntry =
  | { id: number; kind: 'bot'; text: string }
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'system'; text: string }
  | { id: number; kind: 'action'; title: string; description: string }

// Entrada sem id (Omit<union> não distribui — por isso o tipo explícito).
type SimEntryInput =
  | { kind: 'bot'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'action'; title: string; description: string }

type WaitRequest =
  | { type: 'menu' }
  | { type: 'buttons'; options: { id: string; label: string }[]; hasDefault: boolean }
  | { type: 'input'; validation: string }

type UserAnswer = { input: string; optionId?: string }

function str(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function strList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function buttonOptions(value: JsonValue | undefined): { id: string; label: string }[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is { id: string; label: string } =>
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      typeof (v as { id?: unknown }).id === 'string' &&
      typeof (v as { label?: unknown }).label === 'string',
  )
}

// Interpolação {{variavel}} com os valores coletados durante a simulação.
function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (raw, name: string) => vars[name] ?? raw)
}

// Mesma comparação da engine: case-insensitive com trim.
function matches(operator: string, actual: string, expected: string): boolean {
  const a = actual.trim().toLowerCase()
  const b = expected.trim().toLowerCase()
  return operator === 'equals' ? a === b : a.includes(b)
}

function validationLabel(validation: string): string {
  return { number: 'número', email: 'e-mail', phone: 'telefone' }[validation] ?? 'texto'
}

function isValidInput(validation: string, input: string): boolean {
  const value = input.trim()
  switch (validation) {
    case 'number':
      return value !== '' && !Number.isNaN(Number(value))
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    case 'phone':
      return /^\+?[\d\s()-]{6,}$/.test(value)
    default:
      return value.length > 0
  }
}

function delayLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return 'alguns instantes'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  if (minutes === 0) return `${secs} s`
  return secs === 0 ? `${minutes} min` : `${minutes} min ${secs} s`
}

const MAX_STEPS = 100
const SIM_DELAY_CAP_MS = 2000

export function FlowSimulator({
  open,
  onClose,
  definition,
}: {
  open: boolean
  onClose: () => void
  definition: BotFlowDefinition
}) {
  const [entries, setEntries] = useState<SimEntry[]>([])
  const [waiting, setWaiting] = useState<WaitRequest | null>(null)
  const [running, setRunning] = useState(false)
  const [draft, setDraft] = useState('')
  const nextId = useRef(0)
  // Resolver da promessa de input do usuário (um por vez).
  const resolverRef = useRef<((answer: UserAnswer) => void) | null>(null)
  // Id da execução atual — incrementar cancela a run em andamento.
  const runIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const push = useCallback((entry: SimEntryInput) => {
    nextId.current += 1
    const id = nextId.current
    setEntries((prev) => [...prev, { ...entry, id } as SimEntry])
  }, [])

  const pushRef = useRef(push)
  pushRef.current = push

  const run = useCallback(() => {
    const runId = ++runIdRef.current
    const alive = () => runIdRef.current === runId
    setEntries([])
    setWaiting(null)
    setDraft('')
    setRunning(true)

    const emit = (entry: SimEntryInput) => {
      if (alive()) pushRef.current(entry)
    }
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const started = Date.now()
        const tick = () => {
          if (!alive() || Date.now() - started >= ms) resolve()
          else setTimeout(tick, 50)
        }
        tick()
      })
    const waitUser = (request: WaitRequest) =>
      new Promise<UserAnswer>((resolve) => {
        if (!alive()) return resolve({ input: '' })
        setWaiting(request)
        resolverRef.current = resolve
      })

    const byId = new Map(definition.nodes.map((n) => [n.id, n]))
    // Edges de saída por (source, sourceHandle) — sourceHandle ausente = ''.
    const outgoing = new Map<string, string>()
    for (const edge of definition.edges) {
      const key = `${edge.source}|${edge.sourceHandle ?? ''}`
      if (!outgoing.has(key)) outgoing.set(key, edge.target)
    }
    const nextFrom = (nodeId: string, handle?: string) => outgoing.get(`${nodeId}|${handle ?? ''}`)

    void (async () => {
      const vars: Record<string, string> = {}
      const start = definition.nodes.find((n) => n.kind === 'start')
      if (!start) {
        emit({ kind: 'system', text: 'Nó de início não encontrado — a prévia não pode rodar.' })
        if (alive()) setRunning(false)
        return
      }

      let current: string | undefined = nextFrom(start.id)
      let steps = 0

      const finish = (text: string) => {
        emit({ kind: 'system', text })
        if (alive()) {
          setWaiting(null)
          resolverRef.current = null
          setRunning(false)
        }
      }

      while (current && alive()) {
        if (steps++ >= MAX_STEPS) {
          finish('Prévia interrompida: limite de etapas atingido (possível loop no fluxo).')
          return
        }
        const node: BotFlowNode | undefined = byId.get(current)
        if (!node) {
          finish('Etapa não encontrada no grafo — prévia encerrada.')
          return
        }
        const d = node.data

        switch (node.kind) {
          case 'message': {
            const text = interpolate(str(d.text), vars).trim()
            const attachment = str(d.attachmentFilename)
            if (text || attachment) {
              emit({ kind: 'bot', text: attachment ? `${text}${text ? '\n' : ''}📎 ${attachment}` : text })
            }
            current = nextFrom(node.id)
            break
          }

          case 'menu': {
            const options = strList(d.options)
            const lines = [interpolate(str(d.text), vars).trim()]
            options.forEach((option, index) => lines.push(`${index + 1}. ${interpolate(option, vars)}`))
            emit({ kind: 'bot', text: lines.filter(Boolean).join('\n') })
            const answer = await waitUser({ type: 'menu' })
            if (!alive()) return
            const n = Number.parseInt(answer.input.trim(), 10)
            if (Number.isInteger(n) && n >= 1 && n <= options.length) {
              current = nextFrom(node.id, `opt-${n - 1}`)
              if (!current) {
                finish(`A opção ${n} não está conectada a nenhuma etapa — prévia encerrada.`)
                return
              }
            } else {
              finish(`Resposta fora das opções do menu (1–${options.length}) — na prévia o fluxo não tem caminho.`)
              return
            }
            break
          }

          case 'buttons': {
            const options = buttonOptions(d.options)
            emit({ kind: 'bot', text: interpolate(str(d.text), vars).trim() || 'Escolha uma opção:' })
            const answer = await waitUser({
              type: 'buttons',
              options,
              hasDefault: nextFrom(node.id, 'default') !== undefined,
            })
            if (!alive()) return
            let handle: string | undefined = answer.optionId
            if (!handle) {
              const typed = answer.input.trim()
              const n = Number.parseInt(typed, 10)
              if (Number.isInteger(n) && n >= 1 && n <= options.length) {
                handle = options[n - 1].id
              } else {
                const byLabel = options.find((o) => matches('equals', o.label, typed))
                handle = byLabel?.id ?? 'default'
              }
            }
            current = nextFrom(node.id, handle)
            if (!current) {
              finish(
                handle === 'default'
                  ? 'Resposta fora das opções e a saída “Outra resposta” não está conectada — prévia encerrada.'
                  : 'Essa opção não está conectada a nenhuma etapa — prévia encerrada.',
              )
              return
            }
            break
          }

          case 'collect_input': {
            const validation = typeof d.validation === 'string' ? d.validation : 'text'
            const variable = str(d.variable).trim()
            for (;;) {
              emit({ kind: 'bot', text: interpolate(str(d.question), vars).trim() || 'Aguardando resposta…' })
              const answer = await waitUser({ type: 'input', validation })
              if (!alive()) return
              if (isValidInput(validation, answer.input)) {
                if (variable) vars[variable] = answer.input.trim()
                break
              }
              emit({
                kind: 'bot',
                text: `Resposta inválida (esperado: ${validationLabel(validation)}). Tente novamente.`,
              })
            }
            current = nextFrom(node.id)
            break
          }

          case 'condition': {
            const variable = str(d.variable).trim()
            const actual = variable ? (vars[variable] ?? '') : ''
            const operator = d.operator === 'equals' ? 'equals' : 'contains'
            const expected = interpolate(str(d.value), vars)
            const result = variable !== '' && matches(operator, actual, expected)
            emit({
              kind: 'system',
              text: `Condição: {{${variable || '…'}}} ${operator === 'equals' ? 'é igual a' : 'contém'} "${expected}" → ${result ? 'verdadeiro' : 'falso'}`,
            })
            current = nextFrom(node.id, result ? 'true' : 'false')
            if (!current) {
              finish(`O ramo ${result ? '“Verdadeiro”' : '“Falso”'} não está conectado — prévia encerrada.`)
              return
            }
            break
          }

          case 'delay': {
            const seconds = typeof d.seconds === 'number' ? d.seconds : 0
            const waitMs = Math.min(Math.max(seconds, 0) * 1000, SIM_DELAY_CAP_MS)
            emit({
              kind: 'system',
              text: `Aguardando ${delayLabel(seconds)}${seconds * 1000 > SIM_DELAY_CAP_MS ? ' (na prévia, no máximo 2 s)' : ''}…`,
            })
            await sleep(waitMs)
            if (!alive()) return
            current = nextFrom(node.id)
            break
          }

          case 'assign_queue':
            emit({
              kind: 'action',
              title: 'Conversa enviada para fila',
              description: `Fila: ${str(d.queueName) || 'não definida'} (prévia — nenhuma atribuição real).`,
            })
            current = nextFrom(node.id)
            break

          case 'assign_agent':
            emit({
              kind: 'action',
              title: 'Conversa atribuída a agente',
              description: `Agente: ${str(d.agentName) || 'não definido'} (prévia — nenhuma atribuição real).`,
            })
            current = nextFrom(node.id)
            break

          case 'manage_tag':
            emit({
              kind: 'action',
              title: d.action === 'remove' ? 'Tag removida' : 'Tag adicionada',
              description: `Tag: ${str(d.tagName) || str(d.tagId) || 'não definida'} (prévia — nenhuma alteração real).`,
            })
            current = nextFrom(node.id)
            break

          case 'webhook': {
            const method = d.method === 'GET' ? 'GET' : 'POST'
            const variable = str(d.saveToVariable).trim()
            emit({
              kind: 'action',
              title: `Webhook ${method}`,
              description: `${str(d.url) || 'URL não definida'}${variable ? ` — resposta salva em {{${variable}}}` : ''} (prévia — nenhuma requisição real).`,
            })
            if (variable) vars[variable] = '(resposta simulada)'
            current = nextFrom(node.id)
            break
          }

          case 'close_conversation': {
            const message = interpolate(str(d.message), vars).trim()
            if (message) emit({ kind: 'bot', text: message })
            emit({
              kind: 'action',
              title: 'Conversa resolvida',
              description: 'O bot encerra o atendimento e a conversa é resolvida (prévia — nenhuma ação real).',
            })
            finish('Fim da prévia.')
            return
          }

          case 'end':
            finish('Fluxo encerrado pelo nó Fim.')
            return

          default:
            current = nextFrom(node.id)
            break
        }
      }

      if (alive()) finish('Fim do fluxo (sem próxima etapa conectada).')
    })()
  }, [definition])

  // Inicia ao abrir; cancela ao fechar.
  useEffect(() => {
    if (open) run()
    else {
      runIdRef.current += 1
      resolverRef.current = null
      setWaiting(null)
      setRunning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Cancela a run se o componente desmontar.
  useEffect(() => () => { runIdRef.current += 1 }, [])

  // Scroll para a última entrada.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, waiting])

  function answer(input: string, optionId?: string) {
    const resolver = resolverRef.current
    if (!resolver) return
    resolverRef.current = null
    setWaiting(null)
    push({ kind: 'user', text: input })
    resolver({ input, optionId })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = draft.trim()
    if (!value || !waiting) return
    setDraft('')
    answer(value)
  }

  return (
    <Modal open={open} onClose={onClose} title="Simular fluxo">
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          Prévia do fluxo rodando só no navegador — nenhuma mensagem real é enviada e nenhuma ação é
          executada.
        </p>

        <div ref={scrollRef} className="h-96 space-y-2 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          {entries.length === 0 && (
            <p className="py-10 text-center text-xs text-neutral-400">Iniciando a prévia…</p>
          )}
          {entries.map((entry) => {
            if (entry.kind === 'system') {
              return (
                <div key={entry.id} className="flex justify-center">
                  <p className="max-w-[90%] rounded-full bg-neutral-100 px-3 py-1 text-center text-[11px] text-neutral-500">
                    {entry.text}
                  </p>
                </div>
              )
            }
            if (entry.kind === 'action') {
              return (
                <div key={entry.id} className="flex justify-center">
                  <div className="max-w-[90%] rounded-lg border border-brand-500/20 bg-brand-50 px-3 py-2 text-center">
                    <p className="text-[11px] font-semibold text-brand-700">{entry.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-brand-600">{entry.description}</p>
                  </div>
                </div>
              )
            }
            const outbound = entry.kind === 'user'
            return (
              <div key={entry.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs ${
                    outbound
                      ? 'bg-brand-500 text-white'
                      : 'border border-neutral-200 bg-neutral-0 text-dark-800'
                  }`}
                >
                  {entry.text}
                </div>
              </div>
            )
          })}
          {running && !waiting && (
            <div className="flex justify-start">
              <span className="flex items-center gap-1.5 rounded-2xl border border-neutral-200 bg-neutral-0 px-3 py-2 text-[11px] text-neutral-400">
                <Bot size={12} aria-hidden="true" />
                digitando…
              </span>
            </div>
          )}
        </div>

        {waiting?.type === 'buttons' && (
          <div className="flex flex-wrap gap-1.5">
            {waiting.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => answer(option.label || 'Opção', option.id)}
                className="rounded-full border border-brand-500/30 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
              >
                {option.label || 'Opção'}
              </button>
            ))}
            {waiting.hasDefault && (
              <span className="self-center text-[11px] text-neutral-400">
                ou digite outra resposta
              </span>
            )}
          </div>
        )}
        {waiting?.type === 'menu' && (
          <p className="text-[11px] text-neutral-400">Responda com o número da opção.</p>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!waiting}
            placeholder={waiting ? 'Digite sua resposta…' : 'Aguarde o bot…'}
            aria-label="Resposta da simulação"
            className="h-9 min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-0 px-3 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none disabled:opacity-50"
          />
          <Button type="submit" size="sm" icon={SendHorizontal} disabled={!waiting || !draft.trim()}>
            Enviar
          </Button>
          <Button type="button" size="sm" variant="secondary" icon={RotateCcw} onClick={run}>
            Reiniciar
          </Button>
        </form>
      </div>
    </Modal>
  )
}
