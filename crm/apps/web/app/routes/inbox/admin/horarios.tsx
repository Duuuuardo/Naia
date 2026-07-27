import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Bot, Clock, MessageSquareText, MoonStar, Save } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button } from '../../../components/ui'
import {
  fetchAdminSettings,
  fetchBots,
  getInboxAgent,
  updateAdminSettings,
  type BotListItem,
  type OutOfHoursMode,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/horarios')({
  head: () => createHeadConfig('Horários — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const [settings, bots] = await Promise.all([fetchAdminSettings(), fetchBots()])
    return { agent, settings, bots }
  },
  component: AdminHours,
})

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

// Índice do dia segue a convenção do JS: 0 = domingo … 6 = sábado.
const WEEK_DAYS = [
  { day: 0, label: 'Domingo' },
  { day: 1, label: 'Segunda-feira' },
  { day: 2, label: 'Terça-feira' },
  { day: 3, label: 'Quarta-feira' },
  { day: 4, label: 'Quinta-feira' },
  { day: 5, label: 'Sexta-feira' },
  { day: 6, label: 'Sábado' },
]

type DayState = { open: boolean; start: string; end: string }

const MODE_OPTIONS: { value: OutOfHoursMode; label: string; description: string }[] = [
  {
    value: 'none',
    label: 'Nada',
    description: 'A conversa entra normalmente e fica aguardando um agente, sem nenhum aviso ao contato.',
  },
  {
    value: 'auto_reply',
    label: 'Resposta automática',
    description: 'O contato recebe a mensagem automática avisando que o atendimento está fora do horário.',
  },
  {
    value: 'bot',
    label: 'Bot assume',
    description: 'Um fluxo de chatbot atende a conversa até o próximo horário de atendimento.',
  },
  {
    value: 'both',
    label: 'Resposta + Bot',
    description: 'O contato recebe a mensagem automática e, em seguida, o bot assume o atendimento.',
  },
]

