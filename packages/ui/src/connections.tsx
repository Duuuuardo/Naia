import type { FormEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Check,
  Info,
  MessageCircle,
  Send,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from './dashboard'

export type ConnectionPlatformOption = {
  id: string
  name: string
  formName?: string
  channel: string
  description: string
  icon: LucideIcon
  accentClass: string
}

export function ConnectionComposer({
  step,
  platforms,
  selectedId,
  platformSubtitle,
  name,
  nameError,
  namePlaceholder,
  nameHelp,
  error,
  saving,
  extraFields,
  showWhatsAppSafety = false,
  acceptResponsibleUse = false,
  acceptTerms = false,
  termsHref,
  safetyFooter,
  submitLabel,
  submitDisabled,
  onSelect,
  onNameChange,
  onNameBlur,
  onResponsibleUseChange,
  onTermsChange,
  onBack,
  onClose,
  onSubmit,
}: {
  step: 'platform' | 'form'
  platforms: ConnectionPlatformOption[]
  selectedId: string | null
  platformSubtitle: string
  name: string
  nameError?: string | null
  namePlaceholder: string
  nameHelp: string
  error?: string | null
  saving: boolean
  extraFields?: ReactNode
  showWhatsAppSafety?: boolean
  acceptResponsibleUse?: boolean
  acceptTerms?: boolean
  termsHref?: string
  safetyFooter?: string
  submitLabel: string
  submitDisabled?: boolean
  onSelect: (platform: ConnectionPlatformOption) => void
  onNameChange: (value: string) => void
  onNameBlur: () => void
  onResponsibleUseChange?: (checked: boolean) => void
  onTermsChange?: (checked: boolean) => void
  onBack: () => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}) {
  const selectedPlatform = platforms.find((platform) => platform.id === selectedId) ?? null
  const SelectedIcon = selectedPlatform?.icon

  return (
    <section className="panel-enter space-y-6 rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xs">
      {step === 'platform' ? (
        <div>
          <div className="mb-5 flex items-center justify-between border-b border-neutral-100 pb-4">
            <div>
              <h2 className="font-display text-base font-bold text-dark-800">
                Selecione a plataforma para conectar
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">{platformSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-8 place-items-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-50 hover:text-dark-800"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
            {platforms.map((platform) => {
              const Icon = platform.icon
              return (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => onSelect(platform)}
                  className="group flex flex-col justify-between rounded-2xl border border-neutral-200 bg-neutral-50/50 p-5 text-left shadow-2xs transition-[background-color,border-color,transform] duration-150 ease-out hover:border-dark-800 hover:bg-neutral-0 active:scale-[0.98]"
                >
                  <span>
                    <span className="mb-3 flex items-center justify-between">
                      <span
                        className={`grid size-11 place-items-center rounded-xl border ${platform.accentClass}`}
                      >
                        <Icon size={22} aria-hidden="true" />
                      </span>
                      <span className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-bold text-neutral-600 transition-colors duration-150 group-hover:bg-dark-800 group-hover:text-white">
                        Conectar ›
                      </span>
                    </span>
                    <span className="block text-base font-bold text-dark-800">{platform.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-neutral-400">
                      {platform.channel}
                    </span>
                    <span className="mt-3 block text-xs leading-relaxed text-neutral-600">
                      {platform.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-5 flex items-center justify-between border-b border-neutral-100 pb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-500 transition-colors duration-150 hover:text-dark-800"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Voltar
              </button>
              <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
                {SelectedIcon && (
                  <SelectedIcon
                    size={18}
                    className={selectedId === 'whatsapp' ? 'text-emerald-600' : 'text-sky-500'}
                    aria-hidden="true"
                  />
                )}
                Configurar {selectedPlatform?.formName ?? selectedPlatform?.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-8 place-items-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-50 hover:text-dark-800"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={onSubmit} className="max-w-xl space-y-4">
            <div>
              <label
                htmlFor="connection-name"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-neutral-500"
              >
                Nome de identificação *
              </label>
              <input
                id="connection-name"
                type="text"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                onBlur={onNameBlur}
                aria-invalid={nameError ? true : undefined}
                placeholder={namePlaceholder}
                maxLength={80}
                className={`h-10 w-full rounded-xl border px-3.5 text-sm font-medium outline-none transition-colors duration-150 focus:border-dark-800 ${
                  nameError ? 'border-error-500' : 'border-neutral-200'
                }`}
                required
              />
              {nameError ? (
                <span className="mt-1 block text-[11px] text-error-500" role="alert">
                  {nameError}
                </span>
              ) : (
                <p className="mt-1 text-xs text-neutral-400">{nameHelp}</p>
              )}
            </div>

            {extraFields}

            {showWhatsAppSafety && (
              <WhatsAppSafety
                acceptResponsibleUse={acceptResponsibleUse}
                acceptTerms={acceptTerms}
                termsHref={termsHref}
                footer={safetyFooter}
                onResponsibleUseChange={onResponsibleUseChange}
                onTermsChange={onTermsChange}
              />
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-error-200 bg-error-50 p-3 text-xs font-semibold text-error-600">
                <TriangleAlert size={15} className="shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-xs font-bold text-neutral-500 transition-colors duration-150 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <Button type="submit" loading={saving} disabled={submitDisabled}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

function WhatsAppSafety({
  acceptResponsibleUse,
  acceptTerms,
  termsHref = 'https://app.vianova.software/terms',
  footer = 'O QR code só será gerado depois das duas confirmações.',
  onResponsibleUseChange,
  onTermsChange,
}: {
  acceptResponsibleUse: boolean
  acceptTerms: boolean
  termsHref?: string
  footer?: string
  onResponsibleUseChange?: (checked: boolean) => void
  onTermsChange?: (checked: boolean) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-neutral-200 bg-neutral-0 text-brand-500">
          <ShieldCheck size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-dark-800">Proteja seu número antes de conectar</h3>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            O pareamento usa o modo de dispositivos conectados do WhatsApp. O uso inadequado pode
            causar limitações ou banimento do número.
          </p>
        </div>
      </div>

      <ul className="grid gap-2 border-y border-neutral-200 py-3 text-xs leading-relaxed text-neutral-700">
        {[
          'Envie apenas para pessoas que autorizaram receber suas mensagens.',
          'Comece com volume baixo e aumente aos poucos, sem picos de disparo.',
          'Evite mensagens repetitivas e respeite bloqueios e pedidos de saída.',
        ].map((guideline) => (
          <li key={guideline} className="flex items-start gap-2">
            <Check size={14} className="mt-0.5 shrink-0 text-success-500" aria-hidden="true" />
            <span>{guideline}</span>
          </li>
        ))}
      </ul>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 text-xs text-neutral-700 transition-colors duration-150 hover:bg-neutral-0 focus-within:ring-2 focus-within:ring-brand-500/30">
        <input
          type="checkbox"
          checked={acceptResponsibleUse}
          onChange={(event) => onResponsibleUseChange?.(event.target.checked)}
          className="mt-0.5 size-4 rounded border-neutral-300 accent-brand-500"
        />
        <span>Entendi as práticas acima e assumo responsabilidade pelo uso deste número.</span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 text-xs text-neutral-700 transition-colors duration-150 hover:bg-neutral-0 focus-within:ring-2 focus-within:ring-brand-500/30">
        <input
          type="checkbox"
          checked={acceptTerms}
          onChange={(event) => onTermsChange?.(event.target.checked)}
          className="mt-0.5 size-4 rounded border-neutral-300 accent-brand-500"
        />
        <span>
          Li e aceito os{' '}
          <a
            href={termsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-500 underline underline-offset-2 transition-colors duration-150 hover:text-brand-600"
          >
            Termos de Uso
          </a>{' '}
          e autorizo a geração do QR code.
        </span>
      </label>

      <p className="flex items-center gap-2 text-[11px] text-neutral-500">
        <Info size={13} aria-hidden="true" />
        {footer}
      </p>
    </div>
  )
}

export const defaultConnectionIcons = {
  whatsapp: MessageCircle,
  telegram: Send,
}
