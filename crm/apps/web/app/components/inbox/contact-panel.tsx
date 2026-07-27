import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Ban,
  Building2,
  KanbanSquare,
  Mail,
  MessageCircle,
  Send,
  StickyNote,
} from 'lucide-react'
import { Badge, Button, ErrorNote, Modal, getInitials } from '../ui'
import { blockContact, unblockContact } from '../../lib/inbox-thread'
import {
  type ContactDealItem,
  type ContactDetail,
  type ContactHistoryEntry,
  type ContactIdentityItem,
  type TagItem,
} from '../../lib/inbox-session'
import { addConversationNote, type ConversationNoteItem } from '../../lib/inbox-notes'

const channelIcon = { whatsapp: MessageCircle, telegram: Send }

const conversationStatusMeta: Record<string, { label: string; color: string }> = {
  open: { label: 'Aberta', color: 'text-brand-600 bg-brand-50' },
  assigned: { label: 'Atribuída', color: 'text-blue-600 bg-blue-50' },
  pending: { label: 'Aguardando cliente', color: 'text-amber-600 bg-amber-50' },
  resolved: { label: 'Resolvida', color: 'text-neutral-500 bg-neutral-100' },
}

const dealStatusMeta: Record<string, { label: string; className: string }> = {
  open: { label: 'Aberto', className: 'border-blue-200 bg-blue-50 text-blue-600' },
  won: { label: 'Ganho', className: 'border-brand-200 bg-brand-50 text-brand-600' },
  lost: { label: 'Perdido', className: 'border-neutral-200 bg-neutral-100 text-neutral-500' },
}

function formatDealValue(deal: ContactDealItem): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: deal.currency || 'BRL' }).format(
      deal.valueCents / 100,
    )
  } catch {
    return `R$ ${(deal.valueCents / 100).toFixed(2)}`
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">{children}</h3>
}

