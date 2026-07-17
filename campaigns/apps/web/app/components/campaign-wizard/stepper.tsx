import { Check } from 'lucide-react'

const STEPS = [
  { title: 'Canais', hint: 'Escolha os canais responsáveis pelo disparo das mensagens' },
  { title: 'Público Alvo', hint: 'Defina o público que será atingido na sua campanha' },
  { title: 'Conteúdo', hint: 'Defina os textos, imagens ou vídeos que serão disparados' },
  { title: 'Configurações', hint: 'Ajuste velocidade e agendamento do envio das mensagens' },
]

export function WizardStepper({
  current,
  furthest,
  onSelect,
}: {
  current: number
  furthest: number
  onSelect: (step: number) => void
}) {
  return (
    <ol className="flex items-start" aria-label="Etapas da campanha">
      {STEPS.map((step, index) => {
        const done = index < furthest && index !== current
        const active = index === current
        const reachable = index <= furthest
        return (
          <li key={step.title} className="flex flex-1 flex-col items-center min-w-0">
            <div className="flex w-full items-center">
              <span
                className={`h-px flex-1 ${index === 0 ? 'invisible' : ''} ${index <= furthest ? 'bg-brand-300' : 'bg-neutral-200'}`}
                aria-hidden="true"
              />
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && onSelect(index)}
                aria-current={active ? 'step' : undefined}
                className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition-colors duration-150 ${
                  active
                    ? 'border-brand-500 bg-neutral-0 text-brand-600'
                    : done
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : reachable
                        ? 'border-neutral-300 bg-neutral-0 text-neutral-500 hover:border-brand-300'
                        : 'border-neutral-200 bg-neutral-0 text-neutral-300'
                }`}
              >
                {done ? <Check size={16} aria-hidden="true" /> : index + 1}
              </button>
              <span
                className={`h-px flex-1 ${index === STEPS.length - 1 ? 'invisible' : ''} ${index < furthest ? 'bg-brand-300' : 'bg-neutral-200'}`}
                aria-hidden="true"
              />
            </div>
            <p className={`mt-1.5 text-xs font-semibold ${active ? 'text-dark-800' : 'text-neutral-500'}`}>
              {step.title}
            </p>
            {active && (
              <p className="mt-0.5 hidden max-w-36 text-center text-[10px] leading-snug text-neutral-400 sm:block">
                {step.hint}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
