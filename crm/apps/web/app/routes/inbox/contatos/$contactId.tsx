import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Ban,
  Building2,
  GitMerge,
  KanbanSquare,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Star,
  Trash2,
  Users,
} from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { ContactTagsSection } from '../../../components/contatos/contact-tags-section'
import { BlockContactModal } from '../../../components/inbox/contact-panel'
import { Badge, Button, Card, EmptyState, ErrorNote, Modal, getInitials } from '../../../components/ui'
import { ContactAvatar } from '../../../components/inbox/contact-avatar'
import {
  blockContact,
  fetchContactBlockState,
  unblockContact,
} from '../../../lib/inbox-thread'
import {
  addContactIdentity,
  fetchContact,
  fetchContactHistory,
  fetchContacts,
  getInboxAgent,
  mergeContacts,
  removeContactIdentity,
  updateContact,
  type ContactDealItem,
  type ContactDetail,
  type ContactHistoryEntry,
  type ContactIdentityItem,
  type ContactListItem,
  type ContactTransferItem,
  type JsonValue,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/contatos/$contactId')({
  head: () => createHeadConfig('Contato — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async ({ params }) => {
    const agent = (await getInboxAgent())!
    const [detail, history, blockState] = await Promise.all([
      fetchContact({ data: { contactId: params.contactId } }),
      fetchContactHistory({ data: { contactId: params.contactId } }),
      fetchContactBlockState({ data: { contactId: params.contactId } }),
    ])
    return { agent, ...detail, history, blockState }
  },
  component: ContactDetailView,
})

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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'em andamento'
  const minutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000))
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
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

function transferLabel(t: ContactTransferItem): string {
  const from = t.fromAgent?.name ?? t.fromQueue?.name ?? 'inbox'
  const to = t.toAgent?.name ?? t.toQueue?.name ?? 'inbox'
  return `${from} → ${to}`
}

// Interpreta o valor digitado no editor de campos customizados: boolean e
// número viram tipos nativos do jsonb; o resto fica como texto.
function parseFieldValue(raw: string): JsonValue {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed)
  return raw
}