// Painel lateral do contato na thread: dados, tags, deals, histórico de
// atendimentos e notas internas da conversa. Renderizado como aside no
// desktop e dentro de um Modal no mobile (quem controla é a rota).
export function ContactPanel({
  contact,
  identities,
  deals,
  history,
  tags,
  notes,
  conversationId,
  blocked,
  onBlockedChange,
  onNoteAdded,
}: {
  contact: ContactDetail | null
  identities: ContactIdentityItem[]
  deals: ContactDealItem[]
  history: ContactHistoryEntry[]
  tags: TagItem[]
  notes: ConversationNoteItem[]
  conversationId: string
  blocked: boolean
  onBlockedChange: (blocked: boolean) => void
  onNoteAdded: (note: ConversationNoteItem | null) => void
}) {
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockError, setBlockError] = useState<string | null>(null)

  if (!contact) {
    return <p className="p-5 text-sm text-neutral-400">Contato não encontrado.</p>
  }

  const tagColorByName = new Map(tags.map((t) => [t.name, t.color]))
  const recentHistory = history.slice(0, 5)

  async function handleConfirmBlock() {
    if (blockBusy) return
    setBlockBusy(true)
    setBlockError(null)
    const result = await blockContact({ data: { contactId: contact!.id } })
    setBlockBusy(false)
    if (!result.ok) {
      setBlockError('Não foi possível bloquear o contato. Tente de novo.')
      return
    }
    setBlockModalOpen(false)
    onBlockedChange(true)
  }

  async function handleUnblock() {
    if (blockBusy) return
    setBlockBusy(true)
    setBlockError(null)
    const result = await unblockContact({ data: { contactId: contact!.id } })
    setBlockBusy(false)
    if (!result.ok) {
      setBlockError('Não foi possível desbloquear o contato. Tente de novo.')
      return
    }
    onBlockedChange(false)
  }

  return (
    <div className="space-y-6 p-4">
      {/* Dados do contato */}
      <section>
        <div className="flex flex-col items-center gap-2 pb-3 text-center">
          {contact.avatarUrl ? (
            <img
              src={contact.avatarUrl}
              alt=""
              className="size-14 rounded-full border border-neutral-200 object-cover"
            />
          ) : (
            <span className="grid size-14 place-items-center rounded-full bg-neutral-100 text-sm font-bold text-dark-800">
              {getInitials(contact.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-dark-800">{contact.name}</p>
            {(contact.company || contact.email) && (
              <p className="truncate text-xs text-neutral-400">
                {[contact.company, contact.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          {blocked && (
            <Badge className="border-error-500/25 bg-error-500/5 text-error-500">Bloqueado</Badge>
          )}
          <Link
            to="/inbox/contatos/$contactId"
            params={{ contactId: contact.id }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500"
          >
            Ver contato completo
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
          {blockError && <ErrorNote>{blockError}</ErrorNote>}
          <Button
            variant={blocked ? 'secondary' : 'danger'}
            size="sm"
            icon={Ban}
            loading={blockBusy && !blockModalOpen}
            onClick={() => (blocked ? handleUnblock() : setBlockModalOpen(true))}
            className="w-full"
          >
            {blocked ? 'Desbloquear contato' : 'Bloquear contato'}
          </Button>
        </div>
        <dl className="space-y-2">
          {contact.company && (
            <div className="flex items-center gap-2 text-sm text-dark-800">
              <Building2 size={13} className="shrink-0 text-neutral-400" aria-hidden="true" />
              <span className="truncate">{contact.company}</span>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-2 text-sm text-dark-800">
              <Mail size={13} className="shrink-0 text-neutral-400" aria-hidden="true" />
              <span className="truncate">{contact.email}</span>
            </div>
          )}
          {identities.map((identity) => {
            const ChannelIcon = channelIcon[identity.channelType]
            return (
              <div key={identity.id} className="flex items-center gap-2 text-sm text-dark-800">
                <ChannelIcon size={13} className="shrink-0 text-neutral-400" aria-hidden="true" />
                <span className="truncate">{identity.channelIdentifier}</span>
                {identity.isPrimary && (
                  <span className="shrink-0 text-[10px] font-semibold text-neutral-400">principal</span>
                )}
              </div>
            )
          })}
        </dl>
      </section>

      {/* Tags do contato */}
      <section>
        <SectionTitle>Tags do contato</SectionTitle>
        {contact.tags.length === 0 ? (
          <p className="text-sm text-neutral-400">Sem tags.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-0 px-2 py-0.5 text-xs font-medium text-dark-800"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tagColorByName.get(name) ?? 'var(--color-neutral-300)' }}
                  aria-hidden="true"
                />
                {name}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Deals */}
      <section>
        <SectionTitle>Deals</SectionTitle>
        {deals.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhum deal vinculado.</p>
        ) : (
          <ul className="space-y-2">
            {deals.map((deal) => {
              const meta = dealStatusMeta[deal.status] ?? dealStatusMeta.open
              return (
                <li key={deal.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-2.5">
                  <div className="flex items-center gap-2">
                    <KanbanSquare size={13} className="shrink-0 text-neutral-400" aria-hidden="true" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-dark-800">{deal.title}</p>
                    <Badge className={`shrink-0 ${meta.className}`}>{meta.label}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-neutral-400">
                    {deal.pipelineName} · {deal.stageName}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-dark-800">{formatDealValue(deal)}</p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Histórico de atendimentos */}
      <section>
        <SectionTitle>Histórico de atendimentos</SectionTitle>
        {recentHistory.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhum atendimento registrado.</p>
        ) : (
          <ul className="space-y-1.5">
            {recentHistory.map((entry) => {
              const meta = conversationStatusMeta[entry.status] ?? conversationStatusMeta.open
              const current = entry.id === conversationId
              return (
                <li key={entry.id}>
                  <Link
                    to="/inbox/c/$conversationId"
                    params={{ conversationId: entry.id }}
                    className={`block rounded-lg border p-2.5 transition-colors ${
                      current
                        ? 'border-brand-200 bg-brand-50'
                        : 'border-neutral-100 bg-neutral-50 hover:border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                      {current && (
                        <span className="text-[10px] font-semibold text-brand-600">atual</span>
                      )}
                      <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{formatDate(entry.createdAt)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-neutral-400">
                      {entry.connection.name}
                      {entry.assignedAgent?.name ? ` · ${entry.assignedAgent.name}` : ''}
                      {` · ${entry.messageCount} ${entry.messageCount === 1 ? 'mensagem' : 'mensagens'}`}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Notas internas */}
      <NotesSection conversationId={conversationId} notes={notes} onNoteAdded={onNoteAdded} />

      <BlockContactModal
        open={blockModalOpen}
        contactName={contact.name}
        busy={blockBusy}
        onClose={() => setBlockModalOpen(false)}
        onConfirm={handleConfirmBlock}
      />
    </div>
  )
}

// Confirmação de bloqueio: explica que as mensagens do contato serão
// ignoradas. Exportado para reuso na página do contato.
export function BlockContactModal({
  open,
  contactName,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  contactName: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bloquear contato"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" icon={Ban} loading={busy} onClick={onConfirm}>
            Bloquear
          </Button>
        </>
      }
    >
      <p className="text-sm text-dark-800">
        Bloquear <strong>{contactName}</strong>?
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Mensagens enviadas por este contato serão ignoradas e não aparecerão no inbox, e a equipe não
        conseguirá enviar mensagens para ele. Você pode desbloquear a qualquer momento.
      </p>
    </Modal>
  )
}

// Notas internas da conversa: visual distinto de mensagem (fundo amber,
// ícone StickyNote) — nunca vão ao cliente.
function NotesSection({
  conversationId,
  notes,
  onNoteAdded,
}: {
  conversationId: string
  notes: ConversationNoteItem[]
  // Null = o POST não devolveu a nota; a rota decide como recarregar.
  onNoteAdded: (note: ConversationNoteItem | null) => void
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    const note = await addConversationNote({ data: { conversationId, content } })
    onNoteAdded(note)
    setDraft('')
    setSaving(false)
  }

  return (
    <section>
      <SectionTitle>Notas internas</SectionTitle>
      {notes.length === 0 ? (
        <p className="mb-2 text-sm text-neutral-400">Nenhuma nota nesta conversa.</p>
      ) : (
        <ul className="mb-2 space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
                <StickyNote size={11} aria-hidden="true" />
                Nota interna
                <span className="ml-auto font-normal text-amber-600/70">{formatDate(note.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap break-words text-dark-800">{note.content}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Escreva uma nota interna…"
          aria-label="Nova nota interna"
          className="w-full resize-none rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <Button
          size="sm"
          variant="secondary"
          icon={StickyNote}
          loading={saving}
          disabled={!draft.trim()}
          onClick={handleAdd}
          className="w-full"
        >
          Adicionar nota
        </Button>
      </div>
    </section>
  )
}
