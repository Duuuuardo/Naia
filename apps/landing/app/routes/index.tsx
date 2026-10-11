import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CheckCheck,
  Megaphone,
  Menu,
  MessageCircle,
  ShieldCheck,
  UserRound,
  X,
  Zap,
} from 'lucide-react'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  return (
    <div className="bg-neutral-0">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Products />
        <WhyNaia />
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
    { href: '#produtos', label: 'Produtos' },
    { href: '#porque', label: 'Por que a Naia' },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-neutral-0/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        <a href="/" aria-label="Naia">
          <img src="/brand/naia-logo-dark.png" alt="Naia" className="h-6 w-auto" />
        </a>
        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-500 md:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-dark-800">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="#produtos"
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 md:px-4"
          >
            Ver produtos
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
                href="#produtos"
                onClick={() => setMobileOpen(false)}
                className="block w-full rounded-md bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"
              >
                Ver produtos
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
            Venda no disparo.
            <br />
            <span className="text-brand-500">Fidelize na conversa.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-neutral-500">
            Alcance seus contatos em massa no WhatsApp e no Telegram, com opt-in
            garantido e o status de cada mensagem — enviada, entregue ou lida.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/campaigns"
                className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-6 py-3.5 text-base font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                Naia Campanhas
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
            <p className="text-sm text-neutral-500">
              Disponível agora — crie a conta e dispare em minutos.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-medium text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <CheckCheck size={14} className="text-success-500" /> Sem cartão de crédito
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCheck size={14} className="text-success-500" /> Setup em 2 minutos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCheck size={14} className="text-success-500" /> WhatsApp + Telegram
              </span>
            </div>
          </div>
        </div>
        <ChatMock />
      </div>
    </section>
  )
}

/** Assinatura visual: o disparo saindo com status em tempo real. */
function ChatMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm select-none">
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5 shadow-xl transition-all">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
          <span className="text-xs font-semibold text-dark-800 flex items-center gap-1.5">
            <Megaphone size={14} className="text-brand-500" /> Disparo · Oferta de Julho
          </span>
          <span className="rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-bold text-success-500">
            98,4% Entregue
          </span>
        </div>
        <div className="ml-auto max-w-[90%] rounded-lg rounded-br-sm bg-brand-500 px-4 py-3 text-sm leading-snug text-white shadow-sm animate-in fade-in">
          Oi, Marina! Chegou a condição que você pediu: 20% off até sexta. Quer garantir a sua?
          <span className="mt-1 flex items-center justify-end gap-1 text-xs text-brand-100 font-mono">
            14:02 <CheckCheck size={14} className="text-white" />
          </span>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 text-xs text-neutral-500">
          <div className="flex justify-between font-medium text-dark-800 mb-1">
            <span>Status em tempo real</span>
            <span className="text-brand-500">Opt-in validado</span>
          </div>
          <p>Envio em lotes com intervalos configuráveis para controlar o ritmo.</p>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400">
        A campanha sai em lotes e você acompanha o status de cada envio.
      </p>
    </div>
  )
}

const steps = [
  {
    icon: MessageCircle,
    title: 'Conecte seu número',
    text: 'Use um WhatsApp Business ou uma conta do Telegram. A conexão leva menos de dois minutos.',
  },
  {
    icon: Megaphone,
    title: 'Dispare a campanha',
    text: 'Importe seus contatos, escreva a mensagem e envie para milhares de pessoas em lotes.',
  },
  {
    icon: CheckCheck,
    title: 'Acompanhe os resultados',
    text: 'Entrega, leitura e falhas de cada envio, em tempo real — do primeiro ao último contato.',
  },
]

function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">Como funciona</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-3xl">
          Do disparo à venda em três passos
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
    </section>
  )
}

function Products() {
  return (
    <section id="produtos" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">
          O produto
        </p>
        <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-dark-800 md:text-4xl">
          Dispare em massa sem queimar seu número.
        </h2>
        <div className="mt-10 grid gap-6">
          <article className="group flex max-w-2xl flex-col rounded-xl border border-neutral-200 bg-neutral-0 p-8 transition-shadow hover:shadow-lg">
            <span className="grid size-12 place-items-center rounded-md bg-brand-500 text-white">
              <Megaphone size={24} />
            </span>
            <h3 className="mt-5 text-xl font-semibold text-dark-800">Naia Campanhas</h3>
            <p className="mt-2 flex-1 leading-relaxed text-neutral-500">
              Importe seus contatos, escreva uma vez e dispare para milhares de
              pessoas no WhatsApp e no Telegram. Você vê o status de cada mensagem:
              enviada, entregue ou lida. E só dispara para quem deu opt-in.
            </p>
            <Link
              to="/campaigns"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-500 transition-colors hover:text-brand-600"
            >
              Ver Naia Campanhas
              <ArrowRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
              />
            </Link>
          </article>
        </div>
      </div>
    </section>
  )
}

