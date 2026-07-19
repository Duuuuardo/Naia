import { createFileRoute, useLoaderData, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  MessageCircle,
  PlusCircle,
  Send,
  Users,
  Wifi,
  AlertCircle,
  BarChart2,
  TrendingUp,
  MapPin,
  Filter,
  Activity,
  Layers,
  ArrowUpRight,
  Zap,
} from 'lucide-react'
import { fetchDashboardStats, fetchSendsTimeseries } from '../../../lib/actions'
import { StatusBadge, ChannelBadge } from '../../../components/ui'
import { SendsTimeseriesCard } from '../../../components/charts'

export const Route = createFileRoute('/_app/$workspaceId/')({
  loader: async ({ params }) => {
    const [stats, timeseries] = await Promise.all([
      fetchDashboardStats({ data: params.workspaceId }),
      fetchSendsTimeseries({ data: { workspaceId: params.workspaceId } }),
    ])
    return { stats, timeseries }
  },
  component: WorkspaceHome,
})

function WorkspaceHome() {
  const { workspace, entitlements: ent } = useLoaderData({ from: '/_app/$workspaceId' })
  const { stats, timeseries } = Route.useLoaderData()

  const summary = stats?.summary ?? {
    totalCampaigns: 0,
    totalContacts: 0,
    optedOutContacts: 0,
    activeConnections: 0,
    activeWaConnections: 0,
    activeTgConnections: 0,
    totalContactsSum: 0,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0,
  }

  const usage = stats?.usage ?? {
    connectionsCount: 0,
    contactsCount: 0,
    campaignsThisMonth: 0,
  }

  const msgByStatus = stats?.messagesByStatus ?? {
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
  }

  const campByStatus = stats?.campaignsByStatus ?? {
    draft: 0,
    scheduled: 0,
    running: 0,
    completed: 0,
    cancelled: 0,
    failed: 0,
  }

  const stateUF = stats?.contactsByStateUF ?? {}
  const totalStateUFContacts = Object.values(stateUF).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
  const sortedStateUF = Object.entries(stateUF)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 6)

  const totalDispatched = (summary.sentCount || 0) + (summary.deliveredCount || 0) + (summary.readCount || 0)
  const deliveryRate = totalDispatched > 0 ? Math.round(((summary.deliveredCount + summary.readCount) / totalDispatched) * 100) : 0
  const readRate = totalDispatched > 0 ? Math.round((summary.readCount / totalDispatched) * 100) : 0
  const creditsPercentage = Math.min(100, Math.round((ent.creditsBalance / Math.max(1, ent.creditsPerCycle)) * 100))

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs font-bold uppercase text-neutral-500 tracking-wider">
              Workspace · {workspace.name}
            </span>
            <span className="h-3 w-px bg-neutral-300" />
            <span className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200/60 px-2.5 py-0.5 rounded-md shadow-2xs">
              Plano {ent.tier}
            </span>
          </div>
          <h1 className="font-display text-2xl font-extrabold text-dark-800 tracking-tight">
            Visão geral
          </h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-xl leading-relaxed">
            Métricas de envio, entrega e leitura das suas campanhas em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
          <Link
            to="/$workspaceId/connections"
            params={{ workspaceId: workspace.id }}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-dark-800 hover:bg-neutral-50 active:scale-[0.97] transition-all duration-150 shadow-2xs"
          >
            <Wifi size={15} className="text-emerald-600 animate-pulse" />
            <span>Canais ({summary.activeConnections})</span>
          </Link>
          <Link
            to="/$workspaceId/campaigns/new"
            params={{ workspaceId: workspace.id }}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-dark-800 text-xs font-bold text-white hover:bg-dark-900 active:scale-[0.97] transition-all duration-150 shadow-sm"
          >
            <PlusCircle size={15} />
            <span>Nova campanha</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs hover:border-neutral-300 transition-all duration-200 space-y-2 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Créditos restantes
            </span>
            <Zap size={14} className="text-amber-500 group-hover:scale-110 transition-transform duration-200" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="font-display text-3xl font-extrabold text-dark-800 tracking-tight">
              {ent.creditsBalance.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                creditsPercentage <= 10 ? 'bg-error-500' : 'bg-brand-500'
              }`}
              style={{ width: `${creditsPercentage}%` }}
            />
          </div>
          <p className="text-xs font-medium text-neutral-500 pt-1 flex items-center justify-between border-t border-neutral-100 mt-2">
            <span>Total no ciclo:</span>
            <span className="font-mono font-bold text-dark-800">{ent.creditsPerCycle.toLocaleString('pt-BR')}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs hover:border-neutral-300 transition-all duration-200 space-y-2 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Campanhas no mês
            </span>
            <Layers size={14} className="text-blue-500 group-hover:scale-110 transition-transform duration-200" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="font-display text-3xl font-extrabold text-dark-800 tracking-tight">
              {usage.campaignsThisMonth}
            </span>
            <span className="shrink-0 self-start text-xs font-bold text-neutral-600 bg-neutral-100 border border-neutral-200/80 px-2 py-0.5 rounded">
              Limite: {ent.campaignsPerMonth}
            </span>
          </div>
          <p className="text-xs font-medium text-neutral-500 pt-1 flex items-center justify-between border-t border-neutral-100 mt-2">
            <span>Total acumulado:</span>
            <span className="font-bold text-dark-800">{summary.totalCampaigns}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs hover:border-neutral-300 transition-all duration-200 space-y-2 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Contatos ativos
            </span>
            <Users size={14} className="text-purple-500 group-hover:scale-110 transition-transform duration-200" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="font-display text-3xl font-extrabold text-dark-800 tracking-tight">
              {(summary.totalContacts - summary.optedOutContacts).toLocaleString('pt-BR')}
            </span>
            <span className="shrink-0 self-start text-xs font-bold text-neutral-600 bg-neutral-100 border border-neutral-200/80 px-2 py-0.5 rounded">
              Total: {summary.totalContacts.toLocaleString('pt-BR')}
            </span>
          </div>
          <p className="text-xs font-medium text-neutral-500 pt-1 flex items-center justify-between border-t border-neutral-100 mt-2">
            <span>Descadastrados (opt-out):</span>
            <span className="font-mono font-bold text-dark-800">{summary.optedOutContacts}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs hover:border-neutral-300 transition-all duration-200 space-y-2 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Taxa de leitura
            </span>
            <TrendingUp size={14} className="text-emerald-600 group-hover:scale-110 transition-transform duration-200" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="font-display text-3xl font-extrabold text-dark-800 tracking-tight">
              {readRate}%
            </span>
            <span className="shrink-0 self-start text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded inline-flex items-center gap-1">
              <span>Entrega: {deliveryRate}%</span>
            </span>
          </div>
          <p className="text-xs font-medium text-neutral-500 pt-1 flex items-center justify-between border-t border-neutral-100 mt-2">
            <span>Lidas: {summary.readCount.toLocaleString('pt-BR')}</span>
            <span>Entregues: {summary.deliveredCount.toLocaleString('pt-BR')}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Gráfico 0: Envios por tempo (30 dias / hoje por hora) */}
          <SendsTimeseriesCard data={timeseries} />

          {/* Gráfico 1: Funil de Entrega & Leitura */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-4">
              <div>
                <h2 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
                  <Activity size={18} className="text-brand-600" />
                  <span>Funil de mensagens</span>
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Taxa de conversão entre envio, entrega e leitura na base
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-dark-800 bg-neutral-100 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                {totalDispatched.toLocaleString('pt-BR')} enviadas
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-neutral-700 font-bold flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-blue-500" />
                    <span>Enviadas</span>
                  </span>
                  <span className="font-mono font-bold text-dark-800">
                    {totalDispatched.toLocaleString('pt-BR')} <span className="text-neutral-400 font-normal">(100%)</span>
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: '100%' }} />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-neutral-700 font-bold flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    <span>Entregues</span>
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    {(summary.deliveredCount + summary.readCount).toLocaleString('pt-BR')} <span className="text-neutral-400 font-normal">({deliveryRate}%)</span>
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out" style={{ width: `${deliveryRate}%` }} />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-neutral-700 font-bold flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-brand-600" />
                    <span>Lidas</span>
                  </span>
                  <span className="font-mono font-bold text-brand-700">
                    {summary.readCount.toLocaleString('pt-BR')} <span className="text-neutral-400 font-normal">({readRate}%)</span>
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-600 transition-all duration-500 ease-out" style={{ width: `${readRate}%` }} />
                </div>
              </div>

              {summary.failedCount > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-error-600 font-bold flex items-center gap-1.5">
                      <AlertCircle size={13} className="text-error-500" />
                      <span>Falhas no envio</span>
                    </span>
                    <span className="font-mono font-bold text-error-600">
                      {summary.failedCount.toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Gráfico 2: Separação de Campanhas por Status */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
              <div>
                <h2 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
                  <BarChart2 size={18} className="text-dark-800" />
                  <span>Campanhas por status</span>
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Distribuição das campanhas no workspace
                </p>
              </div>
              <Link
                to="/$workspaceId/campaigns"
                params={{ workspaceId: workspace.id }}
                className="text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <span>Ver todas</span> <ArrowRight size={13} />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 block">
                  Concluídas
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold text-emerald-900">
                    {campByStatus.completed || 0}
                  </span>
                  <span className="text-[11px] font-mono text-emerald-700">
                    {summary.totalCampaigns > 0 ? Math.round(((campByStatus.completed || 0) / summary.totalCampaigns) * 100) : 0}%
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-brand-200/80 bg-brand-50/50 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-800 block">
                  Em andamento
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold text-brand-900">
                    {campByStatus.running || 0}
                  </span>
                  <span className="text-[11px] font-mono text-brand-700">
                    {summary.totalCampaigns > 0 ? Math.round(((campByStatus.running || 0) / summary.totalCampaigns) * 100) : 0}%
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-amber-200/80 bg-amber-50/50 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 block">
                  Agendadas
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold text-amber-900">
                    {campByStatus.scheduled || 0}
                  </span>
                  <span className="text-[11px] font-mono text-amber-700">
                    {summary.totalCampaigns > 0 ? Math.round(((campByStatus.scheduled || 0) / summary.totalCampaigns) * 100) : 0}%
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-neutral-200/80 bg-neutral-50/80 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600 block">
                  Rascunhos
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold text-dark-800">
                    {campByStatus.draft || 0}
                  </span>
                  <span className="text-[11px] font-mono text-neutral-500">
                    {summary.totalCampaigns > 0 ? Math.round(((campByStatus.draft || 0) / summary.totalCampaigns) * 100) : 0}%
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-error-200/80 bg-error-50/50 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-error-800 block">
                  Falhas
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold text-error-900">
                    {campByStatus.failed || 0}
                  </span>
                  <span className="text-[11px] font-mono text-error-700">
                    {summary.totalCampaigns > 0 ? Math.round(((campByStatus.failed || 0) / summary.totalCampaigns) * 100) : 0}%
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-neutral-200/80 bg-neutral-50/80 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600 block">
                  Canceladas
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-extrabold text-dark-800">
                    {campByStatus.cancelled || 0}
                  </span>
                  <span className="text-[11px] font-mono text-neutral-500">
                    {summary.totalCampaigns > 0 ? Math.round(((campByStatus.cancelled || 0) / summary.totalCampaigns) * 100) : 0}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Separação por Estado Geográfico (UF) & Canais Ativos */}
        <div className="space-y-6">
          {/* Gráfico 3: Separação Geográfica de Contatos por Estado UF */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-3">
              <div>
                <h3 className="font-display text-sm font-bold text-dark-800 flex items-center gap-2">
                  <MapPin size={16} className="text-brand-600" />
                  <span>Contatos por Estado (UF)</span>
                </h3>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  Distribuição geográfica por DDD
                </p>
              </div>
              <span className="shrink-0 self-start sm:self-center text-xs font-mono font-bold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded">
                {totalStateUFContacts} contatos
              </span>
            </div>

            <div className="space-y-3">
              {sortedStateUF.length > 0 ? (
                sortedStateUF.map(([uf, count]) => {
                  const pct = totalStateUFContacts > 0 ? Math.round((Number(count) / totalStateUFContacts) * 100) : 0
                  return (
                    <div key={uf} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="font-bold text-dark-800 flex items-center gap-1.5">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-neutral-100 font-mono text-[10px] uppercase font-bold text-neutral-700">
                            {uf}
                          </span>
                          <span className="text-neutral-500 text-[11px]">
                            {uf === 'SP' ? 'SP (11-19)' : uf === 'RJ' ? 'RJ (21-24)' : uf === 'MG' ? 'MG (31-38)' : uf === 'PR' ? 'PR (41-46)' : uf === 'RS' ? 'RS (51-55)' : uf}
                          </span>
                        </span>
                        <span className="font-mono font-bold text-dark-800">
                          {Number(count).toLocaleString('pt-BR')} <span className="text-neutral-400 font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-dark-800 transition-all duration-500 ease-out"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-6 text-center text-xs text-neutral-400">
                  Nenhum telefone com DDD cadastrado.
                </div>
              )}
            </div>
          </div>

          {/* Canais de Comunicação Card */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="font-display text-sm font-bold text-dark-800 flex items-center gap-2">
                <Wifi size={16} className="text-dark-800" />
                <span>Canais conectados</span>
              </h3>
              <Link
                to="/$workspaceId/connections"
                params={{ workspaceId: workspace.id }}
                className="text-xs font-bold text-brand-600 hover:underline"
              >
                Gerenciar
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
                <div className="flex items-center gap-2.5 min-w-0">
                  <MessageCircle size={16} className="text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-dark-800 block">WhatsApp</span>
                    <span className="text-[11px] text-neutral-500">Números conectados</span>
                  </div>
                </div>
                <span className="shrink-0 self-start sm:self-center font-mono font-bold text-dark-800 bg-white px-2 py-1 rounded border border-neutral-200 whitespace-nowrap">
                  {summary.activeWaConnections ?? summary.activeConnections} ativos
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Send size={16} className="text-blue-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-dark-800 block">Telegram</span>
                    <span className="text-[11px] text-neutral-500">Contas conectadas</span>
                  </div>
                </div>
                <span className="shrink-0 self-start sm:self-center font-mono font-bold text-dark-800 bg-white px-2 py-1 rounded border border-neutral-200 whitespace-nowrap">
                  {summary.activeTgConnections ?? 0} ativos
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campanhas Recentes Table */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-2xs overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-neutral-200/80 bg-neutral-50/50">
          <div>
            <h2 className="font-display text-base font-bold text-dark-800">
              Campanhas recentes
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Últimas campanhas criadas no workspace
            </p>
          </div>
          <Link
            to="/$workspaceId/campaigns"
            params={{ workspaceId: workspace.id }}
            className="text-xs font-bold text-dark-800 hover:underline flex items-center gap-1"
          >
            Ver todas ({summary.totalCampaigns}) <ArrowRight size={13} />
          </Link>
        </div>

        <div className="flex-1 overflow-x-auto -mx-5 px-5">
          {stats?.recentCampaigns && stats.recentCampaigns.length > 0 ? (
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead className="bg-neutral-50/80 border-b border-neutral-200/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">Campanha</th>
                  <th className="py-3.5 px-4">Canal</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Contatos</th>
                  <th className="py-3.5 px-4">Lidas / Entregues</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Criada em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-700 font-medium">
                {stats.recentCampaigns.map((camp: any) => {
                  const campRate = camp.totalContacts > 0 ? Math.round((camp.readCount / camp.totalContacts) * 100) : 0
                  return (
                    <tr key={camp.id} className="hover:bg-neutral-50/80 transition-colors group">
                      <td className="py-4 pl-6 pr-4">
                        <Link
                          to="/$workspaceId/campaigns/$campaignId"
                          params={{ workspaceId: workspace.id, campaignId: camp.id }}
                          className="font-bold text-dark-800 group-hover:text-brand-600 transition-colors block text-base"
                        >
                          {camp.name}
                        </Link>
                      </td>
                      <td className="py-4 px-4">
                        <ChannelBadge channel={camp.channel} />
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={camp.status} />
                      </td>
                      <td className="py-4 px-4 font-mono text-xs font-bold text-dark-800">
                        {camp.totalContacts.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-dark-800">{camp.readCount.toLocaleString('pt-BR')} lidas</span>
                          <span className="text-[11px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">
                            {campRate}%
                          </span>
                        </div>
                        <span className="text-[11px] text-neutral-400 block mt-0.5 font-mono">
                          Entregues: {camp.deliveredCount.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="py-4 pl-4 pr-6 text-right font-mono text-xs text-neutral-400">
                        {new Date(camp.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-12 text-center space-y-3">
              <p className="text-sm font-bold text-dark-800">Nenhum disparo registrado</p>
              <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                Crie sua primeira campanha para iniciar o envio automatizado e visualização do funil em tempo real.
              </p>
              <div className="pt-2">
                <Link
                  to="/$workspaceId/campaigns/new"
                  params={{ workspaceId: workspace.id }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-dark-800 text-xs font-bold text-white hover:bg-dark-900 active:scale-[0.97] transition-all duration-150"
                >
                  <PlusCircle size={14} />
                  <span>Criar campanha</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

