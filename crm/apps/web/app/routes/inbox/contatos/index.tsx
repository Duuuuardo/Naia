import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Building2, Download, MessageCircle, Plus, Search, Send, Upload, Users, X } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { ImportContactsModal } from '../../../components/contatos/import-contacts-modal'
import { Badge, Button, EmptyState, ErrorNote, Modal } from '../../../components/ui'
import { ContactAvatar } from '../../../components/inbox/contact-avatar'
import {
  createContact,
  exportContactsCsv,
  fetchContacts,
  fetchTags,
  getInboxAgent,
  type ContactIdentityInput,
  type ContactListItem,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/contatos/')({
  head: () => createHeadConfig('Contatos — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const [contacts, tags] = await Promise.all([fetchContacts({ data: {} }), fetchTags()])
    return { agent, contacts, tags }
  },
  component: ContactsIndex,
})

type ChannelFilter = '' | 'whatsapp' | 'telegram'

const channelIcon = { whatsapp: MessageCircle, telegram: Send }

function ContactsIndex() {
  const { agent, contacts: initialContacts, tags } = Route.useLoaderData()
  const [contacts, setContacts] = useState<ContactListItem[]>(initialContacts)
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState<ChannelFilter>('')
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  async function load(f: { search: string; channel: ChannelFilter; tag: string }) {
    setLoading(true)
    const rows = await fetchContacts({
      data: {
        search: f.search.trim() || undefined,
        channel: f.channel || undefined,
        tag: f.tag || undefined,
      },
    })
    setContacts(rows)
    setLoading(false)
  }

  // Busca com debounce: espera a digitação parar antes de chamar a API.
  const [debounced, setDebounced] = useState({ search: '', channel: '' as ChannelFilter, tag: '' })
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ search, channel, tag }), 350)
    return () => clearTimeout(timer)
  }, [search, channel, tag])

  // O estado inicial (sem filtros) já veio do loader — só recarrega ao mudar.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    load(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // Exporta o CSV com os filtros ativos e dispara o download no cliente.
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const csv = await exportContactsCsv({
        data: {
          search: debounced.search.trim() || undefined,
          channel: debounced.channel || undefined,
          tag: debounced.tag || undefined,
        },
      })
      if (!csv) return
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'contatos.csv'
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="flex h-full flex-col bg-neutral-0">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <h1 className="font-display text-lg font-bold text-dark-800">Contatos</h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={handleExport}>
              Exportar CSV
            </Button>
            <Button variant="secondary" size="sm" icon={Upload} onClick={() => setImportOpen(true)}>
              Importar CSV
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setModalOpen(true)}>
              Novo contato
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 p-3">
          <div className="relative min-w-48 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, email ou identificador…"
              className="!pl-9"
            />
          </div>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelFilter)}
            className="!w-auto"
            aria-label="Filtrar por canal"
          >
            <option value="">Todos os canais</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
          </select>
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="!w-auto"
            aria-label="Filtrar por tag"
          >
            <option value="">Todas as tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="grid place-items-center py-16 text-neutral-300">
              <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="Nenhum contato encontrado"
                description="Ajuste os filtros ou cadastre um novo contato."
                action={
                  <Button size="sm" icon={Plus} onClick={() => setModalOpen(true)}>
                    Novo contato
                  </Button>
                }
              />
            </div>
          ) : (
            contacts.map((c) => {
              const ChannelIcon = c.primaryChannelType ? channelIcon[c.primaryChannelType] : null
              return (
                <Link
                  key={c.id}
                  to="/inbox/contatos/$contactId"
                  params={{ contactId: c.id }}
                  className="flex items-center gap-3 border-b border-neutral-50 px-4 py-3 transition-colors hover:bg-neutral-50"
                >
                  <ContactAvatar name={c.name} url={c.avatarUrl} size={40} className="text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-dark-800">{c.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-400">
                      {ChannelIcon && c.primaryChannelIdentifier && (
                        <span className="inline-flex items-center gap-1">
                          <ChannelIcon size={11} aria-hidden="true" />
                          {c.primaryChannelIdentifier}
                        </span>
                      )}
                      {c.company && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={11} aria-hidden="true" />
                          {c.company}
                        </span>
                      )}
                      {!ChannelIcon && !c.company && c.email && <span>{c.email}</span>}
                    </div>
                  </div>
                  {c.tags.length > 0 && (
                    <div className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
                      {c.tags.slice(0, 3).map((t) => (
                        <Badge key={t} className="border-neutral-200 bg-neutral-50 text-neutral-500">
                          {t}
                        </Badge>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="text-[10px] font-semibold text-neutral-400">+{c.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </Link>
              )
            })
          )}
        </div>
      </div>

      <NewContactModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => load(debounced)}
      />
      <ImportContactsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => load(debounced)}
      />
    </InboxShell>
  )
}

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function NewContactModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [identities, setIdentities] = useState<ContactIdentityInput[]>([
    { channelType: 'whatsapp', channelIdentifier: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setEmail('')
    setCompany('')
    setTagsInput('')
    setIdentities([{ channelType: 'whatsapp', channelIdentifier: '' }])
    setError(null)
  }

  function updateIdentity(index: number, patch: Partial<ContactIdentityInput>) {
    setIdentities((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await createContact({
        data: {
          name: name.trim(),
          email: email.trim() || undefined,
          company: company.trim() || undefined,
          identities: identities
            .filter((i) => i.channelIdentifier.trim())
            .map((i, index) => ({
              channelType: i.channelType,
              channelIdentifier: i.channelIdentifier.trim(),
              isPrimary: index === 0 ? true : undefined,
            })),
          tags: parseTags(tagsInput),
        },
      })
      reset()
      onClose()
      onCreated()
    } catch {
      setError('Não foi possível criar o contato. Verifique os dados e tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo contato"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} disabled={!name.trim()} onClick={handleSubmit}>
            Criar contato
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div>
          <label htmlFor="nc-name">Nome</label>
          <input
            id="nc-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do contato"
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="nc-email">Email</label>
            <input
              id="nc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com"
            />
          </div>
          <div>
            <label htmlFor="nc-company">Empresa</label>
            <input
              id="nc-company"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Empresa (opcional)"
            />
          </div>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-dark-800">Canais</span>
          <div className="space-y-2">
            {identities.map((identity, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={identity.channelType}
                  onChange={(e) =>
                    updateIdentity(index, { channelType: e.target.value as ContactIdentityInput['channelType'] })
                  }
                  className="!w-32 shrink-0"
                  aria-label="Canal"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                </select>
                <input
                  type="text"
                  value={identity.channelIdentifier}
                  onChange={(e) => updateIdentity(index, { channelIdentifier: e.target.value })}
                  placeholder={identity.channelType === 'whatsapp' ? '+55 11 99999-9999' : '@usuario'}
                />
                <button
                  type="button"
                  onClick={() => setIdentities((prev) => prev.filter((_, i) => i !== index))}
                  disabled={identities.length <= 1}
                  aria-label="Remover canal"
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800 disabled:pointer-events-none disabled:opacity-40"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIdentities((prev) => [...prev, { channelType: 'whatsapp', channelIdentifier: '' }])}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500"
          >
            <Plus size={13} aria-hidden="true" />
            Adicionar canal
          </button>
        </div>

        <div>
          <label htmlFor="nc-tags">Tags</label>
          <input
            id="nc-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="vip, lead-quente (separadas por vírgula)"
          />
        </div>

        {/* Submit via Enter dentro do form */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}
