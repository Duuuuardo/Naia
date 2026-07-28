import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  BarChart3,
  CheckCheck,
  Clock,
  DollarSign,
  MessageSquare,
  Play,
  Star,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { InboxShell } from '../../components/inbox-shell'
import { Card, DashboardMetricCard, EmptyState, formatChannelName } from '../../components/ui'
import { fetchReportsSummary, getInboxAgent, type ReportsSummary } from '../../lib/inbox-session'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/inbox/relatorios')({
  head: () => createHeadConfig('Relatórios — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    // Relatórios gerais são só de admin/superadmin; agente vai ao pessoal.
    if (agent.role !== 'superadmin' && agent.role !== 'admin') {
      throw redirect({ to: '/inbox/meu-desempenho' })
    }
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const summary = await fetchReportsSummary({ data: { days: 7 } })
    return { agent, summary }
  },
  component: ReportsPage,
})

const PERIODS = [7, 30, 90] as const

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatCents(cents: number): string {
  return brl.format(cents / 100)
}

// "3 min 20 s" / "45 s" — tempo médio de primeira resposta.
function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds)
  if (seconds < 60) return `${seconds} s`
  const min = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${min} min` : `${min} min ${rest} s`
}

type BarItem = { label: string; value: number; display?: string }

// Estrelas 1-5 (lucide Star): cheias em amber até arredondar(value).
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

// Gráfico de barras verticais em divs (sem lib): barras brand-500, legenda neutra.
function BarChart({
  title,
  items,
  formatValue = String,
}: {
  title: string
  items: BarItem[]
  formatValue?: (value: number) => string
}) {
  const max = Math.max(...items.map((i) => i.value), 0)
  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-dark-800">{title}</h2>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">Sem dados no período.</p>
      ) : (
        <div className="mt-4 flex h-44 items-stretch gap-3">
          {items.map((item) => {
            const height = max === 0 ? 0 : Math.max((item.value / max) * 100, item.value > 0 ? 3 : 0)
            return (
              <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-semibold text-dark-800">
                  {item.display ?? formatValue(item.value)}
                </span>
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className="w-full max-w-12 rounded-t-md bg-brand-500 transition-[height] duration-300"
                    style={{ height: `${height}%` }}
                    role="img"
                    aria-label={`${item.label}: ${item.display ?? formatValue(item.value)}`}
                  />
                </div>
                <span className="w-full truncate text-center text-[11px] text-neutral-500" title={item.label}>
                  {item.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function ReportsPage() {
  const { agent, summary: initialSummary } = Route.useLoaderData()
  const [days, setDays] = useState<number>(7)
  const [summary, setSummary] = useState<ReportsSummary | null>(initialSummary)
  const [loading, setLoading] = useState(false)

  async function load(period: number) {
    setLoading(true)
    const data = await fetchReportsSummary({ data: { days: period } })
    setSummary(data)
    setLoading(false)
  }

  // O período inicial (7 dias) já veio do loader — só recarrega ao trocar.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    load(days)
  }, [days])

  const statusCount = (status: string) =>
    summary?.conversationsByStatus.find((r) => r.status === status)?.count ?? 0

  const openCount = statusCount('open')
  const inProgressCount = statusCount('assigned') + statusCount('pending')
  const resolvedCount = statusCount('resolved')

  // Média ponderada do tempo de primeira resposta entre os agentes.
  const responseAgents = summary?.firstResponseByAgent ?? []
  const totalResponseConvs = responseAgents.reduce((acc, r) => acc + r.conversations, 0)
  const avgFirstResponse =
    totalResponseConvs === 0
      ? null
      : responseAgents.reduce((acc, r) => acc + r.avgSeconds * r.conversations, 0) / totalResponseConvs

  const dealCount = (status: string) => summary?.deals.byStatus.find((r) => r.status === status)?.count ?? 0
  const wonDeals = dealCount('won')
  const lostDeals = dealCount('lost')
  const openValueCents = summary?.deals.openValueCents ?? 0

  const transfersTotal = (summary?.transfersByAgent ?? []).reduce((acc, r) => acc + r.count, 0)

  const csat = summary?.csat ?? null
  const csatMaxDistribution = Math.max(...(csat?.distribution.map((d) => d.count) ?? [0]), 0)

  const dealsByStatusLabel: Record<string, string> = { open: 'Em aberto', won: 'Ganhos', lost: 'Perdidos' }

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Relatórios</h1>
              <p className="mt-1 text-sm text-neutral-500">Desempenho do atendimento e do funil no período.</p>
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
          ) : !summary ? (
            <EmptyState
              icon={BarChart3}
              title="Não foi possível carregar os relatórios"
              description="Tente novamente em instantes."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DashboardMetricCard icon={MessageSquare} iconClassName="text-brand-500" label="Abertas" value={openCount} />
                <DashboardMetricCard icon={Play} iconClassName="text-blue-500" label="Em andamento" value={inProgressCount} />
                <DashboardMetricCard icon={CheckCheck} iconClassName="text-emerald-500" label="Resolvidas" value={resolvedCount} />
                <DashboardMetricCard
                  icon={Timer}
                  iconClassName="text-amber-500"
                  label="1ª resposta média"
                  value={avgFirstResponse === null ? '—' : formatDuration(avgFirstResponse)}
                />
                <DashboardMetricCard icon={TrendingUp} iconClassName="text-emerald-500" label="Deals ganhos" value={wonDeals} />
                <DashboardMetricCard icon={TrendingDown} iconClassName="text-error-500" label="Deals perdidos" value={lostDeals} />
                <DashboardMetricCard
                  icon={DollarSign}
                  iconClassName="text-brand-500"
                  label="Valor em aberto"
                  value={formatCents(openValueCents)}
                />
                <DashboardMetricCard
                  icon={ArrowLeftRight}
                  iconClassName="text-neutral-500"
                  label="Transferências"
                  value={transfersTotal}
                />
                <DashboardMetricCard
                  icon={Star}
                  iconClassName="text-amber-500"
                  label="CSAT médio"
                  value={csat?.averageScore?.toFixed(1) ?? '—'}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <BarChart
                  title="Conversas por fila"
                  items={summary.conversationsByQueue.map((r) => ({ label: r.queueName, value: r.count }))}
                />
                <BarChart
                  title="Tempo de 1ª resposta por agente"
                  items={summary.firstResponseByAgent.map((r) => ({
                    label: r.agentName,
                    value: r.avgSeconds,
                    display: formatDuration(r.avgSeconds),
                  }))}
                  formatValue={formatDuration}
                />
                <BarChart
                  title="Volume por canal"
                  items={summary.messagesByChannel.map((r) => ({
                    label: formatChannelName(r.channel),
                    value: r.count,
                  }))}
                />
                <BarChart
                  title="Deals por estágio"
                  items={summary.deals.byStatus.map((r) => ({
                    label: dealsByStatusLabel[r.status] ?? r.status,
                    value: r.count,
                    display: `${r.count} · ${formatCents(r.valueCents)}`,
                  }))}
                />
              </div>

              {csat && (
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-dark-800">Avaliação de atendimento (CSAT)</h2>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {csat.totalRatings} {csat.totalRatings === 1 ? 'avaliação' : 'avaliações'} no período
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Stars value={csat.averageScore ?? 0} />
                      <span className="text-xl font-extrabold text-dark-800">
                        {csat.averageScore?.toFixed(1) ?? '—'}
                      </span>
                    </div>
                  </div>

                  {csat.totalRatings === 0 ? (
                    <p className="py-8 text-center text-sm text-neutral-400">Sem avaliações no período.</p>
                  ) : (
                    <div className="mt-5 grid gap-6 md:grid-cols-2">
                      {/* Distribuição 1-5 (barras horizontais, nota 5 em cima) */}
                      <div className="space-y-2">
                        {[...csat.distribution].reverse().map((d) => (
                          <div key={d.score} className="flex items-center gap-2">
                            <span className="flex w-8 items-center gap-0.5 text-xs font-semibold text-dark-800">
                              {d.score}
                              <Star size={11} className="fill-amber-400 text-amber-400" aria-hidden="true" />
                            </span>
                            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
                                style={{
                                  width: csatMaxDistribution === 0 ? '0%' : `${(d.count / csatMaxDistribution) * 100}%`,
                                }}
                                role="img"
                                aria-label={`Nota ${d.score}: ${d.count}`}
                              />
                            </div>
                            <span className="w-8 text-right text-xs text-neutral-500">{d.count}</span>
                          </div>
                        ))}
                      </div>

                      {/* Média por agente (agente atribuído na resolução) */}
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Por agente</h3>
                        <ul className="mt-2 divide-y divide-neutral-100">
                          {csat.byAgent.map((row) => (
                            <li key={row.agentId ?? 'none'} className="flex items-center justify-between gap-3 py-2">
                              <span className="min-w-0 truncate text-sm font-medium text-dark-800">{row.agentName}</span>
                              <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                                <Stars value={row.averageScore} size={12} />
                                <span className="w-7 text-right font-semibold text-dark-800">
                                  {row.averageScore.toFixed(1)}
                                </span>
                                <span className="w-12 text-right">
                                  {row.totalRatings} {row.totalRatings === 1 ? 'nota' : 'notas'}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </Card>
              )}

              <p className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Clock size={12} aria-hidden="true" />
                Conversas, mensagens e transferências consideram os últimos {summary.periodDays} dias; deals
                refletem o estado atual do funil.
              </p>
            </>
          )}
        </div>
      </div>
    </InboxShell>
  )
}
