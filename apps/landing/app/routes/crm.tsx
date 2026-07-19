import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bell,
  Check,
  Clock,
  History,
  Inbox,
  Menu,
  MessageCircle,
  MessagesSquare,
  Send,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { NaiaIcon } from '@naia/ui'

export const Route = createFileRoute('/crm')({
  component: CrmLanding,
})

const CAMPAIGNS_URL = 'https://campaigns.naia.website'
const CRM_WAITLIST_URL = CAMPAIGNS_URL

function CrmLanding() {
  return (
    <div className="bg-neutral-0">
      <Header />
      <main>
        <Hero />
        <Problem />
        <Features />
        <Waitlist />
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
    { href: '#problema', label: 'O problema' },
    { href: '#recursos', label: 'Recursos' },
    { href: '#espera', label: 'Lista de espera' },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-neutral-0/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        <Link to="/" aria-label="Naia" className="inline-flex items-center gap-2">
          <img src="/brand/naia-mark.png" alt="Naia" className="h-6 w-auto" />
          <span className="font-sans text-xl font-bold tracking-tight text-dark-800">CRM</span>
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
            href={CRM_WAITLIST_URL}
            className="rounded-md bg-dark-800 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-dark-900 md:px-4"
          >
            Entrar na fila
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
                href={CRM_WAITLIST_URL}
                className="block w-full rounded-md bg-dark-800 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-dark-900"
              >
                Entrar na fila
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
        className="pointer-events-none absolute -top-32 left-[-10%] h-[420px] w-[560px] rounded-full bg-brand-100 opacity-50 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 md:grid-cols-2 md:py-28">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-600">
            <Bell size={12} /> Em breve
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-[1.15] tracking-tight text-dark-800 md:text-6xl">
            Todas as conversas num inbox só.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-neutral-500">
            WhatsApp, Telegram e outros canais em um único lugar. Cada conversa
            tem um dono, um histórico e uma próxima ação clara.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3">
            <a
              href={CRM_WAITLIST_URL}
              className="inline-flex items-center gap-2 rounded-md bg-dark-800 px-6 py-3.5 text-base font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-dark-900 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              Entrar na fila de espera
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <p className="text-sm text-neutral-500">
              Seja avisado assim que o Naia CRM estiver disponível.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-medium text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success-500" /> Multicanal
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success-500" /> Atribuição por atendente
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success-500" /> Histórico completo
              </span>
            </div>
          </div>
        </div>
        <InboxPreview />
      </div>
    </section>
  )
}

function InboxPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm select-none">
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
          <span className="text-xs font-semibold text-dark-800 flex items-center gap-1.5">
            <Inbox size={14} className="text-brand-500" /> Inbox Unificado
          </span>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-600">
            3 novas
          </span>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3">
          <span className="grid size-9 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <MessageCircle size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-dark-800 truncate">Marina Silva</p>
            <p className="text-xs text-neutral-500 truncate">Quero sim. Como faço o pagamento?</p>
          </div>
          <span className="text-[10px] text-neutral-400">14:05</span>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 opacity-70">
          <span className="grid size-9 place-items-center rounded-full bg-blue-100 text-blue-600">
            <Send size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-dark-800 truncate">Pedro Costa</p>
            <p className="text-xs text-neutral-500 truncate">Tem frete grátis?</p>
          </div>
          <span className="text-[10px] text-neutral-400">13:48</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-0 px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-brand-600 font-bold text-xs">
            CA
          </span>
          <p className="text-xs text-neutral-500">
            Atribuído a <strong className="text-dark-800">Camila</strong>
          </p>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400">
        WhatsApp e Telegram no mesmo painel, com atendente responsável por cada conversa.
      </p>
    </div>
  )
}

function Problem() {
  return (
    <section id="problema" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">O problema</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-3xl">
              Respostas espalhadas viram vendas perdidas
            </h2>
            <p className="mt-4 text-lg text-neutral-500 leading-relaxed">
              Quando a campanha dispara, as respostas chegam em vários celulares e contas.
              Ninguém sabe quem respondeu o quê. Clientes esperam. Oportunidades somem.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Vários atendentes no mesmo número',
                'Sem histórico de conversas anteriores',
                'Nenhuma visão do que falta responder',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-neutral-600">
                  <X size={16} className="mt-0.5 shrink-0 text-error-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-neutral-0 p-6 shadow-sm">
            <h3 className="text-base font-semibold text-dark-800">Com o Naia CRM</h3>
            <ul className="mt-4 space-y-3">
              {[
                'Todas as conversas num inbox só',
                'Cada atendente vê só o que é dele',
                'Histórico completo do primeiro ao último contato',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-neutral-600">
                  <Check size={16} className="mt-0.5 shrink-0 text-success-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

const features = [
  {
    icon: Inbox,
    title: 'Inbox unificado',
    text: 'WhatsApp, Telegram e futuros canais num só lugar. Pare de alternar entre contas.',
  },
  {
    icon: UserCheck,
    title: 'Atribuição por atendente',
    text: 'Cada conversa tem um responsável. Ninguém fica sem dono e nada se perde.',
  },
  {
    icon: History,
    title: 'Histórico completo',
    text: 'Veja toda a trajetória do cliente: campanhas recebidas, respostas e anotações.',
  },
  {
    icon: Clock,
    title: 'Fila de atendimento',
    text: 'Saiba o que precisa de resposta agora. Priorize por tempo de espera ou valor.',
  },
  {
    icon: MessagesSquare,
    title: 'Respostas rápidas',
    text: 'Use respostas prontas e macros para acelerar o atendimento sem perder a personalização.',
  },
  {
    icon: Users,
    title: 'Equipe alinhada',
    text: 'Múltiplos atendentes, permissões e visão unificada da operação.',
  },
]

function Features() {
  return (
    <section id="recursos" className="scroll-mt-20 mx-auto max-w-6xl px-6 py-16 md:py-24">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">Recursos</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-3xl">
          Tudo para atender sem perder ninguém
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

function Waitlist() {
  return (
    <section id="espera" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">Lista de espera</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-dark-800 md:text-3xl">
          Seja um dos primeiros a usar
        </h2>
        <p className="mt-4 text-lg text-neutral-500">
          O Naia CRM está em desenvolvimento. Quem entra na fila de espera terá acesso antecipado
          e condições especiais no lançamento.
        </p>
        <a
          href={CRM_WAITLIST_URL}
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-dark-800 px-6 py-3.5 text-base font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-dark-900 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          Entrar na fila de espera
          <ArrowRight size={18} aria-hidden="true" />
        </a>
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
          Venda no disparo. Atenda na conversa.
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-dark-300">
          O Naia CRM chega ainda este ano. Entre na fila e seja avisado no lançamento.
        </p>
        <a
          href={CRM_WAITLIST_URL}
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-600 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          Entrar na fila de espera
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
            <Link to="/campaigns" className="text-neutral-500 transition-colors hover:text-brand-500">
              Naia Campanhas
            </Link>
            <span className="text-neutral-400">Naia CRM (em breve)</span>
          </nav>
        </div>
        <p className="mt-10 border-t border-neutral-200 pt-6 text-xs text-neutral-400">
          © {new Date().getFullYear()} Naia. Feito no Brasil.
        </p>
      </div>
    </footer>
  )
}