function fieldValueToString(value: JsonValue): string {
  if (value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

type FieldEntry = { key: string; value: string }

function ContactDetailView() {
  const initial = Route.useLoaderData()
  const { contactId } = Route.useParams()
  const isSuperadmin = initial.agent.role === 'superadmin'
  const isAdmin = initial.agent.role === 'admin' || isSuperadmin

  const [contact, setContact] = useState<ContactDetail | null>(initial.contact)
  const [identities, setIdentities] = useState<ContactIdentityItem[]>(initial.identities)
  const [history, setHistory] = useState<ContactHistoryEntry[]>(initial.history)
  const [blocked, setBlocked] = useState(initial.blockState.blocked)
  const [editOpen, setEditOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockError, setBlockError] = useState<string | null>(null)

  async function reload() {
    const [detail, entries, blockState] = await Promise.all([
      fetchContact({ data: { contactId } }),
      fetchContactHistory({ data: { contactId } }),
      fetchContactBlockState({ data: { contactId } }),
    ])
    setContact(detail.contact)
    setIdentities(detail.identities)
    setHistory(entries)
    setBlocked(blockState.blocked)
  }

  // Reseta o estado local ao navegar para outro contato.
  useEffect(() => {
    setContact(initial.contact)
    setIdentities(initial.identities)
    setHistory(initial.history)
    setBlocked(initial.blockState.blocked)
    setBlockError(null)
  }, [contactId, initial])

  async function handleConfirmBlock() {
    if (blockBusy) return
    setBlockBusy(true)
    setBlockError(null)
    const result = await blockContact({ data: { contactId } })
    setBlockBusy(false)
    if (!result.ok) {
      setBlockError('Não foi possível bloquear o contato. Tente de novo.')
      return
    }
    setBlockModalOpen(false)
    setBlocked(true)
  }

  async function handleUnblock() {
    if (blockBusy) return
    setBlockBusy(true)
    setBlockError(null)
    const result = await unblockContact({ data: { contactId } })
    setBlockBusy(false)
    if (!result.ok) {
      setBlockError('Não foi possível desbloquear o contato. Tente de novo.')
      return
    }
    setBlocked(false)
  }

  if (!contact) {
    return (
      <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
        <div className="grid h-full place-items-center bg-neutral-50 p-6">
          <EmptyState
            icon={Users}
            title="Contato não encontrado"
            description="Ele pode ter sido removido ou mesclado a outro contato."
            action={
              <Link to="/inbox/contatos">
                <Button size="sm" variant="secondary" icon={ArrowLeft}>
                  Voltar para contatos
                </Button>
              </Link>
            }
          />
        </div>
      </InboxShell>
    )
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-0 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/inbox/contatos"
              aria-label="Voltar para a lista de contatos"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
            >
              <ArrowLeft size={16} />
            </Link>
            <ContactAvatar name={contact.name} url={contact.avatarDisplayUrl} size={36} className="text-xs" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-dark-800">{contact.name}</p>
                {blocked && (
                  <Badge className="shrink-0 border-error-500/25 bg-error-500/5 text-error-500">Bloqueado</Badge>
                )}
              </div>
              <p className="truncate text-xs text-neutral-400">
                {[contact.company, contact.email].filter(Boolean).join(' · ') || 'Sem dados de contato'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant={blocked ? 'secondary' : 'danger'}
              size="sm"
              icon={Ban}
              loading={blockBusy && !blockModalOpen}
              onClick={() => (blocked ? handleUnblock() : setBlockModalOpen(true))}
            >
              {blocked ? 'Desbloquear' : 'Bloquear'}
            </Button>
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            {isSuperadmin && (
              <Button variant="secondary" size="sm" icon={GitMerge} onClick={() => setMergeOpen(true)}>
                Mesclar duplicado
              </Button>
            )}
          </div>
        </header>

        {blockError && (
          <div className="border-b border-neutral-200 bg-neutral-0 px-5 py-2">
            <ErrorNote>{blockError}</ErrorNote>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-neutral-50">
          <div className="mx-auto max-w-3xl space-y-4 p-5">
            <DadosSection contact={contact} onEdit={() => setEditOpen(true)} />
            <IdentitiesSection
              contactId={contactId}
              identities={identities}
              isSuperadmin={isSuperadmin}
              onChanged={reload}
            />
            <ContactTagsSection contactId={contactId} contact={contact} isAdmin={isAdmin} onChanged={reload} />
            <CustomFieldsSection contactId={contactId} contact={contact} onSaved={setContact} />
            <DealsSection deals={initial.deals} />
            <HistorySection history={history} />
          </div>
        </div>
      </div>

      <EditContactModal
        open={editOpen}
        contact={contact}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setContact(updated)
          setEditOpen(false)
        }}
      />
      <BlockContactModal
        open={blockModalOpen}
        contactName={contact.name}
        busy={blockBusy}
        onClose={() => setBlockModalOpen(false)}
        onConfirm={handleConfirmBlock}
      />
      {isSuperadmin && (
        <MergeModal
          open={mergeOpen}
          contactId={contactId}
          onClose={() => setMergeOpen(false)}
          onMerged={reload}
        />
      )}
    </InboxShell>
  )
}

// ─── Dados ───────────────────────────────────────────────────────────────────

function DadosSection({ contact, onEdit }: { contact: ContactDetail; onEdit: () => void }) {
  const fields: { label: string; value: string | null }[] = [
    { label: 'Email', value: contact.email },
    { label: 'Empresa', value: contact.company },
    {
      label: 'Nascimento',
      value: contact.birthDate
        ? new Date(contact.birthDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : null,
    },
    { label: 'Avatar', value: contact.avatarUrl },
    { label: 'Cliente desde', value: new Date(contact.firstContactAt).toLocaleDateString('pt-BR') },
  ]
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-800">Dados</h2>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500"
        >
          <Pencil size={12} aria-hidden="true" />
          Editar
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-neutral-400">{f.label}</dt>
            <dd className="truncate text-sm text-dark-800">{f.value ?? '—'}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-xs text-neutral-400">Notas</dt>
          <dd className="whitespace-pre-wrap text-sm text-dark-800">{contact.notes ?? '—'}</dd>
        </div>
      </dl>
    </Card>
  )
}

function EditContactModal({
  open,
  contact,
  onClose,
  onSaved,
}: {
  open: boolean
  contact: ContactDetail
  onClose: () => void
  onSaved: (contact: ContactDetail) => void
}) {
  const [name, setName] = useState(contact.name)
  const [email, setEmail] = useState(contact.email ?? '')
  const [company, setCompany] = useState(contact.company ?? '')
  const [birthDate, setBirthDate] = useState(contact.birthDate?.slice(0, 10) ?? '')
  const [avatarUrl, setAvatarUrl] = useState(contact.avatarUrl ?? '')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recarrega os campos sempre que o modal abre para outro contato/estado.
  useEffect(() => {
    if (!open) return
    setName(contact.name)
    setEmail(contact.email ?? '')
    setCompany(contact.company ?? '')
    setBirthDate(contact.birthDate?.slice(0, 10) ?? '')
    setAvatarUrl(contact.avatarUrl ?? '')
    setNotes(contact.notes ?? '')
    setError(null)
  }, [open, contact])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateContact({
        data: {
          contactId: contact.id,
          name: name.trim(),
          email: email.trim() || null,
          company: company.trim() || null,
          birthDate: birthDate || null,
          avatarUrl: avatarUrl.trim() || null,
          notes: notes.trim() || null,
        },
      })
      if (updated) onSaved(updated)
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar contato"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} disabled={!name.trim()} onClick={handleSubmit}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <label htmlFor="ec-name">Nome</label>
          <input id="ec-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ec-email">Email</label>
            <input id="ec-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ec-company">Empresa</label>
            <input id="ec-company" type="text" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ec-birth">Nascimento</label>
            <input
              id="ec-birth"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-shadow focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="ec-avatar">URL do avatar</label>
            <input
              id="ec-avatar"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
        <div>
          <label htmlFor="ec-notes">Notas</label>
          <textarea
            id="ec-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Observações internas sobre o contato"
          />
        </div>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}

// ─── Identidades ─────────────────────────────────────────────────────────────

function IdentitiesSection({
  contactId,
  identities,
  isSuperadmin,
  onChanged,
}: {
  contactId: string
  identities: ContactIdentityItem[]
  isSuperadmin: boolean
  onChanged: () => Promise<void>
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleRemove(identity: ContactIdentityItem) {
    if (identities.length <= 1 || busy) return
    setBusy(true)
    await removeContactIdentity({ data: { contactId, identityId: identity.id } })
    await onChanged()
    setBusy(false)
  }

  // A API não expõe endpoint de "tornar principal": removemos a identity e a
  // recriamos com isPrimary — o backend desmarca as demais.
  async function handleMakePrimary(identity: ContactIdentityItem) {
    if (identity.isPrimary || busy) return
    setBusy(true)
    await removeContactIdentity({ data: { contactId, identityId: identity.id } })
    await addContactIdentity({
      data: {
        contactId,
        channelType: identity.channelType,
        channelIdentifier: identity.channelIdentifier,
        isPrimary: true,
      },
    })
    await onChanged()
    setBusy(false)
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-800">Identidades por plataforma</h2>
        {isSuperadmin && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500"
          >
            <Plus size={12} aria-hidden="true" />
            Adicionar
          </button>
        )}
      </div>
      {identities.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum canal vinculado a este contato.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {identities.map((identity) => {
            const ChannelIcon = channelIcon[identity.channelType]
            return (
              <li key={identity.id} className="flex items-center gap-3 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-500">
                  <ChannelIcon size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-dark-800">{identity.channelIdentifier}</p>
                  <p className="text-xs capitalize text-neutral-400">{identity.channelType}</p>
                </div>
                {identity.isPrimary && (
                  <Badge className="border-brand-200 bg-brand-50 text-brand-600">Principal</Badge>
                )}
                {isSuperadmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    {!identity.isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleMakePrimary(identity)}
                        disabled={busy}
                        title="Tornar principal"
                        aria-label="Tornar principal"
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Star size={14} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemove(identity)}
                      disabled={busy || identities.length <= 1}
                      title={identities.length <= 1 ? 'O contato precisa manter ao menos uma identidade' : 'Remover'}
                      aria-label="Remover identidade"
                      className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-error-500 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <AddIdentityModal
        open={addOpen}
        contactId={contactId}
        onClose={() => setAddOpen(false)}
        onAdded={async () => {
          setAddOpen(false)
          await onChanged()
        }}
      />
    </Card>
  )
}

function AddIdentityModal({
  open,
  contactId,
  onClose,
  onAdded,
}: {
  open: boolean
  contactId: string
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [channelType, setChannelType] = useState<'whatsapp' | 'telegram'>('whatsapp')
  const [identifier, setIdentifier] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!identifier.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await addContactIdentity({
        data: { contactId, channelType, channelIdentifier: identifier.trim(), isPrimary: isPrimary || undefined },
      })
      setIdentifier('')
      setIsPrimary(false)
      await onAdded()
    } catch {
      setError('Não foi possível adicionar. O identificador pode já estar em uso.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar identidade"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} disabled={!identifier.trim()} onClick={handleSubmit}>
            Adicionar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ai-channel">Canal</label>
            <select
              id="ai-channel"
              value={channelType}
              onChange={(e) => setChannelType(e.target.value as 'whatsapp' | 'telegram')}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>
          <div>
            <label htmlFor="ai-identifier">Identificador</label>
            <input
              id="ai-identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={channelType === 'whatsapp' ? '+55 11 99999-9999' : '@usuario'}
              required
            />
          </div>
        </div>
        <label className="!mb-0 flex items-center gap-2 text-sm font-normal text-dark-800">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="size-4 accent-brand-500"
          />
          Definir como identidade principal
        </label>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}

// ─── Campos customizados ─────────────────────────────────────────────────────

function CustomFieldsSection({
  contactId,
  contact,
  onSaved,
}: {
  contactId: string
  contact: ContactDetail
  onSaved: (contact: ContactDetail) => void
}) {
  const [entries, setEntries] = useState<FieldEntry[]>(() =>
    Object.entries(contact.customFields).map(([key, value]) => ({ key, value: fieldValueToString(value) })),
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEntries(Object.entries(contact.customFields).map(([key, value]) => ({ key, value: fieldValueToString(value) })))
  }, [contact.customFields])

  function buildRecord(): Record<string, JsonValue> {
    const record: Record<string, JsonValue> = {}
    for (const entry of entries) {
      const key = entry.key.trim()
      if (key) record[key] = parseFieldValue(entry.value)
    }
    return record
  }

  const dirty = JSON.stringify(buildRecord()) !== JSON.stringify(contact.customFields)

  function updateEntry(index: number, patch: Partial<FieldEntry>) {
    setEntries((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function handleSave() {
    setSaving(true)
    const updated = await updateContact({ data: { contactId, customFields: buildRecord() } })
    if (updated) onSaved(updated)
    setSaving(false)
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-800">Campos customizados</h2>
        {dirty && (
          <Button size="sm" icon={Save} loading={saving} onClick={handleSave}>
            Salvar
          </Button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum campo customizado.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={entry.key}
                onChange={(e) => updateEntry(index, { key: e.target.value })}
                placeholder="campo"
                className="!h-9 flex-1"
                aria-label="Nome do campo"
              />
              <input
                type="text"
                value={entry.value}
                onChange={(e) => updateEntry(index, { value: e.target.value })}
                placeholder="valor"
                className="!h-9 flex-[2]"
                aria-label="Valor do campo"
              />
              <button
                type="button"
                onClick={() => setEntries((prev) => prev.filter((_, i) => i !== index))}
                aria-label="Remover campo"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-error-500"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setEntries((prev) => [...prev, { key: '', value: '' }])}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500"
      >
        <Plus size={13} aria-hidden="true" />
        Adicionar campo
      </button>
    </Card>
  )
}

// ─── Deals ───────────────────────────────────────────────────────────────────

function DealsSection({ deals }: { deals: ContactDealItem[] }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-dark-800">Deals vinculados</h2>
      {deals.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum deal vinculado a este contato.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {deals.map((deal) => {
            const meta = dealStatusMeta[deal.status] ?? dealStatusMeta.open
            return (
              <li key={deal.id}>
                <Link
                  to={'/inbox/funis' as never}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-neutral-50"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-500">
                    <KanbanSquare size={14} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-dark-800">{deal.title}</p>
                    <p className="truncate text-xs text-neutral-400">
                      {deal.pipelineName} · {deal.stageName}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-dark-800">{formatDealValue(deal)}</span>
                  <Badge className={`shrink-0 ${meta.className}`}>{meta.label}</Badge>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ─── Histórico de atendimentos ───────────────────────────────────────────────

function HistorySection({ history }: { history: ContactHistoryEntry[] }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-dark-800">Histórico de atendimentos</h2>
      {history.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum atendimento registrado.</p>
      ) : (
        <ol className="relative ml-2 space-y-4 border-l border-neutral-200 pl-5">
          {history.map((entry) => {
            const ChannelIcon = channelIcon[entry.connection.kind as 'whatsapp' | 'telegram'] ?? MessageCircle
            const meta = conversationStatusMeta[entry.status] ?? conversationStatusMeta.open
            return (
              <li key={`${entry.id}:${entry.atendimentoSeq}`} className="relative">
                <span className="absolute -left-[26.5px] top-2.5 grid size-3 place-items-center rounded-full border-2 border-neutral-0 bg-neutral-300" />
                <Link
                  to="/inbox/atendimento/c/$conversationId"
                  params={{ conversationId: entry.id }}
                  search={{ atendimento: entry.atendimentoSeq }}
                  className="block rounded-lg border border-neutral-100 bg-neutral-0 p-3 transition-colors hover:border-neutral-200 hover:bg-neutral-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ChannelIcon size={13} className="shrink-0 text-neutral-400" aria-hidden="true" />
                    <span className="text-xs font-semibold text-dark-800">Atendimento #{entry.atendimentoSeq}</span>
                    <span className="text-xs text-neutral-400">{entry.connection.name}</span>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="ml-auto text-xs text-neutral-400">
                      {entry.messageCount} {entry.messageCount === 1 ? 'mensagem' : 'mensagens'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-500">
                    {formatDateTime(entry.createdAt)}
                    {' → '}
                    {entry.resolvedAt ? formatDateTime(entry.resolvedAt) : 'em andamento'}
                    {' · '}
                    {formatDuration(entry.createdAt, entry.resolvedAt)}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {entry.assignedAgent?.name
                      ? `Agente: ${entry.assignedAgent.name}`
                      : entry.queue?.name
                        ? `Fila: ${entry.queue.name}`
                        : 'Sem atribuição'}
                    {entry.transfers.length > 0 &&
                      ` · ${entry.transfers.length} ${entry.transfers.length === 1 ? 'transferência' : 'transferências'} (${transferLabel(entry.transfers[0])}${
                        entry.transfers.length > 1 ? `, +${entry.transfers.length - 1}` : ''
                      })`}
                  </p>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

// ─── Mesclar duplicado (superadmin) ──────────────────────────────────────────

function MergeModal({
  open,
  contactId,
  onClose,
  onMerged,
}: {
  open: boolean
  contactId: string
  onClose: () => void
  onMerged: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContactListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [merging, setMerging] = useState(false)
  const [outcome, setOutcome] = useState<{ moved: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setOutcome(null)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open || outcome) return
    const timer = setTimeout(async () => {
      setSearching(true)
      const rows = await fetchContacts({ data: { search: query.trim() || undefined } })
      setResults(rows.filter((c) => c.id !== contactId))
      setSearching(false)
    }, 350)
    return () => clearTimeout(timer)
  }, [query, open, contactId, outcome])

  async function handleMerge(otherContactId: string) {
    if (merging) return
    setMerging(true)
    setError(null)
    try {
      const res = await mergeContacts({ data: { contactId, otherContactId } })
      setOutcome({ moved: res.movedIdentities, skipped: res.skippedIdentities })
      await onMerged()
    } catch {
      setError('Não foi possível mesclar os contatos. Tente de novo.')
    } finally {
      setMerging(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mesclar contato duplicado"
      footer={
        outcome ? (
          <Button
            size="sm"
            onClick={() => {
              setOutcome(null)
              onClose()
            }}
          >
            Concluir
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        )
      }
    >
      {outcome ? (
        <div className="space-y-2 text-sm text-dark-800">
          <p className="font-medium">Mesclagem concluída.</p>
          <p className="text-neutral-500">
            {outcome.moved} {outcome.moved === 1 ? 'identidade movida' : 'identidades movidas'} para este contato
            {outcome.skipped > 0 &&
              ` · ${outcome.skipped} ${outcome.skipped === 1 ? 'ignorada' : 'ignoradas'} (já existiam aqui)`}
            .
          </p>
          <p className="text-xs text-neutral-400">O contato duplicado foi removido e os dados foram consolidados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {error && <ErrorNote>{error}</ErrorNote>}
          <p className="text-sm text-neutral-500">
            Busque o contato duplicado. As identidades dele serão movidas para este contato e o registro será
            removido.
          </p>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar contato duplicado…"
              className="!pl-9"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-100">
            {searching ? (
              <div className="grid place-items-center py-8 text-neutral-300">
                <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              </div>
            ) : results.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">Nenhum outro contato encontrado.</p>
            ) : (
              results.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 border-b border-neutral-50 px-3 py-2.5 last:border-b-0"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-[10px] font-bold text-dark-800">
                    {getInitials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-dark-800">{c.name}</p>
                    <p className="truncate text-xs text-neutral-400">
                      {[c.primaryChannelIdentifier, c.company].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={GitMerge}
                    loading={merging}
                    onClick={() => handleMerge(c.id)}
                  >
                    Mesclar
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
