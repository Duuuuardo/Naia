import { Link } from '@tanstack/react-router'
import { MessageCircle, Plug, Send } from 'lucide-react'
import { EmptyState, StatusBadge } from '../ui'
import type { WizardConnection, WizardDraft } from './types'

export function StepChannels({
  draft,
  patch,
  connections,
  workspaceId,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
  connections: WizardConnection[]
  workspaceId: string
}) {
  function toggle(id: string, disabled: boolean) {
    if (disabled) return
    patch({
      connectionIds: draft.connectionIds.includes(id)
        ? draft.connectionIds.filter((c) => c !== id)
        : [...draft.connectionIds, id],
    })
  }

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="Nenhuma conexão cadastrada neste workspace. Conecte um WhatsApp ou Telegram para disparar campanhas."
        action={
          <Link
            to="/$workspaceId/connections"
            params={{ workspaceId }}
            className="text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Ir para Conexões
          </Link>
        }
      />
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3 border-b border-neutral-100 pb-3">
        <h2 className="text-base font-bold text-dark-800">Canais</h2>
        <p className="text-xs text-neutral-500">
          Selecione as conexões de envio — com mais de uma, os envios são distribuídos entre elas.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 bg-neutral-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          <span className="w-5" />
          <span>Nome</span>
          <span>Canal</span>
          <span>Status</span>
        </div>
        <ul className="divide-y divide-neutral-100">
          {connections.map((conn) => {
            const selected = draft.connectionIds.includes(conn.id)
            const disabled = conn.status !== 'active'
            const Icon = conn.channel === 'telegram' ? Send : MessageCircle
            return (
              <li key={conn.id}>
                <button
                  type="button"
                  onClick={() => toggle(conn.id, disabled)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 px-4 py-3.5 text-left transition-colors duration-150 ${
                    disabled
                      ? 'cursor-not-allowed opacity-50'
                      : selected
                        ? 'bg-brand-50/60'
                        : 'hover:bg-neutral-50'
                  }`}
                >
                  <span
                    className={`grid size-5 place-items-center rounded border-2 transition-colors duration-150 ${
                      selected ? 'border-brand-500 bg-brand-500' : 'border-neutral-300 bg-neutral-0'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6.5L5 9L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-dark-800">
                    <Icon size={15} className={conn.channel === 'telegram' ? 'text-sky-500' : 'text-emerald-500'} aria-hidden="true" />
                    <span className="truncate">{conn.name}</span>
                  </span>
                  <span className="text-xs font-medium uppercase text-neutral-500">{conn.channel}</span>
                  <StatusBadge status={conn.status} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {draft.connectionIds.length > 1 && (
        <p className="mt-3 text-xs text-neutral-500">
          {draft.connectionIds.length} conexões selecionadas — o disparo alterna entre elas (round-robin). Se uma cair, as demais continuam.
        </p>
      )}
    </div>
  )
}
