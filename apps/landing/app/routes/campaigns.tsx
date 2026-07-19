import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Check,
  Layers,
  Menu,
  MessageCircle,
  Rocket,
  Send,
  ShieldCheck,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { NaiaIcon } from '@naia/ui'

export const Route = createFileRoute('/campaigns')({
  component: CampaignsLanding,
})

const CAMPAIGNS_URL = 'https://campaigns.naia.website'

function CampaignsLanding() {
  return (
    <div className="bg-neutral-0">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!mobileOpen) return
    document.body.style.overflow = 'hidden'
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onEscape)
    }
  }, [mobileOpen])

  const navLinks = [
    { href: '#como-funciona', label: 'Como funciona' },
    { href: '#recursos', label: 'Recursos' },
    { href: '#precos', label: 'Preços' },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-neutral-0/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        <Link to="/" aria-label="Naia" className="inline-flex items-center gap-2">
          <img src="/brand/naia-mark.png" alt="Naia" className="h-6 w-auto" />
          <span className="font-sans text-xl font-bold tracking-tight text-dark-800">Campaigns</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-500 md:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-dark-800">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={CAMPAIGNS_URL}
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 md:px-4"
          >
            Criar campanha
          </a>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={mobileOpen}
            aria-haspopup="dialog"
            className="inline-flex size-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-dark-800 transition-colors md:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
          className="fixed inset-0 z-50 md:hidden"
        >
          <div
            className="absolute inset-0 bg-dark-800/30 backdrop-blur-xs motion-safe:animate-[fade-in_200ms_ease-out]"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-0 bottom-0 w-64 max-w-[80vw] bg-neutral-0 border-l border-neutral-200 shadow-xl motion-safe:animate-[drawer-in_200ms_ease-out] flex flex-col">
            <div className="flex items-center justify-between px-4 h-16 border-b border-neutral-200">
              <span className="font-display text-sm font-bold text-dark-800">Menu</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Fechar menu"
                className="inline-flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-dark-800 transition-colors"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-md px-3 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-dark-800 transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="p-4 border-t border-neutral-200">
              <a
                href={CAMPAIGNS_URL}
                className="block w-full rounded-md bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"
              >
                Criar campanha
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 right-[-10%] h-[420px] w-[560px] rounded-full bg-brand-100 opacity-50 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 md:grid-cols-2 md:py-28">
        <div>
          <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-dark-800 md:text-6xl">
            Venda no WhatsApp e no Telegram em escala.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-neutral-500">
            Importe seus contatos, escreva uma mensagem e dispare para milhares de
            pessoas. Cada resposta vira uma oportunidade de venda na sua equipe.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3">
            <a
              href={CAMPAIGNS_URL}
              className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-6 py-3.5 text-base font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              Criar minha primeira campanha
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <p className="text-sm text-neutral-500">
              Campanha no ar em minutos. Sem cartão de crédito.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-medium text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success-500" /> Setup em 2 minutos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success-500" /> Opt-in validado
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success-500" /> WhatsApp + Telegram
              </span>
            </div>
          </div>
        </div>
        <CampaignPreview />
      </div>
    </section>
  )
}

function CampaignPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm select-none">
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
          <span className="text-xs font-semibold text-dark-800 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success-500" /> Oferta de Julho
          </span>
          <span className="rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-bold text-success-500">
            98,4% Entregue
          </span>
        </div>
        <div className="ml-auto max-w-[90%] rounded-lg rounded-br-sm bg-brand-500 px-4 py-3 text-sm leading-snug text-white shadow-sm">
          Oi, Marina! Chegou a condição que você pediu: 20% off até sexta. Quer garantir a sua?
          <span className="mt-1 flex items-center justify-end gap-1 text-xs text-brand-100 font-mono">
            14:02
          </span>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 text-xs text-neutral-500">
          <div className="flex justify-between font-medium text-dark-800 mb-1">
            <span>Status em tempo real</span>
            <span className="text-brand-500">Opt-in validado</span>
          </div>
          <p>Envio automático em lotes sem risco de bloqueio do número.</p>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400">
        Dispare uma vez e acompanhe entrega, leitura e resposta em tempo real.
      </p>
    </div>
  )
}

const steps = [
  {
    icon: Upload,
    title: 'Importe seus contatos',
    text: 'CSV, importação manual ou API. Você organiza a base do seu jeito.',
  },
  {
    icon: Rocket,
    title: 'Crie e programe a campanha',
    text: 'Escreva a mensagem, escolha o canal e programe o envio em lotes.',
  },
  {
    icon: BarChart3,
    title: 'Acompanhe os resultados',
    text: 'Veja enviadas, entregues, lidas e respondidas. Saiba o que funciona.',
  },
]