function AdminHours() {
  const initial = Route.useLoaderData()
  const { settings } = initial
  // Só fluxos ativos podem ser escolhidos para assumir fora do horário.
  const activeBots = initial.bots.filter((bot: BotListItem) => bot.status === 'active')

  const [days, setDays] = useState<Record<number, DayState>>(() => {
    // businessHours null = sem restrição (24h): todos os dias abertos o dia todo.
    const entries = new Map((settings.businessHours ?? []).map((entry) => [entry.day, entry]))
    const fullDay = settings.businessHours === null
    return Object.fromEntries(
      WEEK_DAYS.map(({ day }) => {
        const entry = entries.get(day)
        return [
          day,
          entry
            ? { open: true, start: entry.start, end: entry.end }
            : { open: fullDay, start: fullDay ? '00:00' : '09:00', end: fullDay ? '23:59' : '18:00' },
        ]
      }),
    ) as Record<number, DayState>
  })
  const [mode, setMode] = useState<OutOfHoursMode>(settings.outOfHoursMode)
  const [message, setMessage] = useState(settings.outOfHoursMessage ?? '')
  const [botFlowId, setBotFlowId] = useState(settings.outOfHoursBotFlowId ?? '')
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usesAutoReply = mode === 'auto_reply' || mode === 'both'
  const usesBot = mode === 'bot' || mode === 'both'
  const modeDescription = MODE_OPTIONS.find((option) => option.value === mode)?.description

  function updateDay(day: number, patch: Partial<DayState>) {
    setDays((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }))
    setSavedOk(false)
  }

  async function handleSave() {
    setError(null)
    setSavedOk(false)

    for (const { day, label } of WEEK_DAYS) {
      const state = days[day]
      if (state.open && state.start >= state.end) {
        setError(`Em ${label}, o horário de início precisa ser antes do horário de fim.`)
        return
      }
    }
    if (usesAutoReply && !message.trim()) {
      setError('Escreva a mensagem automática — ela é obrigatória quando o modo inclui resposta automática.')
      return
    }

    setSaving(true)
    const businessHours = WEEK_DAYS.filter(({ day }) => days[day].open).map(({ day }) => ({
      day,
      start: days[day].start,
      end: days[day].end,
    }))
    const result = await updateAdminSettings({
      data: {
        businessHours,
        outOfHoursMode: mode,
        outOfHoursMessage: usesAutoReply ? message.trim() : null,
        outOfHoursBotFlowId: usesBot ? botFlowId || null : null,
      },
    })
    setSaving(false)
    if (!result) {
      setError('Não foi possível salvar os horários. Tente novamente.')
      return
    }
    setSavedOk(true)
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">
              Horários de atendimento
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Defina quando a equipe está disponível e o que acontece com as conversas que chegam fora do horário.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm font-medium text-error-500">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0">
            <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-dark-800">
                <Clock size={16} aria-hidden="true" />
                Grade semanal
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Marque os dias abertos e ajuste o horário. Dias fechados entram na regra de fora do horário.
              </p>
            </div>

            <div className="divide-y divide-neutral-100">
              {WEEK_DAYS.map(({ day, label }) => {
                const state = days[day]
                return (
                  <div key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                    <label className="flex w-44 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={state.open}
                        onChange={(e) => updateDay(day, { open: e.target.checked })}
                        className="size-4 accent-brand-500"
                      />
                      <span className="text-sm font-medium text-dark-800">{label}</span>
                    </label>
                    {state.open ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={state.start}
                          onChange={(e) => updateDay(day, { start: e.target.value })}
                          aria-label={`Abertura de ${label}`}
                          className="h-9 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm text-dark-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                        />
                        <span className="text-xs text-neutral-400">até</span>
                        <input
                          type="time"
                          value={state.end}
                          onChange={(e) => updateDay(day, { end: e.target.value })}
                          aria-label={`Fechamento de ${label}`}
                          className="h-9 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm text-dark-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-400">Fechado</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0">
            <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-dark-800">
                <MoonStar size={16} aria-hidden="true" />
                Fora do horário
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                O que acontece quando uma conversa chega em dia fechado ou fora da janela de atendimento.
              </p>
            </div>

            <div className="space-y-5 px-5 py-5">
              <div>
                <label htmlFor="out-mode" className="mb-1.5 block text-sm font-medium text-dark-800">
                  Modo
                </label>
                <select
                  id="out-mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as OutOfHoursMode)
                    setSavedOk(false)
                  }}
                  className={inputClass}
                >
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {modeDescription && <p className="mt-1.5 text-xs text-neutral-500">{modeDescription}</p>}
              </div>

              {usesAutoReply && (
                <div>
                  <label htmlFor="out-message" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-dark-800">
                    <MessageSquareText size={14} aria-hidden="true" className="text-neutral-400" />
                    Mensagem automática
                  </label>
                  <textarea
                    id="out-message"
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value)
                      setSavedOk(false)
                    }}
                    placeholder="Ex.: Olá! Nosso atendimento funciona de seg. a sex., das 9h às 18h. Deixe sua mensagem que respondemos assim que possível."
                    rows={3}
                    required
                    className="w-full resize-none rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                  <p className="mt-1.5 text-xs text-neutral-500">
                    Enviada automaticamente ao contato assim que a conversa chega fora do horário.
                  </p>
                </div>
              )}

              {usesBot && (
                <div>
                  <label htmlFor="out-bot" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-dark-800">
                    <Bot size={14} aria-hidden="true" className="text-neutral-400" />
                    Fluxo do bot
                  </label>
                  <select
                    id="out-bot"
                    value={botFlowId}
                    onChange={(e) => {
                      setBotFlowId(e.target.value)
                      setSavedOk(false)
                    }}
                    className={inputClass}
                  >
                    <option value="">Fluxo padrão (avaliação normal)</option>
                    {activeBots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-neutral-500">
                    Com o fluxo padrão, as regras normais de bots (gatilhos e palavras-chave) decidem qual fluxo assume.
                    Escolha um fluxo específico para forçar esse atendimento fora do horário. Só fluxos ativos aparecem
                    na lista.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-neutral-100 pt-4">
                {savedOk && <span className="text-xs font-medium text-success-500">Horários salvos.</span>}
                <Button icon={Save} onClick={handleSave} loading={saving}>
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </InboxShell>
  )
}
