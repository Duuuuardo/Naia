import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  FileUp,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserRoundPlus,
  Search,
  MessageCircle,
  Send,
  X,
  Tag,
  Copy,
  Check,
  Pencil,
  ChevronDown,
  Users,
  Loader2,
  Building2,
  Calendar,
  Mail,
  FileText,
  Plus,
  AlertTriangle,
  MoreHorizontal,
} from 'lucide-react'

import {
  fetchContacts,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  fetchContactTags,
  createContactTag,
  updateContactTag,
  deleteContactTag,
  syncContactGroupMembers,
} from '../../../lib/actions'
import { Button } from '../../../components/ui'
import { createHeadConfig } from '../../lib/seo'


export const Route = createFileRoute('/_app/$workspaceId/contacts')({ head: () => createHeadConfig('Contatos — Naia Campanhas'),
  loader: ({ params }) => fetchContacts({ data: { workspaceId: params.workspaceId } }),
  component: ContactsPage,
})

type ContactRow = {
  id: string
  workspaceId: string
  name: string
  telegramChatId: string | null
  whatsappPhone: string | null
  email?: string | null
  birthDate?: string | null
  company?: string | null
  notes?: string | null
  tags: string[]
  customFields: string
  avatarUrl?: string | null
  optInStatus: boolean
  isGroup?: boolean | null
  optInAt: string | null
  createdAt: string
  updatedAt: string
}



