import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  CalendarClock,
  CheckCheck,
  Eye,
  Gauge,
  Loader2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plug,
  Send,
  Users,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  cancelCampaign,
  dispatchCampaign,
  fetchCampaign,
  fetchCampaignMessages,
  fetchCampaignRuns,
  pauseCampaign,
  resumeCampaign,
} from '../../../../lib/actions'
import { Button, Card, ErrorNote, PageHeader, Stat, StatusBadge } from '../../../../components/ui'
import { WEEKDAY_LABELS } from '../../../../components/campaign-wizard/types'

export const Route = createFileRoute('/_app/$workspaceId/campaigns/$campaignId')({
  loader: async ({ params }) => {
    const result = await fetchCampaign({ data: { workspaceId: params.workspaceId, campaignId: params.campaignId } })
    if (!result?.campaign) throw redirect({ to: '/$workspaceId/campaigns', params: { workspaceId: params.workspaceId } })
    const [messages, runsRes] = await Promise.all([
      fetchCampaignMessages({ data: { workspaceId: params.workspaceId, campaignId: params.campaignId } }),
      fetchCampaignRuns({ data: { workspaceId: params.workspaceId, campaignId: params.campaignId } }),
    ])
    return {
      campaign: result.campaign,
      connections: result.connections,
      variants: result.variants,
      messages,
      runs: runsRes.runs,
    }
  },
  component: CampaignDetailPage,
})

