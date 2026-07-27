import type { ReactNode } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'

export type BillingMetric = {
  label: string
  value: ReactNode
}

export function BillingPageHeader({
  title = 'Assinatura',
  subtitle = 'Gerencie o plano, os add-ons e os limites do seu workspace.',
  onManage,
  showManage = true,
}: {
  title?: string
  subtitle?: string
  onManage: () => void | Promise<void>
  showManage?: boolean
}) {
  return (
    <header className="flex flex-col justify-between gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-dark-800">{title}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
      </div>
      {showManage && (
        <button
          type="button"
          onClick={() => void onManage()}
          className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-neutral-0 px-4 text-sm font-semibold text-dark-800 shadow-2xs transition-[background-color,transform] duration-150 hover:bg-neutral-50 active:scale-[0.98] sm:w-auto"
        >
          Portal de faturas
          <ExternalLink size={14} className="text-neutral-400" aria-hidden="true" />
        </button>
      )}
    </header>
  )
}

export function BillingCurrentPlanCard({
  planName,
  statusText,
  metrics,
  manageFooter,
}: {
  planName: string
  statusText: ReactNode
  metrics: BillingMetric[]
  manageFooter?: ReactNode
}) {
  return (
    <section className="my-6 rounded-xl border border-neutral-200 bg-neutral-0 p-5 shadow-2xs">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-brand-100 bg-brand-50 text-brand-600">
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Plano atual:
              </span>
              <span className="inline-flex items-center rounded bg-dark-800 px-2 py-0.5 text-xs font-bold text-white">
                {planName}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">{statusText}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-neutral-200 pt-3 text-xs text-dark-800 md:flex-nowrap md:border-l md:border-t-0 md:pl-6 md:pt-0">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <span className="block whitespace-nowrap text-[11px] text-neutral-400">
                {metric.label}
              </span>
              <strong className="font-bold">{metric.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {manageFooter && (
        <div className="mt-4 flex items-center justify-end border-t border-neutral-100 pt-4">
          {manageFooter}
        </div>
      )}
    </section>
  )
}

export function BillingManageLink({
  onClick,
}: {
  onClick: () => void | Promise<void>
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-neutral-500 transition-[background-color,color,transform] duration-150 hover:bg-neutral-100 hover:text-dark-800 active:scale-[0.98]"
    >
      Gerenciar cancelamento, cartão e faturas
      <ExternalLink size={13} aria-hidden="true" />
    </button>
  )
}

export function BillingPlansGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
      {children}
    </div>
  )
}

export function BillingPlanCardSurface({
  current,
  popular,
  children,
}: {
  current: boolean
  popular: boolean
  children: ReactNode
}) {
  return (
    <article
      className={`relative flex flex-col justify-between rounded-xl p-6 transition-[border-color,box-shadow] duration-150 ${
        current
          ? 'border-2 border-dark-800 bg-neutral-50/50 shadow-sm'
          : popular
            ? 'border-2 border-brand-500 bg-neutral-0 shadow-md'
            : 'border border-neutral-200 bg-neutral-0 shadow-2xs hover:border-brand-300 hover:shadow-sm'
      }`}
    >
      {children}
    </article>
  )
}