function ContactsPage() {
  const { contacts: rawContacts, total } = Route.useLoaderData()
  const contacts = rawContacts as ContactRow[]
  const { workspaceId } = Route.useParams()
  const router = useRouter()

  // Modals & UI State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [editContact, setEditContact] = useState<ContactRow | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [syncingGroupId, setSyncingGroupId] = useState<string | null>(null)
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string; isGroup?: boolean | null } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [openActionsMenuId, setOpenActionsMenuId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  const [menuContact, setMenuContact] = useState<ContactRow | null>(null)
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({})

  const openActionsMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, contact: ContactRow) => {
    if (openActionsMenuId === contact.id) {
      setOpenActionsMenuId(null)
      setMenuAnchor(null)
      setMenuContact(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    setMenuContact(contact)
    setOpenActionsMenuId(contact.id)
  }, [openActionsMenuId])

  const closeActionsMenu = useCallback(() => {
    setOpenActionsMenuId(null)
    setMenuAnchor(null)
    setMenuContact(null)
  }, [])

  useEffect(() => {
    if (!openActionsMenuId) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-actions-menu]') && !target.closest('[data-actions-trigger]')) {
        closeActionsMenu()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeActionsMenu()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [openActionsMenuId, closeActionsMenu])

  // Filters
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | 'whatsapp' | 'telegram'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'optout'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'contacts' | 'groups'>('all')


  // Create Form State (One contact = One platform)
  const [createPlatform, setCreatePlatform] = useState<'whatsapp' | 'telegram'>('whatsapp')
  const [createName, setCreateName] = useState('')
  const [createIdentifier, setCreateIdentifier] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createBirthDate, setCreateBirthDate] = useState('')
  const [createCompany, setCreateCompany] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createTags, setCreateTags] = useState('')
  const [createOptIn, setCreateOptIn] = useState(true)

  // Edit Form State
  const [editPlatform, setEditPlatform] = useState<'whatsapp' | 'telegram'>('whatsapp')
  const [editName, setEditName] = useState('')
  const [editIdentifier, setEditIdentifier] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editBirthDate, setEditBirthDate] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editOptIn, setEditOptIn] = useState(true)

  // Import State
  const [csv, setCsv] = useState('')

  // Tag Management System State
  const [showTagsModal, setShowTagsModal] = useState(false)
  const [workspaceTagsList, setWorkspaceTagsList] = useState<Array<{ id: string; name: string; color: string; description: string | null; isCustom: boolean }>>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3b82f6')
  const [newTagDesc, setNewTagDesc] = useState('')
  const [tagSubmitting, setTagSubmitting] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagColor, setEditTagColor] = useState('#3b82f6')
  const [editTagDesc, setEditTagDesc] = useState('')

  async function loadTags() {
    if (!workspaceId) return
    setLoadingTags(true)
    try {
      const res = await fetchContactTags({ data: { workspaceId } })
      if (res && 'items' in res && Array.isArray(res.items)) {
        setWorkspaceTagsList(res.items)
      } else if (res && 'tags' in res && Array.isArray(res.tags)) {
        setWorkspaceTagsList(res.tags.map((t: string) => ({ id: `tag_${t}`, name: t, color: '#3b82f6', description: null, isCustom: false })))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingTags(false)
    }
  }

  useEffect(() => {
    loadTags()
  }, [workspaceId])

  const tagColorMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of workspaceTagsList) {
      map.set(t.name, t.color || '#3b82f6')
    }
    return map
  }, [workspaceTagsList])


  async function refresh() {
    await router.invalidate()
  }

  function handleCopy(text: string, idKey: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(idKey)
    setTimeout(() => setCopiedId(null), 1800)
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!createIdentifier.trim()) return
    setSaving(true)

    const tagsArray = createTags
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter((t) => t.length > 0)

    const result = await createContact({
      data: {
        workspaceId,
        name: createName.trim(),
        whatsappPhone: createPlatform === 'whatsapp' ? createIdentifier.trim() : null,
        telegramChatId: createPlatform === 'telegram' ? createIdentifier.trim() : null,
        email: createEmail.trim() || null,
        birthDate: createBirthDate.trim() || null,
        company: createCompany.trim() || null,
        notes: createNotes.trim() || null,
        tags: tagsArray,
        optInStatus: createOptIn,
      },
    })

    setSaving(false)
    if ('error' in result) {
      setMessage(result.error ?? 'Erro ao cadastrar contato.')
      return
    }

    setCreateName('')
    setCreateIdentifier('')
    setCreateEmail('')
    setCreateBirthDate('')
    setCreateCompany('')
    setCreateNotes('')
    setCreateTags('')
    setCreateOptIn(true)
    setShowCreateModal(false)
    setMessage('Contato cadastrado com sucesso.')
    await refresh()
  }


  function openEdit(c: ContactRow) {
    setEditContact(c)
    if (c.telegramChatId) {
      setEditPlatform('telegram')
      setEditIdentifier(c.telegramChatId)
    } else {
      setEditPlatform('whatsapp')
      setEditIdentifier(c.whatsappPhone || '')
    }
    setEditName(c.name)
    setEditEmail(c.email || '')
    setEditBirthDate(c.birthDate || '')
    setEditCompany(c.company || '')
    setEditNotes(c.notes || '')
    setEditTags((c.tags || []).join(', '))
    setEditOptIn(c.optInStatus)
  }


  async function handleUpdateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editContact || !editIdentifier.trim()) return
    setSaving(true)

    const tagsArray = editTags
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter((t) => t.length > 0)

    const result = await updateContact({
      data: {
        workspaceId,
        contactId: editContact.id,
        name: editName.trim(),
        whatsappPhone: editPlatform === 'whatsapp' ? editIdentifier.trim() : null,
        telegramChatId: editPlatform === 'telegram' ? editIdentifier.trim() : null,
        email: editEmail.trim() || null,
        birthDate: editBirthDate.trim() || null,
        company: editCompany.trim() || null,
        notes: editNotes.trim() || null,
        tags: tagsArray,
        optInStatus: editOptIn,
      },
    })


    setSaving(false)
    if (result && 'error' in result) {
      setMessage(result.error ?? 'Erro ao atualizar contato.')
      return
    }

    setEditContact(null)
    setMessage('Contato atualizado com sucesso.')
    await refresh()
  }

  function confirmDelete(c: ContactRow) {
    setContactToDelete({ id: c.id, name: c.name, isGroup: Boolean(c.isGroup) })
  }

  async function handleDeleteConfirm() {
    if (!contactToDelete) return
    setDeleting(true)
    const res = await deleteContact({ data: { workspaceId, contactId: contactToDelete.id } })
    setDeleting(false)
    if (res && 'error' in res && res.error) {
      setMessage(res.error)
      setContactToDelete(null)
      return
    }
    setMessage(contactToDelete.isGroup ? 'Grupo apagado com sucesso.' : 'Contato apagado com sucesso.')
    setContactToDelete(null)
    await refresh()
  }

  async function handleSyncGroupMembers(c: ContactRow) {
    setSyncingGroupId(c.id)
    setMessage(`Sincronizando membros do grupo "${c.name}"...`)
    const res = await syncContactGroupMembers({ data: { workspaceId, contactId: c.id } })
    setSyncingGroupId(null)
    if (res && 'error' in res && res.error) {
      setMessage(res.error)
      return
    }
    if (res && 'message' in res && res.message) {
      setMessage(res.message)
    } else {
      setMessage(`Membros do grupo "${c.name}" sincronizados com sucesso.`)
    }
    await refresh()
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!csv.trim()) return
    setSaving(true)
    const result = await importContacts({ data: { workspaceId, csv } })
    setSaving(false)
    if (result && 'error' in result) {
      setMessage(result.error ?? 'Erro ao importar contatos.')
      return
    }
    if (!result || !('imported' in result)) {
      setMessage(result && 'message' in result ? result.message : 'Erro ao importar contatos.')
      return
    }
    setMessage(`Importação concluída: ${result.imported ?? 0} criados · ${result.skipped ?? 0} ignorados · ${result.failed ?? 0} falhas`)
    setCsv('')
    setShowImportModal(false)
    await refresh()
  }

  // Pre-calculate clean stats
  const stats = useMemo(() => {
    let whatsappCount = 0
    let telegramCount = 0
    let activeCount = 0
    let groupsCount = 0

    for (const c of contacts) {
      if (c.whatsappPhone) whatsappCount++
      if (c.telegramChatId) telegramCount++
      if (c.optInStatus) activeCount++
      if (c.isGroup) groupsCount++
    }
    return { whatsappCount, telegramCount, activeCount, groupsCount }
  }, [contacts])

  // Filtered contacts list
  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.whatsappPhone && c.whatsappPhone.includes(search)) ||
        (c.telegramChatId && c.telegramChatId.includes(search)) ||
        c.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      if (!matchesSearch) return false

      if (platformFilter === 'whatsapp' && !c.whatsappPhone) return false
      if (platformFilter === 'telegram' && !c.telegramChatId) return false

      if (statusFilter === 'active' && !c.optInStatus) return false
      if (statusFilter === 'optout' && c.optInStatus) return false

      if (typeFilter === 'contacts' && c.isGroup) return false
      if (typeFilter === 'groups' && !c.isGroup) return false

      return true
    })
  }, [contacts, search, platformFilter, statusFilter, typeFilter])


  return (
    <>
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-dark-800 tracking-tight">
            Contatos
          </h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-xl">
            Gerencie sua base de clientes e leads segmentados por plataforma para envio de campanhas e automações.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap w-full md:w-auto">
          <Button className="flex-1 md:flex-none" variant="secondary" icon={Tag} onClick={() => { setShowTagsModal(true); loadTags() }}>
            Gerenciar Tags
          </Button>
          <Button className="flex-1 md:flex-none" variant="secondary" icon={FileUp} onClick={() => { setShowImportModal(true); setShowCreateModal(false) }}>
            Importar CSV
          </Button>
          <Button className="flex-1 md:flex-none" icon={UserRoundPlus} onClick={() => { setShowCreateModal(true); setShowImportModal(false) }}>
            + Novo Contato
          </Button>
        </div>
      </div>


      <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50/60 text-xs font-semibold text-neutral-600">
        <div className="flex items-center gap-1.5 pr-3 border-r border-neutral-200">
          <span className="text-neutral-400 font-medium">Total de Contatos:</span>
          <span className="font-mono text-dark-800 font-bold">{total}</span>
        </div>
        <div className="flex items-center gap-1.5 pr-3 border-r border-neutral-200">
          <MessageCircle size={14} className="text-emerald-600" />
          <span className="text-neutral-400 font-medium">WhatsApp:</span>
          <span className="font-mono text-dark-800 font-bold">{stats.whatsappCount}</span>
        </div>
        <div className="flex items-center gap-1.5 pr-3 border-r border-neutral-200">
          <Send size={14} className="text-blue-500" />
          <span className="text-neutral-400 font-medium">Telegram:</span>
          <span className="font-mono text-dark-800 font-bold">{stats.telegramCount}</span>
        </div>
        <div className="flex items-center gap-1.5 pr-3 border-r border-neutral-200">
          <Users size={14} className="text-purple-600" />
          <span className="text-neutral-400 font-medium">Grupos/Comunidades:</span>
          <span className="font-mono text-dark-800 font-bold">{stats.groupsCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success-500" />
          <span className="text-neutral-400 font-medium">Ativos (Opt-in):</span>
          <span className="font-mono text-dark-800 font-bold">{stats.activeCount}</span>
        </div>
      </div>


      {/* Feedback Banner */}
      {message && (
        <div className="rounded-xl bg-neutral-900 text-white px-4 py-3 text-xs font-semibold flex items-center justify-between shadow-md animate-in">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-neutral-400 hover:text-white">
            Fechar
          </button>
        </div>
      )}

      {/* Toolbar Card with Custom Dropdowns */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-neutral-200 shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato por nome, telefone, chat ID ou tag..."
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-neutral-200 bg-neutral-50/50 text-xs font-medium placeholder:text-neutral-400 focus:border-dark-800 focus:outline-none focus:bg-white transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0 justify-end">
          <TypeDropdown value={typeFilter} onChange={setTypeFilter} />
          <PlatformDropdown value={platformFilter} onChange={setPlatformFilter} />
          <StatusDropdown value={statusFilter} onChange={setStatusFilter} />
        </div>
      </div>


      <div className="rounded-2xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <p className="text-sm font-bold text-dark-800">Nenhum contato encontrado</p>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto">
              Sua busca ou filtro não retornou clientes. Cadastre um novo contato na plataforma desejada para iniciar envios.
            </p>
            <div className="pt-2">
              <Button icon={UserRoundPlus} onClick={() => setShowCreateModal(true)}>
                + Novo Contato
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5 [scrollbar-width:thin]">
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200/80 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">Nome do Contato</th>
                  <th className="py-3.5 px-4">Plataforma</th>
                  <th className="py-3.5 px-4">Identificador</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-700 font-medium">
                {filtered.map((c) => {
                  const isWa = !!c.whatsappPhone
                  const platformLabel = isWa ? 'WhatsApp' : 'Telegram'
                  const identifier = isWa ? c.whatsappPhone! : c.telegramChatId!
                  const isCopied = copiedId === `${c.id}:${identifier}`

                  return (
                    <tr key={c.id} className="hover:bg-neutral-50/80 transition-colors group">
                      <td className="py-4 pl-6 pr-4">
                        <div className="flex items-center gap-3">
                          <div className={`grid size-9 place-items-center rounded-xl font-display font-bold text-xs shrink-0 overflow-hidden ${
                            c.isGroup ? 'bg-purple-100 text-purple-700' : 'bg-neutral-900 text-white'
                          }`}>
                            {c.avatarUrl && !imgErrors[c.id] ? (
                              <img
                                src={c.avatarUrl}
                                alt={c.name}
                                referrerPolicy="no-referrer"
                                className="size-full object-cover"
                                onError={() => setImgErrors(prev => ({ ...prev, [c.id]: true }))}
                              />
                            ) : c.isGroup ? <Users size={16} /> : c.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-dark-800 block text-sm leading-snug">
                                {c.name}
                              </span>
                              {c.isGroup && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                  <Users size={11} /> Grupo
                                </span>
                              )}
                            </div>
                            {(c.birthDate || c.company || c.email) && (
                              <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-neutral-500 font-normal">
                                {c.birthDate && <span title="Data de Aniversário" className="flex items-center gap-1 font-semibold text-pink-700 bg-pink-50 px-1.5 py-0.5 rounded border border-pink-100">🎂 {c.birthDate}</span>}
                                {c.company && <span title="Empresa/Organização" className="flex items-center gap-1 font-medium text-dark-800">🏢 {c.company}</span>}
                                {c.email && <span title="E-mail" className="flex items-center gap-1 font-mono text-neutral-600">✉️ {c.email}</span>}
                              </div>
                            )}
                            {c.tags && c.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {c.tags.map((t) => {
                                  const colorHex = tagColorMap.get(t) || '#3b82f6'
                                  return (
                                    <span
                                      key={t}
                                      style={{ backgroundColor: `${colorHex}15`, color: colorHex, borderColor: `${colorHex}40` }}
                                      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold border"
                                    >
                                      #{t}
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </div>


                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            isWa
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80'
                              : 'bg-blue-50 text-blue-800 border-blue-200/80'
                          }`}
                        >
                          {isWa ? <MessageCircle size={14} className="text-emerald-600" /> : <Send size={14} className="text-blue-500" />}
                          <span>{platformLabel}</span>
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        {c.isGroup ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-50/90 border border-purple-200/80 text-purple-700 text-xs font-semibold">
                            <Users size={12} className="text-purple-500 shrink-0" />
                            Grupo
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 font-mono text-xs text-dark-800">
                            <span>{isWa ? `+${identifier}` : identifier}</span>
                            <button
                              onClick={() => handleCopy(identifier, `${c.id}:${identifier}`)}
                              title="Copiar identificador"
                              className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-dark-800 transition-opacity p-1"
                            >
                              {isCopied ? <Check size={13} className="text-success-600" /> : <Copy size={13} />}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {c.optInStatus ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-success-600">
                            <span className="size-2 rounded-full bg-success-500" />
                            <span>Ativo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-400">
                            <span className="size-2 rounded-full bg-neutral-300" />
                            <span>Descadastrado</span>
                          </span>
                        )}
                      </td>
                      <td className="py-4 pl-4 pr-6 text-right whitespace-nowrap">
                        <button
                          type="button"
                          data-actions-trigger
                          onClick={(e) => openActionsMenu(e, c)}
                          className="inline-flex items-center justify-center size-8 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-dark-800 transition-colors"
                          title="Ações"
                        >
                          {syncingGroupId === c.id
                            ? <Loader2 size={15} className="animate-spin text-purple-500" />
                            : <MoreHorizontal size={15} />}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Cadastrar Contato (1 Contato = 1 Plataforma) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/60 backdrop-blur-2xs p-4 animate-in">
          <div className="w-full max-w-md rounded-2xl bg-white border border-neutral-200 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 p-6 pb-4 shrink-0 bg-white">
              <h3 className="font-display text-base font-bold text-dark-800">
                Cadastrar Contato
              </h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-neutral-400 hover:text-dark-800">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
              {/* Platform Selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
                  Selecione a Plataforma *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCreatePlatform('whatsapp')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                      createPlatform === 'whatsapp'
                        ? 'border-emerald-600 bg-emerald-50/80 text-emerald-900 ring-2 ring-emerald-600/20'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <MessageCircle size={16} className="text-emerald-600" />
                    <span>WhatsApp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatePlatform('telegram')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                      createPlatform === 'telegram'
                        ? 'border-blue-500 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/20'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <Send size={16} className="text-blue-500" />
                    <span>Telegram</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                  Nome do Contato *
                </label>
                <input
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Ex: Carlos Oliveira"
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-medium focus:border-dark-800 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                  {createPlatform === 'whatsapp' ? 'Número de WhatsApp (DDI + DDD) *' : 'ID do Chat do Telegram *'}
                </label>
                <input
                  required
                  value={createIdentifier}
                  onChange={(e) => setCreateIdentifier(e.target.value)}
                  placeholder={createPlatform === 'whatsapp' ? 'Ex: 5511999999999' : 'Ex: 123456789'}
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-mono focus:border-dark-800 outline-none transition-all"
                />
                <span className="text-[11px] text-neutral-400 mt-1 block">
                  {createPlatform === 'whatsapp'
                    ? 'Insira apenas números com o código de país (55 para Brasil).'
                    : 'Insira o ID numérico do chat ou usuário no Telegram.'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <Mail size={13} className="text-neutral-400" />
                    E-mail do Contato
                  </label>
                  <input
                    type="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    placeholder="Ex: carlos@empresa.com"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <Calendar size={13} className="text-neutral-400" />
                    Data de Aniversário
                  </label>
                  <input
                    type="text"
                    value={createBirthDate}
                    onChange={(e) => setCreateBirthDate(e.target.value)}
                    placeholder="Ex: 15/08 ou 1990-08-15"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <Building2 size={13} className="text-neutral-400" />
                    Empresa / Organização
                  </label>
                  <input
                    type="text"
                    value={createCompany}
                    onChange={(e) => setCreateCompany(e.target.value)}
                    placeholder="Ex: Naia Tech"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <FileText size={13} className="text-neutral-400" />
                    Observações / Notas
                  </label>
                  <input
                    type="text"
                    value={createNotes}
                    onChange={(e) => setCreateNotes(e.target.value)}
                    placeholder="Ex: Cliente VIP, prefere manhã"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Tags (opcional, separadas por vírgula)
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowTagsModal(true); loadTags() }}
                    className="text-[11px] font-bold text-brand-600 hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Gerenciar Tags
                  </button>
                </div>
                <input
                  value={createTags}
                  onChange={(e) => setCreateTags(e.target.value)}
                  placeholder="Ex: vip, lead-quente, cliente"
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-medium focus:border-dark-800 outline-none transition-all"
                />
                {workspaceTagsList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {workspaceTagsList.map((t) => {
                      const currentTags = createTags.split(',').map((x) => x.trim()).filter(Boolean)
                      const isSelected = currentTags.includes(t.name)
                      const colorHex = t.color || '#3b82f6'
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setCreateTags(currentTags.filter((x) => x !== t.name).join(', '))
                            } else {
                              setCreateTags([...currentTags, t.name].join(', '))
                            }
                          }}
                          style={{
                            backgroundColor: isSelected ? colorHex : `${colorHex}15`,
                            color: isSelected ? '#ffffff' : colorHex,
                            borderColor: isSelected ? colorHex : `${colorHex}40`,
                          }}
                          className="px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all flex items-center gap-1"
                        >
                          #{t.name}
                          {isSelected && <Check size={11} />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>


              <div className="pt-1">
                <label className="flex items-start gap-3 text-xs text-neutral-600 bg-neutral-50 p-3 rounded-xl border border-neutral-200/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createOptIn}
                    onChange={(e) => setCreateOptIn(e.target.checked)}
                    className="size-4 rounded mt-0.5 accent-dark-800 shrink-0"
                  />
                  <div>
                    <span className="font-bold text-dark-800 block">Ativo para envio (Opt-in)</span>
                    <span>O contato está apto a receber mensagens automatizadas.</span>
                  </div>
                </label>
              </div>

              </div>

              <div className="flex justify-end gap-2 p-4 border-t border-neutral-100 bg-neutral-50/50 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
                >
                  Cancelar
                </button>
                <Button type="submit" loading={saving}>
                  Salvar Contato
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Contato */}
      {editContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/60 backdrop-blur-2xs p-4 animate-in">
          <div className="w-full max-w-md rounded-2xl bg-white border border-neutral-200 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 p-6 pb-4 shrink-0 bg-white">
              <h3 className="font-display text-base font-bold text-dark-800">
                Editar Contato
              </h3>
              <button type="button" onClick={() => setEditContact(null)} className="text-neutral-400 hover:text-dark-800">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
                  Plataforma do Contato
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEditPlatform('whatsapp')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                      editPlatform === 'whatsapp'
                        ? 'border-emerald-600 bg-emerald-50/80 text-emerald-900 ring-2 ring-emerald-600/20'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <MessageCircle size={16} className="text-emerald-600" />
                    <span>WhatsApp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditPlatform('telegram')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                      editPlatform === 'telegram'
                        ? 'border-blue-500 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/20'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <Send size={16} className="text-blue-500" />
                    <span>Telegram</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                  Nome do Contato *
                </label>
                <input
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Ex: Carlos Oliveira"
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-medium focus:border-dark-800 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                  {editPlatform === 'whatsapp' ? 'Número de WhatsApp (DDI + DDD) *' : 'ID do Chat do Telegram *'}
                </label>
                <input
                  required
                  value={editIdentifier}
                  onChange={(e) => setEditIdentifier(e.target.value)}
                  placeholder={editPlatform === 'whatsapp' ? 'Ex: 5511999999999' : 'Ex: 123456789'}
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-mono focus:border-dark-800 outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <Mail size={13} className="text-neutral-400" />
                    E-mail do Contato
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Ex: carlos@empresa.com"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <Calendar size={13} className="text-neutral-400" />
                    Data de Aniversário
                  </label>
                  <input
                    type="text"
                    value={editBirthDate}
                    onChange={(e) => setEditBirthDate(e.target.value)}
                    placeholder="Ex: 15/08 ou 1990-08-15"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <Building2 size={13} className="text-neutral-400" />
                    Empresa / Organização
                  </label>
                  <input
                    type="text"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    placeholder="Ex: Naia Tech"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                    <FileText size={13} className="text-neutral-400" />
                    Observações / Notas
                  </label>
                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Ex: Cliente VIP, prefere manhã"
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Tags (opcional, separadas por vírgula)
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowTagsModal(true); loadTags() }}
                    className="text-[11px] font-bold text-brand-600 hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Gerenciar Tags
                  </button>
                </div>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="Ex: vip, lead-quente, cliente"
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-medium focus:border-dark-800 outline-none transition-all"
                />
                {workspaceTagsList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {workspaceTagsList.map((t) => {
                      const currentTags = editTags.split(',').map((x) => x.trim()).filter(Boolean)
                      const isSelected = currentTags.includes(t.name)
                      const colorHex = t.color || '#3b82f6'
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setEditTags(currentTags.filter((x) => x !== t.name).join(', '))
                            } else {
                              setEditTags([...currentTags, t.name].join(', '))
                            }
                          }}
                          style={{
                            backgroundColor: isSelected ? colorHex : `${colorHex}15`,
                            color: isSelected ? '#ffffff' : colorHex,
                            borderColor: isSelected ? colorHex : `${colorHex}40`,
                          }}
                          className="px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all flex items-center gap-1"
                        >
                          #{t.name}
                          {isSelected && <Check size={11} />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>


              <div className="pt-1">
                <label className="flex items-start gap-3 text-xs text-neutral-600 bg-neutral-50 p-3 rounded-xl border border-neutral-200/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editOptIn}
                    onChange={(e) => setEditOptIn(e.target.checked)}
                    className="size-4 rounded mt-0.5 accent-dark-800 shrink-0"
                  />
                  <div>
                    <span className="font-bold text-dark-800 block">Ativo para envio (Opt-in)</span>
                    <span>Desmarque se o cliente solicitou remoção da lista.</span>
                  </div>
                </label>
              </div>

              </div>

              <div className="flex justify-end gap-2 p-4 border-t border-neutral-100 bg-neutral-50/50 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditContact(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
                >
                  Cancelar
                </button>
                <Button type="submit" loading={saving}>
                  Salvar Alterações
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Importar CSV */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/60 backdrop-blur-2xs p-4 animate-in">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-neutral-200 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 p-6 pb-4 shrink-0 bg-white">
              <h3 className="font-display text-base font-bold text-dark-800">
                Importar Contatos via CSV
              </h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-neutral-400 hover:text-dark-800">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleImportSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={6}
                placeholder={`name,whatsapp_phone,telegram_chat_id,opt_in\nMaria Silva,5511999999999,,true\nJoão Souza,,12345678,true`}
                className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-xs font-mono focus:border-dark-800 outline-none bg-neutral-50/60 transition-all"
              />
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-neutral-100 bg-neutral-50/50 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
                >
                  Cancelar
                </button>
                <Button type="submit" loading={saving}>
                  Processar Planilha
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Sistema de Gerenciamento de Tags */}
      {showTagsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/60 backdrop-blur-2xs p-4 animate-in">
          <div className="w-full max-w-2xl rounded-2xl bg-white border border-neutral-200 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 p-6 pb-4 shrink-0 bg-white">
              <div>
                <h3 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
                  <Tag className="text-brand-600" size={18} />
                  Gerenciar Sistema de Tags
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Crie tags coloridas e com descrições para classificar seus contatos e filtrar campanhas com precisão.
                </p>
              </div>
              <button type="button" onClick={() => setShowTagsModal(false)} className="text-neutral-400 hover:text-dark-800">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 pt-4 shrink-0">
              {/* Criar Nova Tag */}
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!newTagName.trim()) return
                setTagSubmitting(true)
                const res = await createContactTag({
                  data: {
                    workspaceId,
                    name: newTagName.trim().replace(/^#/, ''),
                    color: newTagColor,
                    description: newTagDesc.trim() || null,
                  },
                })
                setTagSubmitting(false)
                if (res && 'error' in res) {
                  setMessage(res.error || 'Erro ao criar tag.')
                } else {
                  setNewTagName('')
                  setNewTagDesc('')
                  await loadTags()
                  await refresh()
                }
              }}
              className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3 shrink-0"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-600 block">
                Criar Nova Tag
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-4">
                  <input
                    required
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Nome da tag (ex: vip)"
                    className="w-full h-9 px-3 rounded-lg border border-neutral-200 bg-white text-xs font-bold focus:border-dark-800 outline-none"
                  />
                </div>
                <div className="sm:col-span-5">
                  <input
                    value={newTagDesc}
                    onChange={(e) => setNewTagDesc(e.target.value)}
                    placeholder="Descrição / Critério (opcional)"
                    className="w-full h-9 px-3 rounded-lg border border-neutral-200 bg-white text-xs font-medium focus:border-dark-800 outline-none"
                  />
                </div>
                <div className="sm:col-span-3 flex items-center gap-2">
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="size-9 rounded-lg border border-neutral-200 cursor-pointer p-0.5 bg-white shrink-0"
                    title="Escolha a cor da tag"
                  />
                  <Button type="submit" loading={tagSubmitting} className="w-full h-9 text-xs">
                    Adicionar
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[11px] text-neutral-400">Paleta de cores:</span>
                {['#3b82f6', '#10b981', '#a855f7', '#ec4899', '#f59e0b', '#ef4444', '#64748b', '#14b8a6'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewTagColor(c)}
                    style={{ backgroundColor: c }}
                    className={`size-4 rounded-full border border-black/10 transition-transform ${
                      newTagColor === c ? 'scale-125 ring-2 ring-dark-800 ring-offset-1' : 'hover:scale-110'
                    }`}
                  />
                ))}
              </div>
            </form>
            </div>

            {/* Lista de Tags Existentes */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 divide-y divide-neutral-100">
              {loadingTags ? (
                <div className="p-8 text-center text-xs text-neutral-400">Carregando tags...</div>
              ) : workspaceTagsList.length === 0 ? (
                <div className="p-8 text-center text-xs text-neutral-400">
                  Nenhuma tag criada neste workspace ainda.
                </div>
              ) : (
                workspaceTagsList.map((t) => {
                  const isEditing = editingTagId === t.id
                  const colorHex = t.color || '#3b82f6'
                  return (
                    <div
                      key={t.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/50 px-2 rounded-lg transition-colors"
                    >
                      {isEditing ? (
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                          <input
                            value={editTagName}
                            onChange={(e) => setEditTagName(e.target.value)}
                            className="sm:col-span-4 h-8 px-2.5 rounded border border-neutral-300 text-xs font-bold"
                          />
                          <input
                            value={editTagDesc}
                            onChange={(e) => setEditTagDesc(e.target.value)}
                            placeholder="Descrição"
                            className="sm:col-span-5 h-8 px-2.5 rounded border border-neutral-300 text-xs font-medium"
                          />
                          <div className="sm:col-span-3 flex items-center gap-1.5 justify-end">
                            <input
                              type="color"
                              value={editTagColor}
                              onChange={(e) => setEditTagColor(e.target.value)}
                              className="size-8 rounded border cursor-pointer p-0.5 bg-white"
                            />
                            <Button
                              size="sm"
                              onClick={async () => {
                                const res = await updateContactTag({
                                  data: {
                                    workspaceId,
                                    tagId: t.id,
                                    name: editTagName.trim() || t.name,
                                    color: editTagColor,
                                    description: editTagDesc.trim() || null,
                                  },
                                })
                                if (res && 'error' in res) {
                                  setMessage(res.error || 'Erro ao atualizar tag.')
                                } else {
                                  setEditingTagId(null)
                                  await loadTags()
                                  await refresh()
                                }
                              }}
                            >
                              Salvar
                            </Button>
                            <button
                              onClick={() => setEditingTagId(null)}
                              className="p-1 text-neutral-400 hover:text-dark-800"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <span
                              style={{
                                backgroundColor: `${colorHex}18`,
                                color: colorHex,
                                borderColor: `${colorHex}40`,
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold border"
                            >
                              #{t.name}
                            </span>
                            {t.description && (
                              <span className="text-xs text-neutral-500 max-w-xs truncate">{t.description}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingTagId(t.id)
                                setEditTagName(t.name)
                                setEditTagColor(t.color || '#3b82f6')
                                setEditTagDesc(t.description || '')
                              }}
                              className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-dark-800 transition-colors text-xs flex items-center gap-1 font-bold"
                            >
                              <Pencil size={13} />
                              <span>Editar</span>
                            </button>
                            {t.isCustom && (
                              <button
                                onClick={async () => {
                                  if (confirm(`Deseja realmente excluir a tag #${t.name} e removê-la dos contatos?`)) {
                                    await deleteContactTag({ data: { workspaceId, tagId: t.id } })
                                    await loadTags()
                                    await refresh()
                                  }
                                }}
                                className="p-1.5 rounded-lg text-neutral-400 hover:bg-error-50 hover:text-error-600 transition-colors text-xs"
                                title="Excluir tag"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="flex justify-end p-4 border-t border-neutral-100 bg-neutral-50/50 shrink-0">
              <button
                type="button"
                onClick={() => setShowTagsModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-neutral-100 text-dark-800 hover:bg-neutral-200 transition-colors"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Exclusão de Contato/Grupo */}
      {contactToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-dark-900/50 backdrop-blur-sm p-4"
          style={{ animation: 'fadeIn 120ms ease both' }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setContactToDelete(null) }}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl border border-neutral-200 shadow-2xl overflow-hidden"
            style={{ animation: 'scaleIn 160ms cubic-bezier(0.23,1,0.32,1) both' }}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-error-50 border border-error-100">
                    <Trash2 size={15} className="text-error-600" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-dark-800 leading-snug">
                      Apagar {contactToDelete.isGroup ? 'grupo' : 'contato'}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5 truncate max-w-[220px]" title={contactToDelete.name}>
                      {contactToDelete.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setContactToDelete(null)}
                  disabled={deleting}
                  className="mt-0.5 p-1 rounded-lg text-neutral-400 hover:text-dark-800 hover:bg-neutral-100 transition-colors disabled:pointer-events-none shrink-0"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 pb-4">
              <p className="text-sm text-neutral-600 leading-relaxed">
                Esta ação é permanente. Todo o histórico de campanhas, identidades e tags associadas a este {contactToDelete.isGroup ? 'grupo' : 'contato'} será removido.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-neutral-100 bg-neutral-50">
              <button
                type="button"
                onClick={() => setContactToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 bg-white border border-neutral-200 hover:bg-neutral-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-error-600 hover:bg-error-700 transition-colors disabled:opacity-60"
                style={{ transition: 'transform 160ms ease-out, background-color 150ms ease' }}
              >
                {deleting
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Trash2 size={13} />}
                {deleting ? 'Apagando...' : 'Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Portal: Actions dropdown — rendered in body to escape table overflow/stacking context */}
    {openActionsMenuId && menuAnchor && menuContact && createPortal(
      <div
        data-actions-menu
        className="fixed z-[9999] w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-xl"
        style={{
          top: menuAnchor.top,
          right: menuAnchor.right,
          animation: 'fadeInDown 140ms cubic-bezier(0.23,1,0.32,1) both',
        }}
      >
        <button
          type="button"
          onClick={() => { closeActionsMenu(); openEdit(menuContact) }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
        >
          <Pencil size={13} className="text-neutral-400" />
          Editar contato
        </button>
        {menuContact.isGroup && (
          <button
            type="button"
            onClick={() => { closeActionsMenu(); handleSyncGroupMembers(menuContact) }}
            disabled={syncingGroupId === menuContact.id}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-50"
          >
            <UserRoundPlus size={13} className="text-purple-500" />
            Sincronizar membros
          </button>
        )}
        <div className="my-1 h-px bg-neutral-100" />
        <button
          type="button"
          onClick={() => { closeActionsMenu(); confirmDelete(menuContact) }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-error-600 hover:bg-error-50 transition-colors"
        >
          <Trash2 size={13} />
          Apagar {menuContact.isGroup ? 'grupo' : 'contato'}
        </button>
      </div>,
      document.body
    )}
    </>
  )
}


function PlatformDropdown({
  value,
  onChange,
}: {
  value: 'all' | 'whatsapp' | 'telegram'
  onChange: (val: 'all' | 'whatsapp' | 'telegram') => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScrollOrResize() {
      if (open) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((v) => !v)
  }

  const currentLabel =
    value === 'whatsapp' ? 'WhatsApp' : value === 'telegram' ? 'Telegram' : 'Todos os canais'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`h-9 flex items-center gap-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
          open || value !== 'all'
            ? 'border-dark-800 bg-neutral-900 text-white shadow-xs'
            : 'border-neutral-200 bg-neutral-50/80 text-dark-800 hover:bg-neutral-100'
        }`}
      >
        <span>Canal: {currentLabel}</span>
        <ChevronDown size={14} className={open || value !== 'all' ? 'text-neutral-300' : 'text-neutral-400'} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={menuRef}
          className="animate-in fixed z-[9999] mt-1 w-48 origin-top-left rounded-xl border border-neutral-200 bg-white p-1 shadow-2xl text-xs font-medium text-dark-800"
          style={{
            top: anchor.top,
            left: anchor.left,
            animation: 'fadeInDown 140ms cubic-bezier(0.23,1,0.32,1) both',
          }}
        >
          {[
            { id: 'all', label: 'Todos os canais' },
            { id: 'whatsapp', label: 'WhatsApp', color: 'bg-emerald-500' },
            { id: 'telegram', label: 'Telegram', color: 'bg-blue-500' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange(item.id as any)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                value === item.id ? 'bg-neutral-100 font-bold text-dark-800' : 'hover:bg-neutral-50 text-neutral-600'
              }`}
            >
              <span className="flex items-center gap-2">
                {item.color ? <span className={`size-2 rounded-full ${item.color}`} /> : <span className="size-2" />}
                <span>{item.label}</span>
              </span>
              {value === item.id && <Check size={14} className="text-dark-800" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

function StatusDropdown({
  value,
  onChange,
}: {
  value: 'all' | 'active' | 'optout'
  onChange: (val: 'all' | 'active' | 'optout') => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScrollOrResize() {
      if (open) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((v) => !v)
  }

  const currentLabel =
    value === 'active' ? 'Ativos' : value === 'optout' ? 'Descadastrados' : 'Todos'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`h-9 flex items-center gap-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
          open || value !== 'all'
            ? 'border-dark-800 bg-neutral-900 text-white shadow-xs'
            : 'border-neutral-200 bg-neutral-50/80 text-dark-800 hover:bg-neutral-100'
        }`}
      >
        <span>Status: {currentLabel}</span>
        <ChevronDown size={14} className={open || value !== 'all' ? 'text-neutral-300' : 'text-neutral-400'} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={menuRef}
          className="animate-in fixed z-[9999] mt-1 w-48 origin-top-left rounded-xl border border-neutral-200 bg-white p-1 shadow-2xl text-xs font-medium text-dark-800"
          style={{
            top: anchor.top,
            left: anchor.left,
            animation: 'fadeInDown 140ms cubic-bezier(0.23,1,0.32,1) both',
          }}
        >
          {[
            { id: 'all', label: 'Todos os status' },
            { id: 'active', label: 'Ativos (Opt-in)', dot: 'bg-success-500' },
            { id: 'optout', label: 'Descadastrados', dot: 'bg-neutral-400' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange(item.id as any)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                value === item.id ? 'bg-neutral-100 font-bold text-dark-800' : 'hover:bg-neutral-50 text-neutral-600'
              }`}
            >
              <span className="flex items-center gap-2">
                {item.dot ? <span className={`size-2 rounded-full ${item.dot}`} /> : <span className="size-2" />}
                <span>{item.label}</span>
              </span>
              {value === item.id && <Check size={14} className="text-dark-800" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

function TypeDropdown({
  value,
  onChange,
}: {
  value: 'all' | 'contacts' | 'groups'
  onChange: (val: 'all' | 'contacts' | 'groups') => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScrollOrResize() {
      if (open) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((v) => !v)
  }

  const currentLabel =
    value === 'contacts' ? 'Apenas Pessoais' : value === 'groups' ? 'Grupos' : 'Todos'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`h-9 flex items-center gap-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
          open || value !== 'all'
            ? 'border-dark-800 bg-neutral-900 text-white shadow-xs'
            : 'border-neutral-200 bg-neutral-50/80 text-dark-800 hover:bg-neutral-100'
        }`}
      >
        <span>Tipo: {currentLabel}</span>
        <ChevronDown size={14} className={open || value !== 'all' ? 'text-neutral-300' : 'text-neutral-400'} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={menuRef}
          className="animate-in fixed z-[9999] mt-1 w-48 origin-top-left rounded-xl border border-neutral-200 bg-white p-1 shadow-2xl text-xs font-medium text-dark-800"
          style={{
            top: anchor.top,
            left: anchor.left,
            animation: 'fadeInDown 140ms cubic-bezier(0.23,1,0.32,1) both',
          }}
        >
          {[
            { id: 'all', label: 'Todos os tipos' },
            { id: 'contacts', label: 'Apenas Contatos Pessoais' },
            { id: 'groups', label: 'Apenas Grupos/Comunidades' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange(item.id as any)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                value === item.id ? 'bg-neutral-100 font-bold text-dark-800' : 'hover:bg-neutral-50 text-neutral-600'
              }`}
            >
              <span>{item.label}</span>
              {value === item.id && <Check size={14} className="text-dark-800" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

