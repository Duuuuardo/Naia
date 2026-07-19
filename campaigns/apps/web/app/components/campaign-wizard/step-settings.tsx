import { Link } from '@tanstack/react-router'
import { getSpeedPolicy } from '@naia/entitlements'
import type { SpeedPreset } from '@naia/schemas'
import { SPEED_PRESET_RANGES } from '@naia/schemas'
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Globe,
  Lock,
  Rabbit,
  Repeat,
  SlidersHorizontal,
  Snail,
  Turtle,
  Zap,
} from 'lucide-react'
import type { WizardConnection, WizardDraft } from './types'
import { TIMEZONES, WEEKDAY_LABELS } from './types'
import { ToggleRow } from '../ui'

const PRESET_META: Array<{
  id: SpeedPreset
  title: string
  icon: typeof Snail
  description: string
  requiredPlan?: string
}> = [
  { id: 'lento', title: 'Lento', icon: Snail, description: 'Ideal para campanhas longas. A chance de banimento é a mais baixa.' },
  { id: 'medio', title: 'Médio', icon: Turtle, description: 'Velocidade razoável com risco de banimento baixo. Recomendado.', requiredPlan: 'Starter' },
  { id: 'rapido', title: 'Rápido', icon: Rabbit, description: 'Prioriza a velocidade. Pode aumentar o risco de banimento.', requiredPlan: 'Pro' },
  { id: 'manual', title: 'Manual', icon: SlidersHorizontal, description: 'Você define o intervalo entre mensagens, dentro do piso do plano.', requiredPlan: 'Pro' },
]

const REC_KINDS = [
  { id: 'daily', label: 'Todos os dias' },
  { id: 'weekly', label: 'Dias da semana' },
  { id: 'every_x_hours', label: 'De X em X horas' },
  { id: 'times_per_day', label: 'X vezes por dia' },
] as const

