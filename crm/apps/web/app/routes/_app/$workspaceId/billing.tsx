import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Crown,
  Link2,
  MessageSquareText,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserRoundCog,
  Users,
} from 'lucide-react'
import {
  BillingCurrentPlanCard,
  BillingManageLink,
  BillingPlanCardSurface,
  BillingPlansGrid,
  BillingPageHeader,
} from '../../../components/ui'
import {
  fetchBillingSubscription,
  fetchManageBillingUrl,
  fetchPlans,
  startBillingCheckout,
  updateBillingAddon,
  type BillingCatalog,
  type BillingSubscription,
} from '../../../lib/actions'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/billing')({
  head: () => createHeadConfig('Assinatura — Naia CRM'),
  loader: () => fetchPlans(),
  component: BillingPage,
})

type CatalogPlan = BillingCatalog['plans'][number]
type CatalogAddon = BillingCatalog['addons'][number]

const tierLabels: Record<string, string> = {
  free: 'Grátis',
  starter: 'Starter',
  pro: 'Pro',
  scale: 'Scale',
}

const limitOrder = ['agents', 'connections', 'activeConversations']

function formatPrice(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatLimit(value: number): string {
  return value < 0 ? 'Ilimitado' : value.toLocaleString('pt-BR')
}

function formatCount(value: number, singular: string, plural: string): string {
  if (value < 0) return `${plural} ilimitados`
  return `${value.toLocaleString('pt-BR')} ${value === 1 ? singular : plural}`
}

function formatLimitItem(key: string, value: number) {
  if (key === 'agents') {
    return {
      icon: Users,
      label: 'Equipe:',
      valueText: formatCount(value, 'agente', 'agentes'),
    }
  }
  if (key === 'connections') {
    return {
      icon: Link2,
      label: 'Conexões:',
      valueText: formatCount(value, 'canal conectado', 'canais conectados'),
    }
  }
  if (key === 'activeConversations') {
    return {
      icon: MessageSquareText,
      label: 'Conversas:',
      valueText:
        value < 0
          ? 'conversas ativas ilimitadas'
          : `${value.toLocaleString('pt-BR')} conversas ativas`,
    }
  }
  return {
    icon: CheckCircle2,
    label: `${key}:`,
    valueText: value < 0 ? 'Ilimitado' : value.toLocaleString('pt-BR'),
  }
}

function BillingPage() {
  const plans = Route.useLoaderData()
  const { workspace, entitlements, role } = useLoaderData({ from: '/_app/$workspaceId' })
  const { workspaceId } = Route.useParams()
  const router = useRouter()

  const [subscription, setSubscription] = useState<BillingSubscription | null>(null)
  const [subLoaded, setSubLoaded] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [activationTimedOut, setActivationTimedOut] = useState(false)

  const isOwner = role === 'owner'
  const checkoutSuccess =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('success') === 'true'

  const loadSubscription = useCallback(async () => {
    const result = await fetchBillingSubscription({ data: workspaceId })
    const next = !('error' in result) ? result.subscription : null
    if (!('error' in result)) setSubscription(next)
    setSubLoaded(true)
    return next
  }, [workspaceId])

  useEffect(() => {
    void loadSubscription()
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

      const active = Boolean(
        next?.hasStripeSubscription &&
          ['active', 'trialing', 'past_due'].includes(next.status),
      )
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
  const currentPlanTier = subscription?.plan?.tier ?? entitlements.plan
  const currentPlan = plans?.plans.find((plan) => plan.tier === currentPlanTier) ?? null

  // Scale é posicionado como tier enterprise separado — não entra no grid de 3.
  const regularPlans = plans?.plans.filter((plan) => plan.tier !== 'scale') ?? []
  const scalePlan = plans?.plans.find((plan) => plan.tier === 'scale') ?? null

  // Plano pago sem subscription no Stripe: ativação antiga direto no banco.
  // A cobrança precisa ser regularizada pelo checkout pra habilitar
  // renovação, cancelamento e add-ons.
  const legacyPaidPlan =
    subLoaded &&
    !paidActive &&
    entitlements.status === 'active' &&
    entitlements.plan !== 'free' &&
    (currentPlan?.priceCents ?? 0) > 0

  async function refresh() {
    await Promise.all([loadSubscription(), router.invalidate()])
  }

  async function handleSubscribe(plan: CatalogPlan) {
    setBusyAction(plan.id)
    setError(null)
    setNotice(null)
    setConfirming(null)

    try {
      const result = await startBillingCheckout({
        data: {
          workspaceId,
          workspaceName: workspace.name,
          planId: plan.id,
          successUrl: `${window.location.origin}/${workspaceId}/billing?success=true`,
          cancelUrl: `${window.location.origin}/${workspaceId}/billing`,
        },
      })

      if ('error' in result) {
        setError(result.error)
        return
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
        return
      }
      if (result.changed) {
        const isUpgrade = (currentPlan?.priceCents ?? 0) < plan.priceCents
        setNotice(
          isUpgrade
            ? `Plano alterado para ${tierLabels[plan.tier] ?? plan.name}. O ciclo de faturamento foi reiniciado e o valor do novo plano cobrado agora.`
            : `Plano alterado para ${tierLabels[plan.tier] ?? plan.name}. A diferença será ajustada na próxima fatura.`,
        )
      } else if (result.scheduled && result.effectiveAt) {
        setNotice(
          `Downgrade agendado. Seu plano atual continua ativo até ${formatDate(result.effectiveAt)}.`,
        )
      } else if (result.activated) {
        setNotice(`Agora você está no plano ${tierLabels[plan.tier] ?? plan.name}.`)
      }
      await refresh()
    } catch {
      setError('Falha de conexão com o portal de faturas.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleAddonQuantity(addonTypeId: string, quantity: number) {
    if (!subscription) return
    setBusyAction(`addon:${addonTypeId}`)
    setError(null)
    setNotice(null)

    const existing = subscription.addons.find((addon) => addon.addonTypeId === addonTypeId)
    const result = await updateBillingAddon({
      data: {
        subscriptionId: subscription.id,
        addonTypeId,
        quantity,
        exists: Boolean(existing),
      },
    })

    setBusyAction(null)
    if ('error' in result) {
      setError(result.error)
      return
    }

    const charged = result.chargedNowCents ?? 0
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

  if (!plans) {
    return (
      <div className="mx-auto max-w-5xl py-2 font-sans">
        <header className="border-b border-neutral-200 pb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-dark-800">Assinatura</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Gerencie o plano, os add-ons e os limites do seu workspace.
          </p>
        </header>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-error-600">
          Não foi possível carregar o catálogo de planos agora. Tente novamente em instantes.
        </div>
      </div>
    )
  }

  const currentTierName = tierLabels[entitlements.plan] ?? entitlements.plan.toUpperCase()

  return (
    <div className="mx-auto max-w-5xl py-2 font-sans">
      <BillingPageHeader onManage={handleManage} showManage={isOwner} />

      {checkoutSuccess && !paidActive && subLoaded && !activationTimedOut && (
        <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-600">
          <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500 motion-reduce:animate-none" />
          <span>Confirmando o pagamento e ativando seu plano…</span>
        </div>
      )}

      {checkoutSuccess && !paidActive && subLoaded && activationTimedOut && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-dark-800 sm:flex-row sm:items-center">
          <CircleAlert size={18} className="shrink-0 text-amber-500" aria-hidden="true" />
          <span className="flex-1">
            A confirmação está demorando mais que o esperado. Seu pagamento não será cobrado novamente.
          </span>
          <button
            type="button"
            onClick={() => {
              setActivationTimedOut(false)
              void refresh().finally(() => setActivationTimedOut(true))
            }}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-semibold text-dark-800 transition-[background-color,transform] duration-150 hover:bg-neutral-50 active:scale-[0.98]"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Verificar novamente
          </button>
        </div>
      )}

      <BillingCurrentPlanCard
        planName={currentTierName}
        statusText={
          subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd
            ? `Cancelamento agendado. Ativo até ${formatDate(subscription.currentPeriodEnd)}, depois volta ao Grátis.`
            : paidActive && subscription?.currentPeriodEnd
              ? `Renova automaticamente em ${formatDate(subscription.currentPeriodEnd)}.`
              : entitlements.status === 'active'
                ? 'Assinatura ativa e sem pendências.'
                : 'Assinatura com restrições ou pendente.'
        }
        metrics={[
          { label: 'Agentes', value: formatLimit(entitlements.agentsLimit) },
          { label: 'Conexões', value: formatLimit(entitlements.connectionsLimit) },
          {
            label: 'Conversas ativas',
            value: formatLimit(entitlements.activeConversationsLimit),
          },
        ]}
        manageFooter={
          isOwner && paidActive ? <BillingManageLink onClick={handleManage} /> : undefined
        }
      />

      {!isOwner && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-600">
          <ShieldAlert size={15} className="shrink-0 text-neutral-400" aria-hidden="true" />
          <span>Somente o dono do workspace pode assinar, alterar ou cancelar o plano.</span>
        </div>
      )}

      {legacyPaidPlan && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          <ShieldAlert size={15} className="shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            Seu plano <strong className="font-bold capitalize">{currentTierName}</strong> está ativo
            sem cobrança configurada. Assine pelo botão abaixo para habilitar renovação automática e
            add-ons. Os limites atuais não mudam.
          </span>
        </div>
      )}

      {notice && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-success-600 shadow-2xs">
          <CheckCircle2 size={16} className="shrink-0 text-success-500" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-error-600">
          {error}
        </div>
      )}

      <BillingPlansGrid>
        {regularPlans.map((plan) => {
          const isCurrent =
            entitlements.status === 'active' &&
            entitlements.plan === plan.tier &&
            !subscription?.cancelAtPeriodEnd &&
            // Plano pago só conta como "atual" com cobrança real ativa —
            // senão o botão vira "Assinar" pra regularizar via checkout.
            (plan.priceCents === 0 || paidActive)
          const currentSort = currentPlan?.sortOrder ?? 0
          const isDowngrade = paidActive && plan.sortOrder < currentSort && plan.priceCents > 0
          const isUpgrade = paidActive && plan.sortOrder > currentSort

          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={isCurrent}
              isPopular={plan.tier === 'pro'}
              isDowngrade={isDowngrade}
              isUpgrade={isUpgrade}
              paidActive={paidActive}
              isOwner={isOwner}
              busy={busyAction === plan.id}
              confirming={confirming === plan.id}
              onConfirm={() => setConfirming(plan.id)}
              onCancelConfirm={() => setConfirming(null)}
              onSubscribe={() => void handleSubscribe(plan)}
            />
          )
        })}
      </BillingPlansGrid>

      {scalePlan && (
        <ScalePlan
          plan={scalePlan}
          currentPlan={currentPlan}
          currentTier={entitlements.plan}
          entitlementStatus={entitlements.status}
          paidActive={paidActive}
          cancelAtPeriodEnd={Boolean(subscription?.cancelAtPeriodEnd)}
          isOwner={isOwner}
          busy={busyAction === scalePlan.id}
          confirming={confirming === scalePlan.id}
          onConfirm={() => setConfirming(scalePlan.id)}
          onCancelConfirm={() => setConfirming(null)}
          onSubscribe={() => void handleSubscribe(scalePlan)}
        />
      )}

      {plans.addons.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-2.5 border-b border-neutral-200 pb-4">
            <PackagePlus size={18} className="shrink-0 text-brand-500" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-dark-800">Add-ons</h2>
              <p className="text-xs text-neutral-500">
                Amplie os limites do seu plano sem trocar de tier. Cobrados mensalmente junto com a assinatura.
              </p>
            </div>
          </div>

          {(currentPlan?.priceCents ?? 0) === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-5 py-6 text-center">
              <p className="text-sm font-medium text-neutral-600">
                Add-ons ficam disponíveis a partir do plano Starter.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Faça upgrade para expandir agentes, conexões e conversas ativas sob demanda.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              {plans.addons.map((addon) => {
                const active = subscription?.addons.find(
                  (item) => item.addonTypeId === addon.id,
                )
                return (
                  <AddonCard
                    key={addon.id}
                    addon={addon}
                    currentQuantity={active?.quantity ?? 0}
                    busy={busyAction === `addon:${addon.id}`}
                    disabled={!isOwner || !paidActive}
                    onApply={(quantity) => void handleAddonQuantity(addon.id, quantity)}
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

function PlanCard({
  plan,
  isCurrent,
  isPopular,
  isDowngrade,
  isUpgrade,
  paidActive,
  isOwner,
  busy,
  confirming,
  onConfirm,
  onCancelConfirm,
  onSubscribe,
}: {
  plan: CatalogPlan
  isCurrent: boolean
  isPopular: boolean
  isDowngrade: boolean
  isUpgrade: boolean
  paidActive: boolean
  isOwner: boolean
  busy: boolean
  confirming: boolean
  onConfirm: () => void
  onCancelConfirm: () => void
  onSubscribe: () => void
}) {
  const planTitle = tierLabels[plan.tier] ?? plan.name
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
  const sortedLimits = Object.entries(plan.limits).sort(([keyA], [keyB]) => {
    const indexA = limitOrder.indexOf(keyA)
    const indexB = limitOrder.indexOf(keyB)
    return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB)
  })

  return (
    <BillingPlanCardSurface current={isCurrent} popular={isPopular}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-lg font-bold text-dark-800">
            {plan.tier === 'pro' && <Crown size={16} className="shrink-0 text-amber-500" />}
            {planTitle}
          </h2>
          {isCurrent ? (
            <span className="rounded-full bg-dark-800 px-2.5 py-0.5 text-[11px] font-bold text-white">
              Atual
            </span>
          ) : isPopular ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold text-brand-600">
              <Sparkles size={11} aria-hidden="true" />
              Popular
            </span>
          ) : null}
        </div>

        <p className="mt-1 min-h-[32px] text-xs leading-relaxed text-neutral-500">
          {plan.description}
        </p>
        <div className="my-5 flex items-baseline gap-1 border-b border-neutral-100 pb-5">
          <span className="text-3xl font-extrabold tracking-tight text-dark-800">
            {plan.priceCents === 0 ? 'Grátis' : formatPrice(plan.priceCents)}
          </span>
          {plan.priceCents > 0 && (
            <span className="text-xs font-semibold text-neutral-400">/mês</span>
          )}
        </div>

        <div className="space-y-3">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            Recursos incluídos:
          </span>
          <ul className="space-y-2.5 text-xs text-neutral-600">
            {sortedLimits.map(([key, value]) => {
              const item = formatLimitItem(key, value)
              const Icon = item.icon
              return (
                <li key={key} className="flex items-start gap-2">
                  <Icon size={15} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
                  <span className="leading-snug">
                    {item.label}{' '}
                    <strong className="font-semibold text-dark-800">{item.valueText}</strong>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="mt-8 border-t border-neutral-100 pt-4">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-xs leading-snug text-neutral-500">
              {plan.priceCents === 0
                ? 'Seu plano pago segue até o fim do período. Depois o workspace volta ao Grátis.'
                : 'Os limites mudam agora e o valor é ajustado proporcionalmente na próxima fatura.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSubscribe}
                disabled={busy}
                className="h-9 flex-1 rounded-md bg-dark-800 text-xs font-bold text-white transition-[background-color,transform] duration-150 hover:bg-dark-700 active:scale-[0.97] disabled:opacity-60"
              >
                {busy ? 'Aplicando…' : 'Confirmar'}
              </button>
              <button
                type="button"
                onClick={onCancelConfirm}
                className="h-9 rounded-md px-3 text-xs font-semibold text-neutral-500 transition-[background-color,transform] duration-150 hover:bg-neutral-100 active:scale-[0.97]"
              >
                Voltar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={needsConfirm ? onConfirm : onSubscribe}
            disabled={busy || isCurrent || !isOwner}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-semibold transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 ${
              isCurrent
                ? 'cursor-default border border-neutral-200 bg-neutral-100 text-neutral-400'
                : plan.priceCents === 0 || isDowngrade
                  ? 'border border-neutral-300 bg-white text-dark-800 hover:bg-neutral-50'
                  : 'bg-brand-500 text-white shadow-xs hover:bg-brand-600'
            }`}
          >
            {busy ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
                Processando…
              </>
            ) : (
              <>
                {buttonLabel}
                {!isCurrent && plan.priceCents > 0 && !isDowngrade && (
                  <ArrowRight size={15} aria-hidden="true" />
                )}
              </>
            )}
          </button>
        )}
      </div>
    </BillingPlanCardSurface>
  )
}

function ScalePlan({
  plan,
  currentPlan,
  currentTier,
  entitlementStatus,
  paidActive,
  cancelAtPeriodEnd,
  isOwner,
  busy,
  confirming,
  onConfirm,
  onCancelConfirm,
  onSubscribe,
}: {
  plan: CatalogPlan
  currentPlan: CatalogPlan | null
  currentTier: string
  entitlementStatus: string
  paidActive: boolean
  cancelAtPeriodEnd: boolean
  isOwner: boolean
  busy: boolean
  confirming: boolean
  onConfirm: () => void
  onCancelConfirm: () => void
  onSubscribe: () => void
}) {
  const isCurrent =
    entitlementStatus === 'active' &&
    currentTier === 'scale' &&
    !cancelAtPeriodEnd &&
    paidActive
  const isUpgrade = paidActive && plan.sortOrder > (currentPlan?.sortOrder ?? 0)
  const sortedLimits = Object.entries(plan.limits).sort(([keyA], [keyB]) => {
    const indexA = limitOrder.indexOf(keyA)
    const indexB = limitOrder.indexOf(keyB)
    return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB)
  })

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          Alto volume
        </span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>
      <article
        className={`relative rounded-xl p-6 transition-[border-color,box-shadow] duration-200 md:p-8 ${
          isCurrent
            ? 'border-2 border-dark-800 bg-neutral-50/50'
            : 'border border-neutral-200 bg-white shadow-2xs hover:border-brand-300 hover:shadow-sm'
        }`}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-xl font-bold text-dark-800">
                {tierLabels[plan.tier] ?? plan.name}
              </h2>
              {isCurrent && (
                <span className="rounded-full bg-dark-800 px-2.5 py-0.5 text-[11px] font-bold text-white">
                  Atual
                </span>
              )}
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-neutral-500">{plan.description}</p>
            <ul className="mt-5 grid grid-cols-1 gap-3 text-xs text-neutral-600 sm:grid-cols-2">
              {sortedLimits.map(([key, value]) => {
                const item = formatLimitItem(key, value)
                const Icon = item.icon
                return (
                  <li key={key} className="flex items-start gap-2">
                    <Icon size={15} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
                    <span className="leading-snug">
                      {item.label}{' '}
                      <strong className="font-semibold text-dark-800">{item.valueText}</strong>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="flex shrink-0 flex-col justify-between gap-5 md:w-64 md:border-l md:border-neutral-100 md:pl-10">
            <div>
              <span className="text-3xl font-extrabold tracking-tight text-dark-800">
                {formatPrice(plan.priceCents)}
              </span>
              <span className="text-xs font-semibold text-neutral-400">/mês</span>
            </div>

            {confirming ? (
              <div className="space-y-2">
                <p className="text-xs leading-snug text-neutral-500">
                  Os limites mudam agora e o valor é ajustado proporcionalmente na próxima fatura.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onSubscribe}
                    disabled={busy}
                    className="h-9 flex-1 rounded-md bg-dark-800 text-xs font-bold text-white transition-[background-color,transform] duration-150 hover:bg-dark-700 active:scale-[0.97] disabled:opacity-60"
                  >
                    {busy ? 'Aplicando…' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelConfirm}
                    className="h-9 rounded-md px-3 text-xs font-semibold text-neutral-500 transition-[background-color,transform] duration-150 hover:bg-neutral-100 active:scale-[0.97]"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={isUpgrade ? onSubscribe : onConfirm}
                disabled={busy || isCurrent || !isOwner}
                className={`flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-semibold transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 ${
                  isCurrent
                    ? 'cursor-default border border-neutral-200 bg-neutral-100 text-neutral-400'
                    : 'bg-brand-500 text-white shadow-xs hover:bg-brand-600'
                }`}
              >
                {busy ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
                    Processando…
                  </>
                ) : isCurrent ? (
                  'Plano atual'
                ) : (
                  <>
                    {isUpgrade ? 'Fazer upgrade' : 'Assinar Scale'}
                    <ArrowRight size={15} aria-hidden="true" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </article>
    </section>
  )
}

function AddonCard({
  addon,
  currentQuantity,
  busy,
  disabled,
  onApply,
}: {
  addon: CatalogAddon
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
    addon.key.includes('agent') || addon.key.includes('seat')
      ? Users
      : addon.key.includes('manager')
        ? UserRoundCog
        : addon.key.includes('connection')
          ? Link2
          : MessageSquareText

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-brand-100 bg-brand-50 text-brand-600">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-dark-800">{addon.name}</h3>
            {currentQuantity > 0 && (
              <span className="shrink-0 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-600">
                {currentQuantity} ativo{currentQuantity > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{addon.description}</p>
          <p className="mt-1.5 text-xs font-semibold text-dark-800">
            {formatPrice(addon.priceCents)}
            <span className="font-normal text-neutral-400">
              {' '}
              /mês por {addon.unitLabel ?? 'unidade'}
            </span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
            Cobrado integral na compra e renovado junto com a assinatura.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setQuantity((value) => Math.max(0, value - 1))}
            disabled={disabled || quantity === 0}
            aria-label="Diminuir quantidade"
            className="grid size-8 place-items-center rounded-md border border-neutral-300 text-neutral-600 transition-colors duration-150 hover:bg-neutral-50 disabled:opacity-40"
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <span className="w-10 text-center text-sm font-bold tabular-nums text-dark-800">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((value) => Math.min(99, value + 1))}
            disabled={disabled}
            aria-label="Aumentar quantidade"
            className="grid size-8 place-items-center rounded-md border border-neutral-300 text-neutral-600 transition-colors duration-150 hover:bg-neutral-50 disabled:opacity-40"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onApply(quantity)}
          disabled={disabled || busy || !dirty}
          className="h-9 rounded-md bg-dark-800 px-4 text-xs font-bold text-white transition-colors duration-150 hover:bg-dark-700 disabled:opacity-40"
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
    </article>
  )
}
