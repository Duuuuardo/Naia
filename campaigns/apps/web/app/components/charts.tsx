// Gráficos do dashboard — recharts não sobrevive ao SSR, então o AreaChart em
// si vive em sends-chart.tsx e só é carregado (lazy) depois do mount no cliente.

import { lazy, Suspense, useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'

const SendsAreaChart = lazy(() => import('./sends-chart'))

export type TimeseriesData = {
  perDay: Array<{ date: string; sent: number; failed: number }>
  perHour: Array<{ hour: string; sent: number }>
  timezone: string
}

function fillPerDay(perDay: TimeseriesData['perDay']): Array<{ label: string; sent: number; failed: number }> {
  const byDate = new Map(perDay.map((d) => [d.date, d]))
  const out: Array<{ label: string; sent: number; failed: number }> = []
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today)
    day.setDate(today.getDate() - i)
    // chave em data local — toISOString (UTC) deslocaria o dia à noite em fusos negativos
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    const row = byDate.get(key)
    out.push({
      label: `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`,
      sent: row?.sent ?? 0,
      failed: row?.failed ?? 0,
    })
  }
  return out
}

function fillPerHour(perHour: TimeseriesData['perHour']): Array<{ label: string; sent: number; failed: number }> {
  const byHour = new Map(perHour.map((h) => [Number(h.hour), h.sent]))
  return Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, '0')}h`,
    sent: byHour.get(hour) ?? 0,
    failed: 0,
  }))
}

export function SendsTimeseriesCard({ data }: { data: TimeseriesData }) {
  const [mode, setMode] = useState<'days' | 'hours'>('days')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const rows = mode === 'days' ? fillPerDay(data.perDay) : fillPerHour(data.perHour)
  const total = rows.reduce((sum, r) => sum + r.sent, 0)

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4">
      <div className="flex flex-col gap-2 border-b border-neutral-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
            <TrendingUp size={18} className="text-brand-600" aria-hidden="true" />
            <span>Envios por tempo</span>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {mode === 'days'
              ? `Mensagens enviadas nos últimos 30 dias (${data.timezone})`
              : `Mensagens enviadas hoje, por hora (${data.timezone})`}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="rounded-lg bg-neutral-100 px-2.5 py-1 font-mono text-xs font-bold text-dark-800">
            {total.toLocaleString('pt-BR')} envios
          </span>
          <div className="flex rounded-lg border border-neutral-200 p-0.5" role="tablist" aria-label="Período do gráfico">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'days'}
              onClick={() => setMode('days')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors duration-150 ${
                mode === 'days' ? 'bg-dark-800 text-white' : 'text-neutral-500 hover:text-dark-800'
              }`}
            >
              30 dias
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'hours'}
              onClick={() => setMode('hours')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors duration-150 ${
                mode === 'hours' ? 'bg-dark-800 text-white' : 'text-neutral-500 hover:text-dark-800'
              }`}
            >
              Hoje
            </button>
          </div>
        </div>
      </div>

      <div className="h-56">
        {mounted ? (
          <Suspense fallback={<ChartSkeleton />}>
            <SendsAreaChart rows={rows} showFailed={mode === 'days'} />
          </Suspense>
        ) : (
          <ChartSkeleton />
        )}
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return <div className="size-full animate-pulse rounded-lg bg-neutral-50" aria-hidden="true" />
}
