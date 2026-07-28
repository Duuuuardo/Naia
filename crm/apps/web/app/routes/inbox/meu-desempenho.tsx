import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  BarChart3,
  CheckCheck,
  Clock,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Send,
  Star,
  Timer,
} from 'lucide-react'
import { InboxShell } from '../../components/inbox-shell'
import { Button, Card, DashboardMetricCard, EmptyState } from '../../components/ui'
import { fetchPersonalReport, getInboxAgent, type ReportsPersonal } from '../../lib/inbox-session'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/inbox/meu-desempenho')({
  head: () => createHeadConfig('Meu desempenho — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const report = await fetchPersonalReport({ data: { days: 7 } })
    return { agent, report }
  },
  component: PersonalReportPage,
})

const PERIODS = [7, 30, 90] as const

// "3 min 20 s" / "45 s" — tempo médio de primeira resposta.
function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds)
  if (seconds < 60) return `${seconds} s`
  const min = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${min} min` : `${min} min ${rest} s`
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const filled = Math.round(value)
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${value.toFixed(1)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          aria-hidden="true"
          className={i <= filled ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}
        />
      ))}
    </span>
  )
}

function PersonalReportPage() {
  const { agent, report: initialReport } = Route.useLoaderData()
  const [days, setDays] = useState<number>(7)
  const [report, setReport] = useState<ReportsPersonal | null>(initialReport)
  const [loading, setLoading] = useState(false)

  async function load(period: number) {
    setLoading(true)
    const data = await fetchPersonalReport({ data: { days: period } })
    setReport(data)
    setLoading(false)
  }

  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    load(days)
  }, [days])

  const statusCount = (status: string) =>
    report?.assignedByStatus.find((r) => r.status === status)?.count ?? 0

  const inProgress = statusCount('assigned')
  const pending = statusCount('pending')

  const csat = report?.csat ?? null
  const csatMax = Math.max(...(csat?.distribution.map((d) => d.count) ?? [0]), 0)

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Meu desempenho</h1>
              <p className="mt-1 text-sm text-neutral-500">Seus atendimentos e avaliações no período.</p>
            </div>
            <div className="flex gap-1 self-start rounded-lg border border-neutral-200 bg-neutral-0 p-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDays(p)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    days === p ? 'bg-brand-50 text-brand-600' : 'text-neutral-500 hover:bg-neutral-100'
                  }`}
                >
                  {p} dias
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid place-items-center py-24 text-neutral-300">
              <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </div>
          ) : !report ? (
            <EmptyState
              icon={BarChart3}
              title="Não foi possível carregar o seu desempenho"
              description="O serviço pode estar iniciando. Tente novamente em instantes."
              action={
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => load(days)}>
                  Tentar novamente
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DashboardMetricCard icon={Play} iconClassName="text-blue-500" label="Em atendimento" value={inProgress} />
                <DashboardMetricCard icon={Pause} iconClassName="text-amber-500" label="Pendentes" value={pending} />
                <DashboardMetricCard
                  icon={CheckCheck}
                  iconClassName="text-emerald-500"
                  label="Resolvidas no período"
                  value={report.resolvedCount}
                />
                <DashboardMetricCard
                  icon={Timer}
                  iconClassName="text-amber-500"
                  label="1ª resposta média"
                  value={report.firstResponse.avgSeconds === null ? '—' : formatDuration(report.firstResponse.avgSeconds)}
                />
                <DashboardMetricCard
                  icon={Send}
                  iconClassName="text-brand-500"
                  label="Mensagens enviadas"
                  value={report.messagesSent}
                />
                <DashboardMetricCard
                  icon={ArrowLeftRight}
                  iconClassName="text-neutral-500"
                  label="Transferências"
                  value={report.transfersMade}
                />
                <DashboardMetricCard
                  icon={MessageSquare}
                  iconClassName="text-blue-500"
                  label="Conversas 1ª resposta"
                  value={report.firstResponse.conversations}
                />
                <DashboardMetricCard
                  icon={Star}
                  iconClassName="text-amber-500"
                  label="Meu CSAT médio"
                  value={csat?.averageScore?.toFixed(1) ?? '—'}
                />
              </div>

              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-dark-800">Minhas avaliações (CSAT)</h2>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {csat?.totalRatings ?? 0} {(csat?.totalRatings ?? 0) === 1 ? 'avaliação' : 'avaliações'} no período
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Stars value={csat?.averageScore ?? 0} />
                    <span className="text-xl font-extrabold text-dark-800">{csat?.averageScore?.toFixed(1) ?? '—'}</span>
                  </div>
                </div>

                {!csat || csat.totalRatings === 0 ? (
                  <p className="py-8 text-center text-sm text-neutral-400">Sem avaliações no período.</p>
                ) : (
                  <div className="mt-5 space-y-2">
                    {[...csat.distribution].reverse().map((d) => (
                      <div key={d.score} className="flex items-center gap-2">
                        <span className="flex w-8 items-center gap-0.5 text-xs font-semibold text-dark-800">
                          {d.score}
                          <Star size={11} className="fill-amber-400 text-amber-400" aria-hidden="true" />
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
                            style={{ width: csatMax === 0 ? '0%' : `${(d.count / csatMax) * 100}%` }}
                            role="img"
                            aria-label={`Nota ${d.score}: ${d.count}`}
                          />
                        </div>
                        <span className="w-8 text-right text-xs text-neutral-500">{d.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <p className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Clock size={12} aria-hidden="true" />
                Em atendimento e pendentes refletem o estado atual; resolvidas, mensagens, transferências e
                avaliações consideram os últimos {report.periodDays} dias.
              </p>
            </>
          )}
        </div>
      </div>
    </InboxShell>
  )
}