const reasons = [
  {
    icon: ShieldCheck,
    title: 'Opt-in não é sugestão',
    text: 'O sistema bloqueia o envio para contatos sem opt-in no WhatsApp. Sua base cresce sem queimar seu número.',
  },
  {
    icon: Zap,
    title: 'Resultado por mensagem',
    text: 'Cada mensagem tem status próprio: na fila, enviada, entregue, lida ou falhou. Você sabe exatamente o que aconteceu com a campanha.',
  },
  {
    icon: UserRound,
    title: 'Uma conta pra equipe toda',
    text: 'Todo mundo entra com a mesma conta, cada um com sua permissão. Quem sai do time perde o acesso na hora.',
  },
]

function WhyNaia() {
  return (
    <section id="porque" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 md:py-24">
      <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-dark-800 md:text-4xl">
        Feita para quem vende por conversa.
      </h2>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {reasons.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-neutral-200 p-6">
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

function FinalCta() {
  return (
    <section className="relative [overflow:clip] bg-dark-800">
      {/* Wave — top transition from light to dark */}
      <div aria-hidden="true" className="pointer-events-none -mb-px">
        <svg
          viewBox="0 0 1440 56"
          preserveAspectRatio="none"
          className="w-full h-10 md:h-14 block"
          fill="#ffffff"
        >
          <path d="M0,36 Q120,8 300,28 Q480,48 640,16 Q800,-14 960,22 Q1120,58 1280,30 Q1380,14 1440,24 L1440,0 L0,0 Z" />
        </svg>
      </div>

      {/* Ambient orbs */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent_0%,black_25%)]">
        <div className="absolute top-[12%] left-[-8%] h-[420px] w-[420px] rounded-full bg-brand-500 opacity-[0.13] blur-3xl motion-safe:[animation:float-a_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-12%] right-[2%] h-80 w-80 rounded-full bg-brand-400 opacity-[0.09] blur-3xl motion-safe:[animation:float-b_13s_ease-in-out_infinite]" />
        <div className="absolute top-[35%] left-[45%] h-52 w-52 rounded-full bg-brand-600 opacity-[0.07] blur-2xl motion-safe:[animation:float-a_17s_ease-in-out_3s_infinite]" />
      </div>

      {/* Content */}
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center md:py-24">
        <img src="/brand/naia-mark.png" alt="Naia" className="h-12 w-auto" />
        <h2 className="mt-6 max-w-xl text-3xl font-bold tracking-tight text-white md:text-4xl">
          Venda no disparo. Fidelize na conversa.
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-dark-300">
          Naia Campanhas já está disponível — crie a conta e dispare em minutos.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/campaigns"
            className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-600 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            Naia Campanhas
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Wave — bottom transition back to light */}
      <div aria-hidden="true" className="pointer-events-none -mt-px">
        <svg
          viewBox="0 0 1440 48"
          preserveAspectRatio="none"
          className="w-full h-8 md:h-12 block"
          fill="#ffffff"
        >
          <path d="M0,24 Q200,48 400,20 Q600,-8 800,28 Q1000,56 1200,18 Q1340,0 1440,20 L1440,48 L0,48 Z" />
        </svg>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="bg-neutral-0">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <div>
            <img src="/brand/naia-logo-dark.png" alt="Naia" className="h-6 w-auto" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-500">
              Comunicação que vende, no WhatsApp e no Telegram.
            </p>
          </div>
          <nav className="grid gap-y-2 text-sm" aria-label="Rodapé">
            <p className="mb-1 font-semibold text-dark-800">Produtos</p>
            <a href="/campaigns" className="text-neutral-500 transition-colors hover:text-brand-500">
              Naia Campanhas
            </a>
          </nav>
        </div>
        <p className="mt-10 border-t border-neutral-200 pt-6 text-xs text-neutral-400">
          © {new Date().getFullYear()} Naia. Feito no Brasil.
        </p>
      </div>
    </footer>
  )
}
