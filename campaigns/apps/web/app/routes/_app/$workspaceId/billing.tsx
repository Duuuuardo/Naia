import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Crown,
  ExternalLink,
  HardDrive,
  Link2,
  MessageSquareText,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Undo2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { fetchPlans, fetchManageBillingUrl } from '../../../lib/actions'
import { requireEnv } from '../../../lib/env'
import { createHeadConfig } from '~/lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/billing')({ head: () => createHeadConfig('Cobrança — Naia Campanhas'),
  loader: () => fetchPlans(),
  component: BillingPage,
})

const VIANOVA_API_URL = () => requireEnv('VITE_VIANOVA_API_URL')

const tierLabels: Record<string, string> = {
  free: 'Grátis',
  starter: 'Starter',
  pro: 'Pro',
  scale: 'Scale',
}

type SubscriptionState = {
  id: string
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  hasStripeSubscription: boolean
  isOwner: boolean
  plan: { id: string; tier: string; name: string; priceCents: number } | null
  addons: {
    addonTypeId: string
    quantity: number
    key: string
    name: string
    unitLabel: string | null
    priceCents: number
    limitsPerUnit: Record<string, number>
  }[]
}

function formatPrice(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log10(bytes) / Math.log10(1024))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatLimitItem(key: string, value: number) {
  if (key === 'creditsPerCycle') {
    const formatted = value >= 1000 ? `${(value / 1000).toLocaleString('pt-BR')}k` : value
    return {
      icon: <Zap size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Créditos:',
      valueText: `${formatted} créditos/ciclo`,
    }
  }
  if (key === 'campaignsPerMonth') {
    return {
      icon: <Send size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Campanhas:',
      valueText: `${value} ${value === 1 ? 'envio/mês' : 'envios/mês'}`,
    }
  }
  if (key === 'connections') {
    return {
      icon: <Link2 size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Conexões:',
      valueText: `${value} ${value === 1 ? 'canal conectado' : 'canais conectados'}`,
    }
  }
  if (key === 'seats') {
    return {
      icon: <Users size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Equipe:',
      valueText: `${value} ${value === 1 ? 'membro no workspace' : 'membros no workspace'}`,
    }
  }
  if (key === 'automations') {
    const valueText = value < 0 ? 'Automações ilimitadas' : `${value} ${value === 1 ? 'automação ativa' : 'automações ativas'}`
    return {
      icon: <Workflow size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Automações:',
      valueText,
    }
  }
  if (key === 'storageBytes') {
    return {
      icon: <HardDrive size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Storage:',
      valueText: `${formatBytes(value)} de arquivos`,
    }
  }
  if (key === 'maxFileSizeBytes') {
    return {
      icon: <HardDrive size={15} className="text-brand-500 shrink-0 mt-0.5" />,
      label: 'Tamanho máx.:',
      valueText: `até ${formatBytes(value)} por arquivo`,
    }
  }
  return {
    icon: <CheckCircle2 size={15} className="text-brand-500 shrink-0 mt-0.5" />,
    label: `${key}:`,
    valueText: String(value),
  }
}

const LIMIT_ORDER = ['creditsPerCycle', 'campaignsPerMonth', 'automations', 'connections', 'seats', 'storageBytes', 'maxFileSizeBytes']