function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">Como funciona</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-3xl">
            Da mensagem à venda em três passos
          </h2>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, index) => (
            <div key={title} className="relative rounded-xl border border-neutral-200 bg-neutral-0 p-6">
              <span className="absolute -top-3 left-6 inline-flex size-6 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-600">
                {index + 1}
              </span>
              <span className="grid size-11 place-items-center rounded-md bg-brand-100 text-brand-600 mt-2">
                <Icon size={22} />
              </span>
              <h3 className="mt-4 text-base font-semibold text-dark-800">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const features = [
  {
    icon: Users,
    title: 'Base de contatos',
    text: 'Importe, segmente e mantenha sua base organizada. Cada contato carrega opt-in, tags e histórico.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp e Telegram',
    text: 'Dispare pelos dois canais no mesmo painel. Escolha o canal certo para cada tipo de mensagem.',
  },
  {
    icon: Layers,
    title: 'Envio em lotes',
    text: 'Evite bloqueios com envio escalonado. Configure intervalos, janelas de horário e limites diários.',
  },
  {
    icon: BarChart3,
    title: 'Relatórios por mensagem',
    text: 'Veja o status de cada envio: enviada, entregue, lida ou falha. Meça conversão por campanha.',
  },
  {
    icon: Zap,
    title: 'Automações',
    text: 'Crie gatilhos que disparam mensagens sozinhos: aniversário, abandono, follow-up e mais.',
  },
  {
    icon: ShieldCheck,
    title: 'Opt-in respeitado',
    text: 'O sistema bloqueia envios para contatos sem consentimento no WhatsApp. Sua base cresce sem queimar número.',
  },
]

function Features() {
  return (
    <section id="recursos" className="scroll-mt-20 mx-auto max-w-6xl px-6 py-16 md:py-24">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">Recursos</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-3xl">
          Tudo para disparar com segurança
        </h2>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-neutral-200 bg-neutral-0 p-6">
            <span className="grid size-11 place-items-center rounded-md bg-brand-100 text-brand-600">
              <Icon size={22} />
            </span>
            <h3 className="mt-4 text-base font-semibold text-dark-800">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">{text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const plans = [
  {
    name: 'Inicial',
    price: 'Grátis',
    description: 'Para testar seus primeiros disparos.',
    features: ['Até 500 contatos', '1 canal ativo', 'Relatórios básicos', 'Suporte por email'],
    cta: 'Criar conta grátis',
    featured: false,
  },
  {
    name: 'Profissional',
    price: 'R$ 97/mês',
    description: 'Para equipes que já vendem por mensagem.',
    features: ['Contatos ilimitados', 'Canais ilimitados', 'Automações', 'Relatórios avançados', 'Suporte prioritário'],
    cta: 'Começar agora',
    featured: true,
  },
  {
    name: 'Empresarial',
    price: 'Sob consulta',
    description: 'Para operações com volume e múltiplos atendentes.',
    features: ['Tudo do Profissional', 'Onboarding dedicado', 'SLA de suporte', 'API completa', 'Infra dedicada opcional'],
    cta: 'Falar com vendas',
    featured: false,
  },
]

function Pricing() {
  return (
    <section id="precos" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">Preços</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-4xl">
            Escolha o tamanho da sua operação
          </h2>
          <p className="mt-4 text-lg text-neutral-500">
            Comece grátis e pague só quando sua base crescer.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-xl border p-6 flex flex-col ${
                plan.featured
                  ? 'border-brand-500 bg-neutral-0 shadow-lg'
                  : 'border-neutral-200 bg-neutral-0'
              }`}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-6 inline-flex items-center rounded-full bg-brand-500 px-2.5 py-0.5 text-[11px] font-bold text-white">
                  Mais popular
                </span>
              )}
              <div>
                <h3 className="text-base font-semibold text-dark-800">{plan.name}</h3>
                <p className="mt-1 text-sm text-neutral-500">{plan.description}</p>
              </div>
              <p className="mt-4 text-3xl font-bold text-dark-800">{plan.price}</p>
              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-neutral-600">
                    <Check size={16} className="mt-0.5 shrink-0 text-success-500" />
                    {feature}
                  </li>
                ))}
              </ul>
              <a
                href={CAMPAIGNS_URL}
                className={`mt-6 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors ${
                  plan.featured
                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                    : 'border border-neutral-200 bg-neutral-0 text-dark-800 hover:bg-neutral-100'
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="border-t border-neutral-200 bg-dark-800">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center md:py-24">
        <NaiaIcon size={40} />
        <h2 className="mt-6 max-w-xl text-3xl font-bold tracking-tight text-white md:text-4xl">
          Envie sua primeira campanha hoje.
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-dark-300">
          Crie sua conta, conecte um número e alcance seus contatos em menos de 10 minutos.
        </p>
        <a
          href={CAMPAIGNS_URL}
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-600 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          Criar minha primeira campanha
          <ArrowRight size={18} aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-0">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <div>
            <img src="/brand/naia-logo-dark.png" alt="Naia" className="h-6 w-auto" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-500">
              Comunicação que vende, no WhatsApp e no Telegram.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-16 gap-y-2 text-sm" aria-label="Rodapé">
            <p className="col-span-2 mb-1 font-semibold text-dark-800">Produtos</p>
            <a href={CAMPAIGNS_URL} className="text-neutral-500 transition-colors hover:text-brand-500">
              Naia Campanhas
            </a>
            <Link to="/crm" className="text-neutral-500 transition-colors hover:text-brand-500">
              Naia CRM
            </Link>
          </nav>
        </div>
        <p className="mt-10 border-t border-neutral-200 pt-6 text-xs text-neutral-400">
          © {new Date().getFullYear()} Naia. Feito no Brasil.
        </p>
      </div>
    </footer>
  )
}
