import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ArrowRight,
  CheckCheck,
  Inbox,
  Megaphone,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react'
import { NaiaIcon, NaiaLogo } from '@naia/ui'

export const Route = createFileRoute('/')({
  component: Landing,
})

const CAMPAIGNS_URL = 'https://campaigns.naia.website'

function Landing() {
  return (
    <div className="bg-neutral-0">
      <Header />
      <main>
        <Hero />
        <Products />
        <WhyNaia />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-neutral-0/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="/" aria-label="Naia">
          <NaiaLogo size={28} />
        </a>
        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-500 md:flex">
          <a href="#produtos" className="transition-colors hover:text-dark-800">
            Produtos
          </a>
          <a href="#porque" className="transition-colors hover:text-dark-800">
            Por que a Naia
          </a>
        </nav>
        <a
          href={CAMPAIGNS_URL}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"
        >
          Criar minha primeira campanha
        </a>
      </div>
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
            A Naia leva sua oferta a milhares de contatos no WhatsApp e no
            Telegram. Cada resposta vai direto para sua equipe atender, sem
            disputar o mesmo celular.
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
              Campanha no ar em minutos. Só precisa de uma conta e um número.
            </p>
          </div>
        </div>
        <ChatMock />
      </div>
    </section>
  )
}

/** Assinatura visual interativa: o momento em que o disparo vira conversa e venda no CRM. */
function ChatMock() {
  const [tab, setTab] = useState<'dispatch' | 'crm'>('dispatch')

  return (
    <div className="relative mx-auto w-full max-w-sm select-none">
      <div className="flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 mb-3">
        <button
          type="button"
          onClick={() => setTab('dispatch')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all ${
            tab === 'dispatch'
              ? 'bg-neutral-0 text-brand-500 shadow-sm'
              : 'text-neutral-500 hover:text-dark-800'
          }`}
        >
          <Megaphone size={14} />
          1. Campanhas (Disparo)
        </button>
        <button
          type="button"
          onClick={() => setTab('crm')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all ${
            tab === 'crm'
              ? 'bg-neutral-0 text-dark-800 shadow-sm'
              : 'text-neutral-500 hover:text-dark-800'
          }`}
        >
          <Inbox size={14} />
          2. CRM (Atendimento)
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5 shadow-xl transition-all">
        {tab === 'dispatch' ? (
          <>
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
              <span className="text-xs font-semibold text-dark-800 flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success-500" /> Disparo · Oferta de Julho
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
              <p>Envio automático em lotes sem risco de bloqueio do número.</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
              <span className="text-xs font-semibold text-dark-800 flex items-center gap-1.5">
                <Inbox size={14} className="text-brand-500" /> Inbox Unificado · WhatsApp
              </span>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-600">
                Ativo
              </span>
            </div>
            <div className="max-w-[85%] rounded-lg rounded-bl-sm bg-neutral-0 px-4 py-3 text-sm leading-snug text-dark-800 shadow-sm animate-in fade-in border border-neutral-200/60">
              Quero sim! Como faço o pagamento?
              <span className="mt-1 block text-right text-xs text-neutral-400 font-mono">14:05</span>
            </div>
            <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-dark-800 px-4 py-3 text-sm leading-snug text-white shadow-sm animate-in fade-in">
              Maravilha, Marina! Segue o link seguro com o desconto aplicado.
              <span className="mt-1 block text-right text-xs text-neutral-400 font-mono">14:06</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-0 px-3 py-2.5">
              <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-brand-600 font-bold text-xs">
                CA
              </span>
              <p className="text-xs text-neutral-500">
                Atendimento atribuído a <strong className="text-dark-800">Camila</strong> · Naia CRM
              </p>
            </div>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400">
        Clique nas abas acima para simular: o disparo atrai no Naia Campanhas e sua equipe converte no CRM.
      </p>
    </div>
  )
}

function Products() {
  return (
    <section id="produtos" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-500">
          Dois produtos
        </p>
        <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-dark-800 md:text-4xl">
          Um pra alcançar. Um pra atender.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <article className="group flex flex-col rounded-xl border border-neutral-200 bg-neutral-0 p-8 transition-shadow hover:shadow-lg">
            <span className="grid size-12 place-items-center rounded-md bg-brand-500 text-white">
              <Megaphone size={24} />
            </span>
            <h3 className="mt-5 text-xl font-semibold text-dark-800">Naia Campanhas</h3>
            <p className="mt-2 flex-1 leading-relaxed text-neutral-500">
              Importe seus contatos, escreva uma vez e dispare para milhares de
              pessoas no WhatsApp e no Telegram. Opt-in respeitado, status de
              cada mensagem na tela: enviada, entregue, lida.
            </p>
            <a
              href={CAMPAIGNS_URL}
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-500 transition-colors hover:text-brand-600"
            >
              Criar minha primeira campanha
              <ArrowRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
              />
            </a>
          </article>
          <article className="flex flex-col rounded-xl border border-neutral-200 bg-neutral-0 p-8">
            <span className="grid size-12 place-items-center rounded-md bg-dark-800 text-white">
              <Inbox size={24} />
            </span>
            <div className="mt-5 flex items-center gap-3">
              <h3 className="text-xl font-semibold text-dark-800">Naia CRM</h3>
              <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-600">
                Em breve
              </span>
            </div>
            <p className="mt-2 flex-1 leading-relaxed text-neutral-500">
              Todas as respostas dos seus clientes num inbox só, com atribuição
              por atendente e histórico completo. Cada conversa tem dono, do
              primeiro oi ao problema resolvido.
            </p>
            <p className="mt-6 text-sm font-medium text-neutral-500">
              Chega ainda este ano.
            </p>
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
    text: 'Contato sem consentimento fica fora do disparo de WhatsApp: o sistema bloqueia, não avisa. Sua base cresce sem queimar seu número.',
  },
  {
    icon: Zap,
    title: 'Resultado por mensagem',
    text: 'Cada mensagem tem status próprio: na fila, enviada, entregue, lida ou falhou. Você sabe exatamente o que aconteceu com a campanha.',
  },
  {
    icon: UserRound,
    title: 'Uma conta pra equipe toda',
    text: 'Todo mundo entra com a mesma conta nos dois produtos, cada um com sua permissão. Quem sai do time perde o acesso na hora.',
  },
]

function WhyNaia() {
  return (
    <section id="porque" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 md:py-24">
      <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-dark-800 md:text-4xl">
        Feita pra quem vive de conversa, não de spam.
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
    <section className="border-t border-neutral-200 bg-dark-800">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center md:py-24">
        <NaiaIcon size={40} />
        <h2 className="mt-6 max-w-xl text-3xl font-bold tracking-tight text-white md:text-4xl">
          Sua próxima venda está a uma mensagem de distância.
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-dark-300">
          Crie sua conta, conecte um número e coloque a primeira campanha no ar
          hoje.
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
            <NaiaLogo size={26} />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-500">
              Comunicação que vende, no WhatsApp e no Telegram.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-16 gap-y-2 text-sm" aria-label="Rodapé">
            <p className="col-span-2 mb-1 font-semibold text-dark-800">Produtos</p>
            <a href={CAMPAIGNS_URL} className="text-neutral-500 transition-colors hover:text-brand-500">
              Naia Campanhas
            </a>
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
