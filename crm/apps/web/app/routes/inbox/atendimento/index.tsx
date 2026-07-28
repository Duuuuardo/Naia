import { createFileRoute } from '@tanstack/react-router'
import { MessagesSquare } from 'lucide-react'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/atendimento/')({
  head: () => createHeadConfig('Atendimento — Naia CRM'),
  component: AtendimentoEmpty,
})

// Estado vazio da área de atendimento (visível no desktop, ao lado da lista,
// enquanto nenhuma conversa está aberta). No mobile a coluna fica oculta e o
// agente vê a lista em tela cheia.
function AtendimentoEmpty() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-50 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-neutral-100 text-neutral-400">
        <MessagesSquare size={26} aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold text-dark-800">Selecione uma conversa</p>
        <p className="mt-1 text-sm text-neutral-500">
          Escolha um atendimento na lista à esquerda para começar.
        </p>
      </div>
    </div>
  )
}