function describeSchedule(scheduleJson: string | null, timezone: string | null): string {
  try {
    const s = JSON.parse(scheduleJson ?? '{"type":"immediate"}')
    let base: string
    if (s.type === 'once' && s.onceAt) {
      base = `Uma vez em ${new Date(s.onceAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    } else if (s.type === 'recurring' && s.recurrence) {
      const r = s.recurrence
      if (r.kind === 'daily') base = `Todos os dias às ${r.time ?? '—'}`
      else if (r.kind === 'weekly') base = `${(r.weekdays ?? []).map((d: number) => WEEKDAY_LABELS[d]).join(', ')} às ${r.time ?? '—'}`
      else if (r.kind === 'every_x_hours') base = `A cada ${r.everyHours ?? '?'} horas`
      else base = `${r.timesPerDay ?? '?'} vezes por dia`
      if (r.endDate) base += ` até ${r.endDate}`
      if (r.maxOccurrences) base += ` (máx. ${r.maxOccurrences}x)`
    } else {
      base = 'Disparo imediato'
    }
    const extras: string[] = []
    if (s.workingHours) extras.push(`janela ${s.workingHours.start}–${s.workingHours.end}`)
    if (s.dailyCap) extras.push(`máx. ${s.dailyCap} msgs/dia`)
    if (timezone && timezone !== 'America/Sao_Paulo') extras.push(timezone)
    return extras.length > 0 ? `${base} · ${extras.join(' · ')}` : base
  } catch {
    return 'Disparo imediato'
  }
}

function describeSpeed(speedJson: string | null): string {
  try {
    const s = JSON.parse(speedJson ?? '{"preset":"medio"}')
    const names: Record<string, string> = { lento: 'Lento', medio: 'Médio', rapido: 'Rápido', manual: 'Manual' }
    let base = names[s.preset] ?? 'Médio'
    if (s.preset === 'manual' && s.minSeconds) base += ` (${s.minSeconds}–${s.maxSeconds ?? s.minSeconds}s)`
    if (s.pauseEveryN) base += ` · pausa a cada ${s.pauseEveryN} envios`
    return base
  } catch {
    return 'Médio'
  }
}

function CampaignDetailPage() {
  const { campaign, connections, messages, runs } = Route.useLoaderData()
  const { workspaceId, campaignId } = Route.useParams()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDispatch, setConfirmingDispatch] = useState(false)
  const [consent, setConsent] = useState(false)
  const [runFilter, setRunFilter] = useState<string>('')
  const [filteredMessages, setFilteredMessages] = useState<typeof messages | null>(null)

  useEffect(() => {
    if (!['running', 'scheduled'].includes(campaign.status)) return
    const interval = setInterval(() => {
      router.invalidate()
    }, 3000)
    return () => clearInterval(interval)
  }, [campaign.status, router])

  useEffect(() => {
    if (!runFilter) {
      setFilteredMessages(null)
      return
    }
    let cancelled = false
    fetchCampaignMessages({ data: { workspaceId, campaignId, runId: runFilter } }).then((result) => {
      if (!cancelled) setFilteredMessages(result)
    })
    return () => {
      cancelled = true
    }
  }, [runFilter, workspaceId, campaignId])

  async function act(action: () => Promise<{ error?: string; message?: string } | { ok: true } | void>) {
    setBusy(true)
    setError(null)
    setFeedback(null)
    const result = await action()
    setBusy(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
      return
    }
    if (result && 'message' in result && result.message) setFeedback(result.message)
    await router.invalidate()
  }

  const editable = ['draft', 'scheduled', 'paused'].includes(campaign.status)
  const shownMessages = filteredMessages ?? messages

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span className="font-mono text-xs uppercase text-neutral-400">[{campaign.channel}]</span>
            {campaign.kind === 'automation' && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                Automação
              </span>
            )}
          </span>
        }
      >
        {editable && (
          <Button variant="secondary" icon={Pencil} disabled={busy} onClick={() =>
            router.navigate({ to: '/$workspaceId/campaigns/$campaignId/edit', params: { workspaceId, campaignId } })
          }>
            Editar
          </Button>
        )}
        {['draft', 'scheduled'].includes(campaign.status) && (
          <Button icon={Zap} disabled={busy} onClick={() => setConfirmingDispatch((v) => !v)}>
            {campaign.status === 'scheduled' ? 'Disparar agora' : 'Disparar'}
          </Button>
        )}
        {['running', 'scheduled'].includes(campaign.status) && (
          <Button variant="secondary" icon={Pause} loading={busy} onClick={() => act(() => pauseCampaign({ data: { workspaceId, campaignId } }))}>
            Pausar
          </Button>
        )}
        {campaign.status === 'paused' && (
          <Button icon={Play} loading={busy} onClick={() => act(() => resumeCampaign({ data: { workspaceId, campaignId } }))}>
            Retomar
          </Button>
        )}
        {['running', 'scheduled', 'paused'].includes(campaign.status) && (
          <Button variant="danger" icon={XCircle} loading={busy} onClick={() => act(() => cancelCampaign({ data: { workspaceId, campaignId } }))}>
            Cancelar
          </Button>
        )}
      </PageHeader>

      {confirmingDispatch && ['draft', 'scheduled'].includes(campaign.status) && (
        <Card className="mb-4 border-brand-200 bg-brand-50/40 p-4">
          <label className="flex cursor-pointer select-none items-start gap-2 text-sm text-dark-800">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-4 accent-brand-500"
            />
            Tenho o consentimento para enviar mensagens ao público selecionado
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              icon={Zap}
              loading={busy}
              disabled={!consent}
              onClick={() =>
                act(async () => {
                  const result = await dispatchCampaign({ data: { workspaceId, campaignId, consent: true } })
                  setConfirmingDispatch(false)
                  return result
                })
              }
            >
              Confirmar disparo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDispatch(false)}>
              Voltar
            </Button>
          </div>
        </Card>
      )}

      {feedback && (
        <p className="mb-4 rounded-md border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">{feedback}</p>
      )}
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {/* Configuração atual */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-neutral-500">
            <CalendarClock size={15} aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide">Agendamento</p>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-dark-800">
            {describeSchedule(campaign.scheduleJson, campaign.timezone)}
          </p>
          {campaign.nextRunAt && ['scheduled', 'running'].includes(campaign.status) && (
            <p className="mt-1 text-xs text-neutral-500">
              Próxima execução:{' '}
              {new Date(campaign.nextRunAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-neutral-500">
            <Gauge size={15} aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide">Velocidade</p>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-dark-800">{describeSpeed(campaign.speedJson)}</p>
          {campaign.applyTagOnDispatch && (
            <p className="mt-1 text-xs text-neutral-500">Tag aplicada ao público: {campaign.applyTagOnDispatch}</p>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-neutral-500">
            <Plug size={15} aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide">Conexões</p>
          </div>
          <ul className="mt-1.5 space-y-1">
            {connections.length === 0 && <li className="text-sm text-neutral-400">Nenhuma conexão vinculada.</li>}
            {connections.map((conn) => (
              <li key={conn.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-dark-800">
                  {conn.channel === 'telegram' ? (
                    <Send size={13} className="shrink-0 text-sky-500" aria-hidden="true" />
                  ) : (
                    <MessageCircle size={13} className="shrink-0 text-emerald-500" aria-hidden="true" />
                  )}
                  <span className="truncate">{conn.name}</span>
                </span>
                <StatusBadge status={conn.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat icon={Users} label="Total" value={campaign.totalContacts} />
        <Stat icon={Send} label="Enviados" value={campaign.sentCount} />
        <Stat icon={CheckCheck} label="Entregues" value={campaign.deliveredCount} />
        <Stat icon={Eye} label="Lidos" value={campaign.readCount} />
        <Stat icon={XCircle} label="Falhas" value={campaign.failedCount} />
      </div>

      {runs.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Execuções</h2>
          <Card className="mb-8 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Agendada para</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Enviadas</th>
                  <th className="px-4 py-2.5 font-medium">Falhas</th>
                  <th className="px-4 py-2.5 font-medium">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run: any) => (
                  <tr key={run.id} className="border-t border-neutral-100 transition-colors hover:bg-neutral-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{run.runNumber}</td>
                    <td className="px-4 py-2.5 text-xs text-neutral-600">
                      {run.scheduledFor
                        ? new Date(run.scheduledFor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={run.status} /></td>
                    <td className="px-4 py-2.5 text-xs text-dark-800">{run.sentCount ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs text-dark-800">{run.failedCount ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs text-neutral-500">
                      {run.skipReason ?? (run.quotaTruncated ? 'Cota mensal atingida no meio do envio' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Log de mensagens{' '}
          {campaign.status === 'running' && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal normal-case text-neutral-400">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> atualizando…
            </span>
          )}
        </h2>
        {runs.length > 1 && (
          <select
            value={runFilter}
            onChange={(e) => setRunFilter(e.target.value)}
            className="h-8 w-auto text-xs"
            aria-label="Filtrar mensagens por execução"
          >
            <option value="">Todas as execuções</option>
            {runs.map((run: any) => (
              <option key={run.id} value={run.id}>
                Execução #{run.runNumber}
              </option>
            ))}
          </select>
        )}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Contato</th>
              <th className="px-4 py-2.5 font-medium">Identificador</th>
              <th className="px-4 py-2.5 font-medium">Canal</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Detalhe / Motivo</th>
            </tr>
          </thead>
          <tbody>
            {shownMessages.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-neutral-500">
                  {['draft', 'scheduled'].includes(campaign.status)
                    ? 'Dispare a campanha para ver os logs de envio aqui.'
                    : 'Nenhuma mensagem processada ainda.'}
                </td>
              </tr>
            )}
            {shownMessages.map((m) => (
              <tr key={m.message.id} className="border-t border-neutral-100 transition-colors hover:bg-neutral-50">
                <td className="px-4 py-2.5 font-medium text-dark-800">{m.contactName ?? '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">
                  {m.contactPhone ? `+${m.contactPhone}` : m.contactTelegram ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-xs uppercase text-neutral-400">{m.message.channel ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={m.message.status} />
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {m.message.failureReason ? (
                    <span className="font-medium text-error-500">{m.message.failureReason}</span>
                  ) : m.message.sentAt ? (
                    <span className="text-neutral-400">
                      {new Date(m.message.sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