// Todas as chamadas de billing passam pelo proxy do Naia API com credentials
// (o cookie naia_session é enviado automaticamente).
async function vianovaBilling(path: string, init?: RequestInit) {
  const naiaApiUrl = import.meta.env.VITE_NAIA_API_URL

  const res = await fetch(`${naiaApiUrl}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, data }
}

function BillingPage() {
  const plans = Route.useLoaderData()
  const { workspace, entitlements, role } = useLoaderData({ from: '/_app/$workspaceId' })
  const { workspaceId } = Route.useParams()
  const router = useRouter()

  const [subscription, setSubscription] = useState<SubscriptionState | null>(null)
  const [subLoaded, setSubLoaded] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [activationTimedOut, setActivationTimedOut] = useState(false)

  const isOwner = role === 'owner'
  const checkoutSuccess =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('success') === 'true'

  const loadSubscription = useCallback(async () => {
    const { ok, data } = await vianovaBilling(
      `/billing/subscription?product_slug=naia&workspace_id=${workspaceId}`,
    )
    const next = ok ? ((data.subscription as SubscriptionState | null) ?? null) : null
    if (ok) setSubscription(next)
    setSubLoaded(true)
    return next
  }, [workspaceId])

  useEffect(() => {
    loadSubscription()
  }, [loadSubscription])

  // Voltando do Stripe: aguarda a confirmação real do backend. A URL de
  // sucesso sozinha não prova que webhook e entitlement foram processados.
  useEffect(() => {
    if (!checkoutSuccess) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async (attempt: number) => {
      const next = await loadSubscription()
      await router.invalidate()
      if (cancelled) return
      const active = Boolean(next?.hasStripeSubscription && ['active', 'trialing', 'past_due'].includes(next.status))
      if (active) {
        setActivationTimedOut(false)
        return
      }
      if (attempt >= 15) {
        setActivationTimedOut(true)
        return
      }
      timer = setTimeout(() => void poll(attempt + 1), 2000)
    }

    setActivationTimedOut(false)
    void poll(1)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [checkoutSuccess, loadSubscription, router])

  const paidActive = Boolean(
    subscription?.hasStripeSubscription &&
      ['active', 'trialing', 'past_due'].includes(subscription.status),
  )

  const currentPlanTier = subscription?.plan?.tier ?? entitlements.tier
  const currentPlan = plans?.plans?.find((p) => p.tier === currentPlanTier) ?? null

  // Scale é posicionado como tier enterprise separado — não entra no grid de 3.
  const regularPlans = plans?.plans?.filter((p) => p.tier !== 'scale') ?? []
  const scalePlan = plans?.plans?.find((p) => p.tier === 'scale') ?? null

  // Plano pago sem subscription no Stripe: ativação antiga direto no banco.
  // A cobrança precisa ser regularizada pelo checkout pra habilitar
  // renovação, cancelamento e add-ons.
  const legacyPaidPlan =
    subLoaded &&
    !paidActive &&
    entitlements.status === 'active' &&
    entitlements.tier !== 'free' &&
    (currentPlan?.priceCents ?? 0) > 0

  async function refresh() {
    await Promise.all([loadSubscription(), router.invalidate()])
  }

  async function handleSubscribe(plan: { id: string; tier: string; priceCents: number }) {
    setBusyAction(plan.id)
    setError(null)
    setNotice(null)
    setConfirming(null)

    try {
      const { ok, data } = await vianovaBilling('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          product_slug: 'naia',
          workspace_id: workspaceId,
          workspace_name: workspace.name,
          plan_id: plan.id,
          success_url: `${window.location.origin}/${workspaceId}/billing?success=true`,
          cancel_url: `${window.location.origin}/${workspaceId}/billing`,
        }),
      })

      if (!ok) {
        setError((data.message as string) ?? 'Erro ao iniciar a mudança de plano.')
        return
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl as string
        return
      }
      if (data.changed) {
        const isUpgrade = (currentPlan?.priceCents ?? 0) < plan.priceCents
        setNotice(
          isUpgrade
            ? `Plano alterado para ${tierLabels[plan.tier] ?? plan.tier}. O ciclo de faturamento foi reiniciado e o valor do novo plano cobrado agora.`
            : `Plano alterado para ${tierLabels[plan.tier] ?? plan.tier}. A diferença será ajustada na próxima fatura.`,
        )
      } else if (data.scheduled) {
        setNotice(
          `Downgrade agendado. Seu plano atual continua ativo até ${formatDate(data.effectiveAt as string)}.`,
        )
      } else if (data.activated) {
        setNotice(`Agora você está no plano ${tierLabels[plan.tier] ?? plan.tier}.`)
      }
      await refresh()
    } catch {
      setError('Falha de conexão com o portal de faturas.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCancel() {
    if (!subscription) return
    setBusyAction('cancel')
    setError(null)
    setNotice(null)
    setConfirming(null)
    const { ok, data } = await vianovaBilling(`/billing/subscriptions/${subscription.id}/cancel`, {
      method: 'POST',
    })
    setBusyAction(null)
    if (!ok) {
      setError((data.message as string) ?? 'Erro ao cancelar.')
      return
    }
    setNotice(`Cancelamento agendado. O plano continua ativo até ${formatDate(data.effectiveAt as string)}.`)
    await refresh()
  }

  async function handleResume() {
    if (!subscription) return
    setBusyAction('resume')
    setError(null)
    setNotice(null)
    const { ok, data } = await vianovaBilling(`/billing/subscriptions/${subscription.id}/resume`, {
      method: 'POST',
    })
    setBusyAction(null)
    if (!ok) {
      setError((data.message as string) ?? 'Erro ao retomar a assinatura.')
      return
    }
    setNotice('Assinatura retomada. A renovação automática está ativa de novo.')
    await refresh()
  }

  async function handleAddonQuantity(addonTypeId: string, quantity: number) {
    if (!subscription) return
    setBusyAction(`addon:${addonTypeId}`)
    setError(null)
    setNotice(null)

    const existing = subscription.addons.find((a) => a.addonTypeId === addonTypeId)
    const { ok, data } = existing
      ? await vianovaBilling(`/billing/subscriptions/${subscription.id}/addons/${addonTypeId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        })
      : await vianovaBilling(`/billing/subscriptions/${subscription.id}/addons`, {
          method: 'POST',
          body: JSON.stringify({ addon_type_id: addonTypeId, quantity }),
        })

    setBusyAction(null)
    if (!ok) {
      setError((data.message as string) ?? 'Erro ao atualizar o add-on.')
      return
    }
    const charged = (data.chargedNowCents as number | undefined) ?? 0
    setNotice(
      quantity === 0
        ? 'Add-on removido. Sai da próxima renovação, o que já foi pago vale até o fim do ciclo.'
        : charged > 0
          ? `Add-on ativado. ${formatPrice(charged)} cobrado agora. A partir da próxima renovação, entra junto na fatura da assinatura.`
          : 'Quantidade reduzida. A renovação já sai ajustada, o que já foi pago vale até o fim do ciclo.',
    )
    await refresh()
  }

  async function handleManage() {
    const url = await fetchManageBillingUrl()
    if (url) window.location.href = url
  }

  const currentTierName = tierLabels[entitlements.tier] ?? entitlements.tier.toUpperCase()

  return (
    <div className="max-w-5xl mx-auto py-2 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-dark-800">Assinatura</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Gerencie o plano, os add-ons e os limites do seu workspace.
          </p>
        </div>
        {isOwner && (
          <button
            onClick={handleManage}
            className="h-10 px-4 rounded-md border border-neutral-300 bg-white text-sm font-semibold text-dark-800 shadow-2xs hover:bg-neutral-50 transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto"
          >
            <span>Portal de faturas</span>
            <ExternalLink size={14} className="text-neutral-400" />
          </button>
        )}
      </div>

      {checkoutSuccess && !paidActive && subLoaded && !activationTimedOut && (
        <div className="mt-6 rounded-xl bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-600 font-medium flex items-center gap-2.5">
          <span className="size-4 motion-safe:animate-spin rounded-full border-2 border-brand-200 border-t-brand-500 shrink-0" />
          <span>Confirmando o pagamento e ativando seu plano…</span>
        </div>
      )}

      {checkoutSuccess && !paidActive && subLoaded && activationTimedOut && (
        <div className="mt-6 rounded-xl bg-warning-50 border border-warning-200 px-4 py-3 text-sm text-dark-800 flex flex-col sm:flex-row sm:items-center gap-3">
          <CircleAlert size={18} className="text-warning-500 shrink-0" />
          <span className="flex-1">A confirmação está demorando mais que o esperado. Seu pagamento não será cobrado novamente.</span>
          <button
            type="button"
            onClick={() => {
              setActivationTimedOut(false)
              void refresh().finally(() => setActivationTimedOut(true))
            }}
            className="h-9 px-3 rounded-md border border-neutral-300 bg-white text-sm font-semibold text-dark-800 hover:bg-neutral-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center justify-center gap-2 shrink-0"
          >
            <RefreshCw size={15} />
            Verificar novamente
          </button>
        </div>
      )}

      <div className="my-6 bg-white rounded-xl border border-neutral-200 p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shrink-0">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Plano atual:</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-dark-800 text-white">
                  {currentTierName}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd
                  ? `Cancelamento agendado. Ativo até ${formatDate(subscription.currentPeriodEnd)}, depois volta ao Grátis.`
                  : paidActive && subscription?.currentPeriodEnd
                    ? `Renova automaticamente em ${formatDate(subscription.currentPeriodEnd)}.`
                    : entitlements.status === 'active'
                      ? 'Assinatura ativa e sem pendências.'
                      : 'Assinatura com restrições ou pendente.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 border-t md:border-t-0 md:border-l border-neutral-200 pt-3 md:pt-0 md:pl-6 text-xs text-dark-800">
            <div>
              <span className="text-neutral-400 block text-[11px]">Campanhas/mês</span>
              <strong className="font-bold">{entitlements.campaignsPerMonth}</strong>
            </div>
            <div>
              <span className="text-neutral-400 block text-[11px]">Conexões</span>
              <strong className="font-bold">{entitlements.connections} canais</strong>
            </div>
            <div>
              <span className="text-neutral-400 block text-[11px]">Equipe</span>
              <strong className="font-bold">{entitlements.seats} membros</strong>
            </div>
          </div>
        </div>

        {isOwner && subscription?.cancelAtPeriodEnd && (
          <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-neutral-500 flex items-center gap-1.5">
              <CalendarClock size={13} className="text-amber-500 shrink-0" />
              Mudou de ideia? Retome antes do fim do período e nada muda.
            </p>
            <button
              onClick={handleResume}
              disabled={busyAction === 'resume'}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-dark-800 text-xs font-bold text-white hover:bg-dark-700 transition-colors disabled:opacity-60"
            >
              <Undo2 size={13} />
              {busyAction === 'resume' ? 'Retomando…' : 'Retomar assinatura'}
            </button>
          </div>
        )}

        {isOwner && paidActive && !subscription?.cancelAtPeriodEnd && (
          <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center justify-end">
            {confirming === 'cancel' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-neutral-500">
                  O plano continua até o fim do período pago. Confirmar?
                </span>
                <button
                  onClick={handleCancel}
                  disabled={busyAction === 'cancel'}
                  className="h-8 px-3 rounded-md bg-[#ef4444] text-xs font-bold text-white hover:bg-[#dc2626] transition-colors disabled:opacity-60"
                >
                  {busyAction === 'cancel' ? 'Cancelando…' : 'Cancelar plano'}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  className="h-8 px-3 rounded-md text-xs font-semibold text-neutral-500 hover:bg-neutral-100 transition-colors"
                >
                  Voltar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming('cancel')}
                className="text-xs font-medium text-neutral-400 hover:text-[#ef4444] transition-colors"
              >
                Cancelar assinatura
              </button>
            )}
          </div>
        )}
      </div>

      {!isOwner && (
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3 text-sm text-neutral-600 font-medium flex items-center gap-2.5 mb-6">
          <ShieldAlert size={15} className="text-neutral-400 shrink-0" />
          <span>Somente o dono do workspace pode assinar, alterar ou cancelar o plano.</span>
        </div>
      )}

      {legacyPaidPlan && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 font-medium flex items-center gap-2.5 mb-6">
          <ShieldAlert size={15} className="text-amber-600 shrink-0" />
          <span>
            Seu plano <strong className="font-bold capitalize">{currentTierName}</strong> está ativo
            sem cobrança configurada. Assine pelo botão abaixo para habilitar renovação automática e
            add-ons. Os limites atuais não mudam.
          </span>
        </div>
      )}

      {notice && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-success-600 font-medium flex items-center gap-2.5 mb-6 shadow-2xs">
          <CheckCircle2 size={16} className="text-success-500 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-error-600 font-medium mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch mt-6">
        {regularPlans.map((plan) => {
          const isCurrent =
            entitlements.status === 'active' &&
            entitlements.tier === plan.tier &&
            !subscription?.cancelAtPeriodEnd &&
            // Plano pago só conta como "atual" com cobrança real ativa —
            // senão o botão vira "Assinar" pra regularizar via checkout.
            (plan.priceCents === 0 || paidActive)
          const isPopular = plan.tier === 'pro'
          const planTitle = tierLabels[plan.tier] ?? plan.name
          const currentSort = currentPlan?.sortOrder ?? 0
          const isDowngrade = paidActive && plan.sortOrder < currentSort && plan.priceCents > 0
          const isUpgrade = paidActive && plan.sortOrder > currentSort

          const sortedLimits = Object.entries(plan.limits)
            .filter(([key]) => key !== 'creditsBalance')
            .sort(([keyA], [keyB]) => {
              const indexA = LIMIT_ORDER.indexOf(keyA)
              const indexB = LIMIT_ORDER.indexOf(keyB)
              return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB)
            })

          const needsConfirm = isDowngrade || (paidActive && plan.priceCents === 0)
          const buttonLabel = isCurrent
            ? 'Plano atual'
            : plan.priceCents === 0
              ? paidActive
                ? 'Voltar para o Grátis'
                : 'Mudar para Grátis'
              : isUpgrade
                ? 'Fazer upgrade'
                : isDowngrade
                  ? 'Fazer downgrade'
                  : `Assinar ${planTitle}`

          return (
            <div
              key={plan.id}
              className={`relative rounded-xl p-6 flex flex-col justify-between transition-[transform,border-color,box-shadow] duration-200 ease-out ${
                isCurrent
                  ? 'border-2 border-dark-800 bg-neutral-50/50 shadow-sm'
                  : isPopular
                    ? 'border-2 border-brand-500 bg-white shadow-md'
                    : 'border border-neutral-200 bg-white hover:border-brand-300 hover:shadow-sm shadow-2xs'
              }`}
              style={{ animation: 'fadeInUp 400ms ease-out backwards', animationDelay: `${plan.sortOrder * 60}ms` }}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-dark-800 flex items-center gap-1.5">
                    {plan.tier === 'pro' && <Crown size={16} className="text-amber-500 shrink-0" />}
                    <span>{planTitle}</span>
                  </h3>

                  {isCurrent ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-dark-800 text-white">
                      Atual
                    </span>
                  ) : isPopular ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-50 text-brand-600 border border-brand-200">
                      <Sparkles size={11} />
                      Popular
                    </span>
                  ) : null}
                </div>

                <p className="text-xs text-neutral-500 mt-1 min-h-[32px] leading-relaxed">
                  {plan.description}
                </p>

                <div className="my-5 pb-5 border-b border-neutral-100 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-dark-800 tracking-tight">
                    {plan.priceCents === 0 ? 'Grátis' : formatPrice(plan.priceCents)}
                  </span>
                  {plan.priceCents > 0 && <span className="text-xs font-semibold text-neutral-400">/mês</span>}
                </div>

                <div className="space-y-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 block">
                    Recursos incluídos:
                  </span>
                  <ul className="space-y-2.5 text-xs text-neutral-600">
                    {sortedLimits.map(([key, value]) => {
                      const item = formatLimitItem(key, value)
                      return (
                        <li key={key} className="flex items-start gap-2">
                          {item.icon}
                          <span className="leading-snug">
                            {item.label} <strong className="font-semibold text-dark-800">{item.valueText}</strong>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-neutral-100">
                {confirming === plan.id ? (
                  <div className="space-y-2">
                    <p className="text-xs text-neutral-500 leading-snug">
                      {plan.priceCents === 0
                        ? 'Seu plano pago segue até o fim do período. Depois o workspace volta ao Grátis.'
                        : 'Os limites mudam agora e o valor é ajustado proporcionalmente na próxima fatura.'}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSubscribe(plan)}
                        disabled={busyAction === plan.id}
                        className="flex-1 h-9 rounded-md bg-dark-800 text-xs font-bold text-white hover:bg-dark-700 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out disabled:opacity-60"
                      >
                        {busyAction === plan.id ? 'Aplicando…' : 'Confirmar'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="h-9 px-3 rounded-md text-xs font-semibold text-neutral-500 hover:bg-neutral-100 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => (needsConfirm ? setConfirming(plan.id) : handleSubscribe(plan))}
                    disabled={busyAction === plan.id || isCurrent || !isOwner}
                    className={`w-full h-10 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.97] ${
                      isCurrent
                        ? 'bg-neutral-100 text-neutral-400 cursor-default border border-neutral-200'
                        : plan.priceCents === 0 || isDowngrade
                          ? 'border border-neutral-300 bg-white text-dark-800 hover:bg-neutral-50 disabled:opacity-50'
                          : 'bg-brand-500 text-white hover:bg-brand-600 shadow-xs disabled:opacity-50'
                    }`}
                  >
                    {busyAction === plan.id ? (
                      <>
                        <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        <span>Processando…</span>
                      </>
                    ) : (
                      <>
                        <span>{buttonLabel}</span>
                        {!isCurrent && plan.priceCents > 0 && !isDowngrade && <ArrowRight size={15} />}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {scalePlan && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Alto volume</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>
          <div
            className={`relative rounded-xl p-6 md:p-8 border transition-[transform,border-color,box-shadow] duration-200 ease-out ${
              entitlements.tier === 'scale' && entitlements.status === 'active' && !subscription?.cancelAtPeriodEnd
                ? 'border-2 border-dark-800 bg-neutral-50/50'
                : 'border border-neutral-200 bg-white hover:border-brand-300 hover:shadow-sm shadow-2xs'
            }`}
            style={{ animation: 'fadeInUp 400ms ease-out backwards', animationDelay: '180ms' }}
          >
            <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-10">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xl font-bold text-dark-800">{tierLabels[scalePlan.tier] ?? scalePlan.name}</h3>
                  {entitlements.tier === 'scale' && entitlements.status === 'active' && !subscription?.cancelAtPeriodEnd && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-dark-800 text-white">
                      Atual
                    </span>
                  )}
                </div>
                <p className="text-sm text-neutral-500 leading-relaxed max-w-xl">
                  {scalePlan.description} Fila de envio dedicada por workspace, maior throughput e limites para operações que enviam dezenas de milhares de mensagens por mês.
                </p>
                <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-neutral-600">
                  {Object.entries(scalePlan.limits)
                    .sort(([keyA], [keyB]) => {
                      const indexA = LIMIT_ORDER.indexOf(keyA)
                      const indexB = LIMIT_ORDER.indexOf(keyB)
                      return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB)
                    })
                    .map(([key, value]) => {
                      const item = formatLimitItem(key, value)
                      return (
                        <li key={key} className="flex items-start gap-2">
                          {item.icon}
                          <span className="leading-snug">
                            {item.label} <strong className="font-semibold text-dark-800">{item.valueText}</strong>
                          </span>
                        </li>
                      )
                    })}
                </ul>
              </div>

              <div className="md:w-64 shrink-0 flex flex-col justify-between gap-5 md:border-l md:border-neutral-100 md:pl-10">
                <div>
                  <span className="text-3xl font-extrabold text-dark-800 tracking-tight">
                    {formatPrice(scalePlan.priceCents)}
                  </span>
                  <span className="text-xs font-semibold text-neutral-400">/mês</span>
                </div>

                {(() => {
                  const isCurrentScale =
                    entitlements.status === 'active' &&
                    entitlements.tier === 'scale' &&
                    !subscription?.cancelAtPeriodEnd &&
                    paidActive
                  const currentSortScale = currentPlan?.sortOrder ?? 0
                  const isUpgradeScale = paidActive && scalePlan.sortOrder > currentSortScale
                  const isDowngradeScale = paidActive && scalePlan.sortOrder < currentSortScale && scalePlan.priceCents > 0
                  const needsConfirmScale = isDowngradeScale || (paidActive && scalePlan.priceCents === 0)

                  return confirming === scalePlan.id ? (
                    <div className="space-y-2">
                      <p className="text-xs text-neutral-500 leading-snug">
                        Os limites mudam agora e o valor é ajustado proporcionalmente na próxima fatura.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSubscribe(scalePlan)}
                          disabled={busyAction === scalePlan.id}
                          className="flex-1 h-9 rounded-md bg-dark-800 text-xs font-bold text-white hover:bg-dark-700 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out disabled:opacity-60"
                        >
                          {busyAction === scalePlan.id ? 'Aplicando…' : 'Confirmar'}
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="h-9 px-3 rounded-md text-xs font-semibold text-neutral-500 hover:bg-neutral-100 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out"
                        >
                          Voltar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => (needsConfirmScale ? setConfirming(scalePlan.id) : handleSubscribe(scalePlan))}
                      disabled={busyAction === scalePlan.id || isCurrentScale || !isOwner}
                      className={`w-full h-10 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.97] ${
                        isCurrentScale
                          ? 'bg-neutral-100 text-neutral-400 cursor-default border border-neutral-200'
                          : 'bg-brand-500 text-white hover:bg-brand-600 shadow-xs disabled:opacity-50'
                      }`}
                    >
                      {busyAction === scalePlan.id ? (
                        <>
                          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          <span>Processando…</span>
                        </>
                      ) : isCurrentScale ? (
                        'Plano atual'
                      ) : isUpgradeScale ? (
                        <>
                          <span>Fazer upgrade</span>
                          <ArrowRight size={15} />
                        </>
                      ) : (
                        <>
                          <span>Assinar Scale</span>
                          <ArrowRight size={15} />
                        </>
                      )}
                    </button>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {plans?.addons && plans.addons.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-2.5 pb-4 border-b border-neutral-200">
            <PackagePlus size={18} className="text-brand-500 shrink-0" />
            <div>
              <h2 className="text-lg font-bold text-dark-800">Add-ons</h2>
              <p className="text-xs text-neutral-500">
                Amplie os limites do seu plano sem trocar de tier. Cobrados mensalmente junto com a assinatura.
              </p>
            </div>
          </div>

          {(currentPlan?.priceCents ?? 0) === 0 ? (
            <div className="mt-4 rounded-xl bg-neutral-50 border border-dashed border-neutral-300 px-5 py-6 text-center">
              <p className="text-sm font-medium text-neutral-600">
                Add-ons ficam disponíveis a partir do plano Starter.
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                Faça upgrade para expandir campanhas, créditos, conexões e assentos sob demanda.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
              {plans.addons.map((addon) => {
                const active = subscription?.addons.find((a) => a.addonTypeId === addon.id)
                return (
                  <AddonCard
                    key={addon.id}
                    addon={addon}
                    currentQuantity={active?.quantity ?? 0}
                    busy={busyAction === `addon:${addon.id}`}
                    disabled={!isOwner}
                    onApply={(quantity) => handleAddonQuantity(addon.id, quantity)}
                  />
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function AddonCard({
  addon,
  currentQuantity,
  busy,
  disabled,
  onApply,
}: {
  addon: {
    id: string
    key: string
    name: string
    description: string | null
    unitLabel: string | null
    priceCents: number
    limitsPerUnit: Record<string, number>
  }
  currentQuantity: number
  busy: boolean
  disabled: boolean
  onApply: (quantity: number) => void
}) {
  const [quantity, setQuantity] = useState(currentQuantity)

  useEffect(() => {
    setQuantity(currentQuantity)
  }, [currentQuantity])

  const dirty = quantity !== currentQuantity
  const Icon =
    addon.key === 'extra_seats' ? Users :
    addon.key === 'extra_credits' ? Zap :
    addon.key === 'extra_connections' ? Link2 :
    addon.key === 'extra_automations' ? Workflow :
    addon.key === 'extra_storage' ? HardDrive :
    Send

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 border border-brand-100 text-brand-600">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-dark-800">{addon.name}</h3>
            {currentQuantity > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-brand-50 text-brand-600 border border-brand-200 shrink-0">
                {currentQuantity} ativo{currentQuantity > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{addon.description}</p>
          <p className="text-xs font-semibold text-dark-800 mt-1.5">
            {formatPrice(addon.priceCents)}
            <span className="text-neutral-400 font-normal"> /mês por {addon.unitLabel ?? 'unidade'}</span>
          </p>
          <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
            Cobrado integral na compra e renovado junto com a assinatura.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-neutral-100">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(0, q - 1))}
            disabled={disabled || quantity === 0}
            aria-label="Diminuir quantidade"
            className="grid size-8 place-items-center rounded-md border border-neutral-300 text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-40"
          >
            <Minus size={14} />
          </button>
          <span className="w-10 text-center text-sm font-bold text-dark-800 tabular-nums">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
            disabled={disabled}
            aria-label="Aumentar quantidade"
            className="grid size-8 place-items-center rounded-md border border-neutral-300 text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onApply(quantity)}
          disabled={disabled || busy || !dirty}
          className="h-9 px-4 rounded-md bg-dark-800 text-xs font-bold text-white hover:bg-dark-700 transition-colors disabled:opacity-40"
        >
          {busy
            ? 'Aplicando…'
            : quantity === 0 && currentQuantity > 0
              ? 'Remover'
              : currentQuantity > 0
                ? 'Atualizar'
                : 'Adicionar'}
        </button>
      </div>
    </div>
  )
}
