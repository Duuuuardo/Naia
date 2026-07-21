import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  Clock,
  Megaphone,
  Plus,
  Search,
  MessageCircle,
  Send,
  CheckCircle2,
  AlertCircle,
  Filter,
  BarChart2,
  Calendar,
  Layers,
} from 'lucide-react'
import { fetchCampaigns } from '../../../../lib/actions'
import { Card, EmptyState, PageHeader, StatusBadge, ChannelBadge } from '../../../../components/ui'
import { createHeadConfig } from '~/lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/campaigns/')({ head: () => createHeadConfig('Campanhas — Naia Campanhas'),
  loader: ({ params }) => fetchCampaigns({ data: params.workspaceId }),
  component: CampaignsPage,
})

const STATUS_TABS = [
  { id: 'all', label: 'Todas' },
  { id: 'running', label: 'Em andamento' },
  { id: 'scheduled', label: 'Agendadas' },
  { id: 'completed', label: 'Concluídas' },
  { id: 'draft', label: 'Rascunhos' },
  { id: 'failed', label: 'Falhas' },
]

function CampaignsPage() {
  const campaigns = Route.useLoaderData()
  const { workspaceId } = Route.useParams()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all')

  useEffect(() => {
    const needsPolling = campaigns.some((c) => ['running', 'scheduled', 'draft'].includes(c.status))
    if (!needsPolling) return
    const interval = setInterval(() => { router.invalidate() }, 3000)
    return () => clearInterval(interval)
  }, [campaigns, router])

  const filtered = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase())
    if (!matchesSearch) return false
    if (activeTab === 'all') return true
    if (activeTab === 'failed') return c.status === 'failed' || c.status === 'cancelled'
    return c.status === activeTab
  })

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-dark-800 tracking-tight">Campanhas</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Acompanhe o envio e a leitura das suas campanhas.
          </p>
        </div>
        <Link
          to="/$workspaceId/campaigns/new"
          params={{ workspaceId }}
          className="inline-flex h-10 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-dark-800 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-dark-900 active:scale-[0.98]"
        >
          <Plus size={16} />
          <span>Criar campanha</span>
        </Link>
      </div>

      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-neutral-200/80 pb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {STATUS_TABS.map((tab) => {
            const count = tab.id === 'all'
              ? campaigns.length
              : tab.id === 'failed'
                ? campaigns.filter((c) => c.status === 'failed' || c.status === 'cancelled').length
                : campaigns.filter((c) => c.status === tab.id).length
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-dark-800 text-white shadow-xs'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/80'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative min-w-[280px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome da campanha..."
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-neutral-200/80 bg-white text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        campaigns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center space-y-4">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <Megaphone size={28} />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h3 className="text-base font-bold text-dark-800">Nenhuma campanha criada ainda</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Comece agora a segmentar seus contatos e enviar mensagens no WhatsApp ou Telegram.
              </p>
            </div>
            <Link
              to="/$workspaceId/campaigns/new"
              params={{ workspaceId }}
              className="inline-flex items-center gap-2 rounded-xl bg-dark-800 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-dark-900 transition-all"
            >
              <Plus size={15} />
              <span>Criar primeira campanha</span>
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-neutral-500 text-sm font-medium">
            Nenhuma campanha encontrada.
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-neutral-200/80 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead className="bg-neutral-50/80 border-b border-neutral-100 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">Campanha</th>
                  <th className="py-3.5 px-4">Canal</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 min-w-[180px]">Progresso</th>
                  <th className="py-3.5 px-4">Lidas / Entregues</th>
                  <th className="py-3.5 px-4">Falhas</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Criada em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-600">
                {filtered.map((c) => {
                  const totalProcessed = c.sentCount + c.deliveredCount + c.readCount
                  const progressPct = c.totalContacts > 0 ? Math.round((totalProcessed / c.totalContacts) * 100) : 0
                  const readPct = c.totalContacts > 0 ? Math.round((c.readCount / c.totalContacts) * 100) : 0

                  return (
                    <tr key={c.id} className="hover:bg-neutral-50/80 transition-colors group">
                      <td className="py-4 pl-6 pr-4">
                        <Link
                          to="/$workspaceId/campaigns/$campaignId"
                          params={{ workspaceId, campaignId: c.id }}
                          className="font-bold text-dark-800 hover:text-brand-600 block transition-colors text-base"
                        >
                          {c.name}
                        </Link>
                        {c.scheduledAt && (
                          <span className="text-[11px] text-amber-700 font-medium flex items-center gap-1 mt-1 font-mono bg-amber-50 px-2 py-0.5 rounded w-fit border border-amber-200/50">
                            <Clock size={12} className="shrink-0" />
                            <span>Agendada: {new Date(c.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <ChannelBadge channel={c.channel} />
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="py-4 px-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs font-mono font-medium text-dark-800">
                            <span>{totalProcessed} de {c.totalContacts} envios</span>
                            <span className="text-neutral-400 font-bold">{progressPct}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                c.status === 'completed' ? 'bg-emerald-500' : c.status === 'failed' ? 'bg-error-500' : 'bg-brand-500'
                              }`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-dark-800">{c.readCount} lidas</span>
                          <span className="text-[11px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">
                            {readPct}%
                          </span>
                        </div>
                        <span className="text-[11px] text-neutral-400 block mt-0.5">
                          Entregues: {c.deliveredCount}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        {c.failedCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-error-600 bg-error-50 px-2 py-0.5 rounded border border-error-200">
                            <AlertCircle size={12} />
                            {c.failedCount}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-300 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-4 pl-4 pr-6 text-right text-xs text-neutral-400 font-mono">
                        {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