export function StepSettings({
  draft,
  patch,
  connections,
  tier,
  workspaceId,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
  connections: WizardConnection[]
  tier: string
  workspaceId: string
}) {
  const policy = getSpeedPolicy(tier)
  const selectedChannels = [
    ...new Set(
      connections.filter((c) => draft.connectionIds.includes(c.id)).map((c) => c.channel),
    ),
  ].filter((c): c is 'whatsapp' | 'telegram' => c === 'whatsapp' || c === 'telegram')
  const channels = selectedChannels.length > 0 ? selectedChannels : (['whatsapp'] as const)

  function rangeLabel(preset: Exclude<SpeedPreset, 'manual'>): string {
    return channels
      .map((ch) => {
        const r = SPEED_PRESET_RANGES[preset][ch]
        return `${ch === 'whatsapp' ? 'WhatsApp' : 'Telegram'}: ${r.min}–${r.max}s`
      })
      .join(' · ')
  }

  const manualFloor = channels
    .map((ch) => policy.manualFloorSeconds?.[ch])
    .filter((v): v is number => typeof v === 'number')
  const floorHint = Math.max(0, ...manualFloor)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(260px,320px)_1fr]">
      {/* ── Velocidade ── */}
      <section aria-labelledby="speed-heading">
        <h3 id="speed-heading" className="text-sm font-bold text-dark-800">Velocidade de envio</h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          Intervalo entre uma mensagem e a próxima. Velocidades maiores aumentam a chance das mensagens serem
          marcadas como spam.
        </p>

        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Velocidade de envio">
          {PRESET_META.map((preset) => {
            const allowed = policy.allowedPresets.includes(preset.id)
            const selected = draft.speed.preset === preset.id
            const Icon = preset.icon
            return (
              <div key={preset.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!allowed}
                  onClick={() => allowed && patch({ speed: { ...draft.speed, preset: preset.id } })}
                  className={`flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors duration-150 active:scale-[0.98] ${
                    selected
                      ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
                      : allowed
                        ? 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                        : 'cursor-not-allowed border-neutral-150 bg-neutral-50/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2 ${
                      selected ? 'border-brand-500' : 'border-neutral-300'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <span className="size-2 rounded-full bg-brand-500" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`flex items-center gap-1.5 text-xs font-bold ${allowed ? 'text-dark-800' : 'text-neutral-400'}`}>
                        <Icon size={14} className={allowed ? 'text-brand-500' : 'text-neutral-300'} aria-hidden="true" />
                        {preset.title}
                      </span>
                      {!allowed && preset.requiredPlan && (
                        <Link
                          to="/$workspaceId/billing"
                          params={{ workspaceId }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500 transition-colors hover:bg-brand-100 hover:text-brand-700"
                        >
                          <Lock size={9} aria-hidden="true" />
                          Plano {preset.requiredPlan}
                        </Link>
                      )}
                    </span>
                    <span className={`mt-0.5 block text-[11px] leading-snug ${allowed ? 'text-neutral-600' : 'text-neutral-400'}`}>
                      {preset.description}
                    </span>
                    {preset.id !== 'manual' && (
                      <span className={`mt-1 block text-[10px] font-medium ${allowed ? 'text-neutral-500' : 'text-neutral-300'}`}>
                        {rangeLabel(preset.id)}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        {draft.speed.preset === 'manual' && (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="speed-min" className="text-xs">Mínimo (s)</label>
                <input
                  id="speed-min"
                  type="number"
                  min={floorHint || 1}
                  value={draft.speed.minSeconds ?? ''}
                  onChange={(e) => patch({ speed: { ...draft.speed, minSeconds: Number(e.target.value) || undefined } })}
                  placeholder={String(floorHint || 20)}
                />
              </div>
              <div>
                <label htmlFor="speed-max" className="text-xs">Máximo (s)</label>
                <input
                  id="speed-max"
                  type="number"
                  min={draft.speed.minSeconds ?? floorHint ?? 1}
                  value={draft.speed.maxSeconds ?? ''}
                  onChange={(e) => patch({ speed: { ...draft.speed, maxSeconds: Number(e.target.value) || undefined } })}
                  placeholder={String((floorHint || 20) * 2)}
                />
              </div>
            </div>
            {floorHint > 0 && (
              <p className="mt-2 text-[11px] text-neutral-500">
                Seu plano permite no mínimo {floorHint}s entre mensagens {channels.includes('whatsapp') ? 'no WhatsApp' : ''}.
              </p>
            )}
          </div>
        )}

        {policy.burstPauseAllowed && (
          <div className="mt-3">
            <ToggleRow
              id="burst-pause"
              label="Ativar intervalo entre envios?"
              hint="Sempre que o número de envios definido for atingido, uma pausa aleatória é aplicada antes de continuar."
              checked={Boolean(draft.speed.pauseEveryN)}
              onChange={(on) =>
                patch({
                  speed: on
                    ? { ...draft.speed, pauseEveryN: draft.speed.pauseEveryN ?? 30, pauseMinMinutes: draft.speed.pauseMinMinutes ?? 1, pauseMaxMinutes: draft.speed.pauseMaxMinutes ?? 15 }
                    : { ...draft.speed, pauseEveryN: undefined, pauseMinMinutes: undefined, pauseMaxMinutes: undefined },
                })
              }
            />
            {Boolean(draft.speed.pauseEveryN) && (
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                <div>
                  <label htmlFor="pause-n" className="text-[11px]">A cada (msgs)</label>
                  <input
                    id="pause-n"
                    type="number"
                    min={1}
                    value={draft.speed.pauseEveryN ?? ''}
                    onChange={(e) => patch({ speed: { ...draft.speed, pauseEveryN: Number(e.target.value) || undefined } })}
                  />
                </div>
                <div>
                  <label htmlFor="pause-min" className="text-[11px]">Pausa mín (min)</label>
                  <input
                    id="pause-min"
                    type="number"
                    min={1}
                    value={draft.speed.pauseMinMinutes ?? ''}
                    onChange={(e) => patch({ speed: { ...draft.speed, pauseMinMinutes: Number(e.target.value) || undefined } })}
                  />
                </div>
                <div>
                  <label htmlFor="pause-max" className="text-[11px]">Pausa máx (min)</label>
                  <input
                    id="pause-max"
                    type="number"
                    min={draft.speed.pauseMinMinutes ?? 1}
                    value={draft.speed.pauseMaxMinutes ?? ''}
                    onChange={(e) => patch({ speed: { ...draft.speed, pauseMaxMinutes: Number(e.target.value) || undefined } })}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Agendamento ── */}
      <section aria-labelledby="schedule-heading" className="min-w-0">
        <h3 id="schedule-heading" className="text-sm font-bold text-dark-800">Agendamento</h3>
        <p className="mt-1 text-xs text-neutral-500">Quando esta campanha deve rodar?</p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de agendamento">
          {(
            [
              { id: 'immediate', label: 'Imediato', hint: 'Dispara ao confirmar', icon: Zap },
              { id: 'once', label: 'Data única', hint: 'Uma vez, na data marcada', icon: CalendarClock },
              { id: 'recurring', label: 'Recorrente', hint: 'Repete no ritmo que você definir', icon: Repeat },
            ] as const
          ).map((opt) => {
            const active = draft.scheduleType === opt.id
            const Icon = opt.icon
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ scheduleType: opt.id })}
                className={`rounded-lg border p-3 text-left transition-colors duration-150 active:scale-[0.98] ${
                  active
                    ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
                    : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-bold text-dark-800">
                  <Icon size={14} className={active ? 'text-brand-600' : 'text-neutral-400'} aria-hidden="true" />
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-neutral-500">{opt.hint}</span>
              </button>
            )
          })}
        </div>

        {draft.scheduleType === 'once' && (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
            <label htmlFor="once-at">Data e hora do disparo</label>
            <input
              id="once-at"
              type="datetime-local"
              value={draft.onceAt}
              onChange={(e) => patch({ onceAt: e.target.value })}
              className="h-10 max-w-xs rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
            />
          </div>
        )}

        {draft.scheduleType === 'recurring' && (
          <div className="mt-3 space-y-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-dark-800">Repetir</span>
              <div className="flex flex-wrap gap-1.5">
                {REC_KINDS.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    onClick={() => patch({ recKind: kind.id })}
                    aria-pressed={draft.recKind === kind.id}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                      draft.recKind === kind.id
                        ? 'bg-brand-500 text-white'
                        : 'border border-neutral-300 bg-neutral-0 text-neutral-600 hover:border-brand-300'
                    }`}
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              {(draft.recKind === 'daily' || draft.recKind === 'weekly') && (
                <div>
                  <label htmlFor="rec-time" className="text-xs">Horário</label>
                  <input
                    id="rec-time"
                    type="time"
                    value={draft.recTime}
                    onChange={(e) => patch({ recTime: e.target.value })}
                    className="h-10 w-28 rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
                  />
                </div>
              )}
              {draft.recKind === 'weekly' && (
                <WeekdayPicker
                  value={draft.recWeekdays}
                  onChange={(recWeekdays) => patch({ recWeekdays })}
                  label="Nos dias"
                />
              )}
              {draft.recKind === 'every_x_hours' && (
                <div>
                  <label htmlFor="rec-hours" className="text-xs">A cada quantas horas?</label>
                  <input
                    id="rec-hours"
                    type="number"
                    min={1}
                    max={168}
                    value={draft.recEveryHours}
                    onChange={(e) => patch({ recEveryHours: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-24"
                  />
                </div>
              )}
              {draft.recKind === 'times_per_day' && (
                <div>
                  <label htmlFor="rec-times" className="text-xs">Quantas vezes por dia?</label>
                  <input
                    id="rec-times"
                    type="number"
                    min={1}
                    max={24}
                    value={draft.recTimesPerDay}
                    onChange={(e) => patch({ recTimesPerDay: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-24"
                  />
                </div>
              )}
            </div>

            <div className="grid gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-3">
              <div>
                <label htmlFor="rec-start" className="text-[11px]">Começa em (opcional)</label>
                <input
                  id="rec-start"
                  type="date"
                  value={draft.recStartDate}
                  onChange={(e) => patch({ recStartDate: e.target.value })}
                  className="h-10 rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="rec-end" className="text-[11px]">Termina em (opcional)</label>
                <input
                  id="rec-end"
                  type="date"
                  value={draft.recEndDate}
                  onChange={(e) => patch({ recEndDate: e.target.value })}
                  className="h-10 rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="rec-max" className="text-[11px]">Máx. de execuções (opcional)</label>
                <input
                  id="rec-max"
                  type="number"
                  min={1}
                  value={draft.recMaxOccurrences}
                  onChange={(e) => patch({ recMaxOccurrences: e.target.value })}
                  placeholder="Sem limite"
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-4 border-t border-neutral-100 pt-4">
          <div>
            <ToggleRow
              id="tz-toggle"
              icon={Globe}
              label="Ajustar o fuso horário?"
              hint={`Fuso atual: ${draft.timezone}`}
              checked={draft.timezoneEnabled}
              onChange={(on) => patch({ timezoneEnabled: on, ...(on ? {} : { timezone: 'America/Sao_Paulo' }) })}
            />
            {draft.timezoneEnabled && (
              <select
                value={draft.timezone}
                onChange={(e) => patch({ timezone: e.target.value })}
                className="mt-2 max-w-sm"
                aria-label="Fuso horário da campanha"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <ToggleRow
              id="wh-toggle"
              icon={Clock}
              label="Ajustar horário de funcionamento?"
              hint="Os envios só acontecem dentro da janela. Fora dela, aguardam a próxima."
              checked={draft.workingHoursEnabled}
              onChange={(on) => patch({ workingHoursEnabled: on })}
            />
            {draft.workingHoursEnabled && (
              <div className="mt-2 flex flex-wrap items-end gap-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                <div>
                  <label htmlFor="wh-start" className="text-[11px]">Das</label>
                  <input
                    id="wh-start"
                    type="time"
                    value={draft.whStart}
                    onChange={(e) => patch({ whStart: e.target.value })}
                    className="h-10 w-26 rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="wh-end" className="text-[11px]">Às</label>
                  <input
                    id="wh-end"
                    type="time"
                    value={draft.whEnd}
                    onChange={(e) => patch({ whEnd: e.target.value })}
                    className="h-10 w-26 rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm"
                  />
                </div>
                <WeekdayPicker
                  value={draft.whWeekdays}
                  onChange={(whWeekdays) => patch({ whWeekdays })}
                  label="Dias permitidos"
                />
              </div>
            )}
          </div>

          <div>
            <ToggleRow
              id="cap-toggle"
              icon={CalendarDays}
              label="Ativar limite de envio diário?"
              hint="Ao atingir o limite, o restante fica para o dia seguinte."
              checked={draft.dailyCapEnabled}
              onChange={(on) => patch({ dailyCapEnabled: on })}
            />
            {draft.dailyCapEnabled && (
              <input
                type="number"
                min={1}
                value={draft.dailyCap}
                onChange={(e) => patch({ dailyCap: e.target.value })}
                placeholder="Ex: 200 mensagens por dia"
                className="mt-2 max-w-56"
                aria-label="Limite de mensagens por dia"
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function WeekdayPicker({
  value,
  onChange,
  label,
}: {
  value: number[]
  onChange: (days: number[]) => void
  label: string
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-dark-800">{label}</span>
      <div className="flex gap-1" role="group" aria-label={label}>
        {WEEKDAY_LABELS.map((day, index) => {
          const active = value.includes(index)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? value.filter((d) => d !== index) : [...value, index].sort())}
              className={`size-9 rounded-md text-[11px] font-bold transition-colors duration-150 ${
                active
                  ? 'bg-brand-500 text-white'
                  : 'border border-neutral-300 bg-neutral-0 text-neutral-500 hover:border-brand-300'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
