import { createFileRoute, useLoaderData } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MessageCircle,
  MessageSquare,
  Plug,
  Send,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import {
  ChannelBadge,
  DashboardMetricCard,
  EmptyState,
  StatusBadge,
  WorkspaceDashboardHeader,
} from '../../../components/ui'
import { fetchConnections, fetchDashboardStats } from '../../../lib/actions'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/')({
  head: () => createHeadConfig('Início — Naia CRM'),
  loader: async ({ params }) => {
    const [stats, connections] = await Promise.all([
      fetchDashboardStats({ data: { workspaceId: params.workspaceId } }),
      fetchConnections({ data: { workspaceId: params.workspaceId } }),
    ])
    return { stats, connections }
  },
  component: WorkspaceHome,
})

function WorkspaceHome() {
  const { workspace, entitlements } = useLoaderData({ from: '/_app/$workspaceId' })
  const { stats, connections } = Route.useLoaderData()
  const { summary, conversationsByStatus } = stats

  const activeConversationUsage = percentage(
    summary.activeConversationsCount,
    entitlements.activeConversationsLimit,
  )
  const agentUsage = percentage(summary.agentsCount, entitlements.agentsLimit)
  const connectionUsage = percentage(summary.connectionsCount, entitlements.connectionsLimit)
  const totalConversations =
    conversationsByStatus.open +
    conversationsByStatus.assigned +
    conversationsByStatus.pending +
    conversationsByStatus.resolved
  const inboxUrl =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? `http://${workspace.slug}.localhost:${window.location.port || 3002}`
      : `https://${workspace.slug}.crm.naia.website`

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-20">
      <WorkspaceDashboardHeader
        workspaceName={workspace.name}
        planLabel={entitlements.plan}
        description="Acompanhe o volume de atendimento, a disponibilidade da equipe e a saúde dos seus canais."
        actions={
          <>
            <a
              href={inboxUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-0 px-4 py-2.5 text-xs font-bold text-dark-800 shadow-2xs transition-[background-color,transform] duration-150 hover:bg-neutral-50 active:scale-[0.97] md:flex-none"
            >
              <Plug size={15} className="text-emerald-600" aria-hidden="true" />
              <span>Canais ({summary.activeConnectionsCount})</span>
            </a>
            <a
              href={inboxUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-dark-800 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-dark-900 active:scale-[0.97] md:flex-none"
            >
              <ExternalLink size={15} aria-hidden="true" />
              <span>Abrir inbox</span>
            </a>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardMetricCard
          icon={MessageSquare}
          iconClassName="text-brand-600"
          label="Conversas ativas"
          value={summary.activeConversationsCount.toLocaleString('pt-BR')}
          aside={<LimitBadge value={entitlements.activeConversationsLimit} />}
          progress={entitlements.activeConversationsLimit < 0 ? undefined : activeConversationUsage}
          progressClassName={activeConversationUsage >= 90 ? 'bg-error-500' : 'bg-brand-500'}
          footer={
            <>
              <span>Uso do plano:</span>
              <strong className="font-mono text-dark-800">
                {summary.activeConversationsCount.toLocaleString('pt-BR')} de{' '}
                {formatLimit(entitlements.activeConversationsLimit)}
              </strong>
            </>
          }
        />
        <DashboardMetricCard
          icon={Clock3}
          iconClassName="text-amber-500"
          label="Aguardando agente"
          value={summary.unassignedConversationsCount.toLocaleString('pt-BR')}
          aside={
            <span className="shrink-0 self-start rounded border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
              Não atribuídas
            </span>
          }
          footer={
            <>
              <span>Conversas abertas:</span>
              <strong className="font-mono text-dark-800">{conversationsByStatus.open}</strong>
            </>
          }
        />
        <DashboardMetricCard
          icon={Users}
          iconClassName="text-purple-500"
          label="Agentes"
          value={summary.agentsCount.toLocaleString('pt-BR')}
          aside={<LimitBadge value={entitlements.agentsLimit} />}
          progress={entitlements.agentsLimit < 0 ? undefined : agentUsage}
          progressClassName={agentUsage >= 90 ? 'bg-error-500' : 'bg-dark-800'}
          footer={
            <>
              <span>Seats em uso ({summary.activeAgentsCount} ativados):</span>
              <strong className="font-mono text-dark-800">
                {summary.agentsCount.toLocaleString('pt-BR')} de {formatLimit(entitlements.agentsLimit)}
              </strong>
            </>
          }
        />
        <DashboardMetricCard
          icon={Plug}
          iconClassName="text-emerald-600"
          label="Conexões"
          value={summary.connectionsCount.toLocaleString('pt-BR')}
          aside={<LimitBadge value={entitlements.connectionsLimit} />}
          progress={entitlements.connectionsLimit < 0 ? undefined : connectionUsage}
          progressClassName={connectionUsage >= 90 ? 'bg-error-500' : 'bg-emerald-500'}
          footer={
            <>
              <span>Canais em uso ({summary.activeConnectionsCount} ativos):</span>
              <strong className="font-mono text-dark-800">
                {summary.connectionsCount.toLocaleString('pt-BR')} de {formatLimit(entitlements.connectionsLimit)}
              </strong>
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Conversas por status — mesmo padrão do card "Campanhas por status" do Campaigns */}
          <section className="space-y-5 rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xs">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
                  <MessageCircle size={18} className="text-brand-600" aria-hidden="true" />
                  Fluxo de atendimento
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Distribuição atual das conversas por etapa
                </p>
              </div>
              <a
                href={inboxUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700"
              >
                <span>Ver no inbox</span> <ArrowRight size={13} aria-hidden="true" />
              </a>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatusCount
                label="Abertas"
                value={conversationsByStatus.open}
                total={totalConversations}
                className="border-brand-200/80 bg-brand-50/50 text-brand-800"
              />
              <StatusCount
                label="Em atendimento"
                value={conversationsByStatus.assigned}
                total={totalConversations}
                className="border-blue-200/80 bg-blue-50/50 text-blue-800"
              />
              <StatusCount
                label="Pendentes"
                value={conversationsByStatus.pending}
                total={totalConversations}
                className="border-amber-200/80 bg-amber-50/50 text-amber-800"
              />
              <StatusCount
                label="Resolvidas"
                value={conversationsByStatus.resolved}
                total={totalConversations}
                className="border-emerald-200/80 bg-emerald-50/50 text-emerald-800"
              />
            </div>
          </section>

          {/* Conversas recentes — mesmo padrão da tabela "Campanhas recentes" do Campaigns */}
          <section className="flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-0 shadow-2xs">
            <div className="flex items-center justify-between border-b border-neutral-200/80 bg-neutral-50/50 p-5">
              <div>
                <h2 className="font-display text-base font-bold text-dark-800">Conversas recentes</h2>
                <p className="mt-0.5 text-xs text-neutral-500">Últimas atividades recebidas no workspace</p>
              </div>
              <a
                href={inboxUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-bold text-dark-800 hover:underline"
              >
                Ver no inbox <ArrowRight size={13} aria-hidden="true" />
              </a>
            </div>

            <div className="flex-1 overflow-x-auto">
              {stats.recentConversations.length > 0 ? (
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-neutral-200/80 bg-neutral-50/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="py-3.5 pl-6 pr-4">Contato</th>
                      <th className="px-4 py-3.5">Canal</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="py-3.5 pl-4 pr-6 text-right">Atualizada em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
                    {stats.recentConversations.map((conversation) => (
                      <tr key={conversation.id} className="transition-colors hover:bg-neutral-50/80">
                        <td className="py-4 pl-6 pr-4 font-bold text-dark-800">{conversation.contactName}</td>
                        <td className="px-4 py-4">
                          <ChannelBadge channel={conversation.originChannel} />
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={conversation.status} />
                        </td>
                        <td className="py-4 pl-4 pr-6 text-right font-mono text-xs text-neutral-400">
                          {formatDate(conversation.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6">
                  <EmptyState
                    icon={MessageSquare}
                    title="Nenhuma conversa registrada"
                    description="Quando uma mensagem chegar por um canal conectado, ela aparecerá aqui e no inbox."
                    action={
                      <a
                        href={inboxUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-dark-800 px-4 py-2.5 text-xs font-bold text-white transition-[background-color,transform] duration-150 hover:bg-dark-900 active:scale-[0.97]"
                      >
                        <Plug size={14} aria-hidden="true" />
                        <span>Conectar canal</span>
                      </a>
                    }
                  />
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Canais conectados — mesmo padrão do card homônimo do Campaigns */}
          <section className="space-y-4 rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xs">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold text-dark-800">
                <Plug size={16} aria-hidden="true" />
                Canais conectados
              </h2>
              <a
                href={inboxUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-brand-600 hover:underline"
              >
                Gerenciar
              </a>
            </div>
            {connections.length > 0 ? (
              <div className="space-y-3">
                {connections.slice(0, 4).map((connection) => (
                  <div
                    key={connection.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {connection.kind === 'whatsapp' ? (
                        <MessageCircle size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <Send size={16} className="shrink-0 text-blue-500" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-dark-800">{connection.name}</p>
                        <p className="text-[11px] text-neutral-500">
                          {connection.kind === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={connection.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-5 text-center">
                <p className="text-xs text-neutral-500">Nenhum canal configurado.</p>
                <a
                  href={inboxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline"
                >
                  Adicionar canal <ArrowRight size={12} aria-hidden="true" />
                </a>
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xs">
            <div className="border-b border-neutral-100 pb-4">
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-dark-800">
                <UserRoundCheck size={18} className="text-brand-600" aria-hidden="true" />
                Pronto para atender
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">Itens essenciais do workspace</p>
            </div>
            <ChecklistItem done={summary.connectionsCount > 0} label="Canal configurado" />
            <ChecklistItem done={summary.activeConnectionsCount > 0} label="Canal conectado" />
            <ChecklistItem done={summary.activeAgentsCount > 0} label="Agente ativado" />
          </section>
        </div>
      </div>
    </div>
  )
}

function LimitBadge({ value }: { value: number }) {
  return (
    <span className="shrink-0 self-start rounded border border-neutral-200/80 bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">
      Limite: {formatLimit(value)}
    </span>
  )
}

function StatusCount({
  label,
  value,
  total,
  className,
}: {
  label: string
  value: number
  total: number
  className: string
}) {
  return (
    <div className={`space-y-1 rounded-xl border p-3.5 ${className}`}>
      <span className="block text-[11px] font-bold uppercase tracking-wider">{label}</span>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-2xl font-extrabold">{value.toLocaleString('pt-BR')}</span>
        <span className="font-mono text-[11px] opacity-80">
          {total > 0 ? Math.round((value / total) * 100) : 0}%
        </span>
      </div>
    </div>
  )
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-xs font-medium text-neutral-600">
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full ${
          done ? 'bg-success-500/10 text-success-500' : 'bg-neutral-100 text-neutral-400'
        }`}
      >
        {done ? <CheckCircle2 size={13} aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      {label}
    </div>
  )
}

function percentage(value: number, limit: number): number {
  if (limit < 0) return 0
  if (limit === 0) return value > 0 ? 100 : 0
  return Math.min(100, Math.round((value / limit) * 100))
}

function formatLimit(limit: number): string {
  return limit < 0 ? '∞' : limit.toLocaleString('pt-BR')
}

function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
