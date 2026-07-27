import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Pencil, Plus, Search, Trash2, Zap } from 'lucide-react'
import { InboxShell } from '../../components/inbox-shell'
import { Button, Card, EmptyState, Modal } from '../../components/ui'
import {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  getInboxAgent,
  updateQuickReply,
  type QuickReplyItem,
} from '../../lib/inbox-session'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/inbox/respostas')({
  head: () => createHeadConfig('Respostas rápidas — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const quickReplies = await fetchQuickReplies({ data: {} })
    return { agent, quickReplies }
  },
  component: QuickRepliesPage,
})

// Shortcut sem barra, minúsculo e sem espaços (a barra é digitada no composer).
function sanitizeShortcut(value: string): string {
  return value.toLowerCase().replace(/[\/\s]/g, '')
}

function QuickRepliesPage() {
  const { agent, quickReplies: initial } = Route.useLoaderData()
  const [quickReplies, setQuickReplies] = useState<QuickReplyItem[]>(initial)
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<QuickReplyItem | null>(null)
  const [shortcut, setShortcut] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<QuickReplyItem | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function refresh() {
    const rows = await fetchQuickReplies({ data: {} })
    setQuickReplies(rows)
  }

  // Editar/excluir: dono da resposta ou superadmin.
  function canManage(item: QuickReplyItem): boolean {
    return item.createdByAgentId === agent.id || agent.role === 'superadmin'
  }

  function openCreate() {
    setEditing(null)
    setShortcut('')
    setTitle('')
    setContent('')
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(item: QuickReplyItem) {
    setEditing(item)
    setShortcut(item.shortcut)
    setTitle(item.title)
    setContent(item.content)
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleanShortcut = sanitizeShortcut(shortcut)
    if (!cleanShortcut) {
      setFormError('Informe um atalho (sem a barra).')
      return
    }
    if (!title.trim()) {
      setFormError('Informe um título.')
      return
    }
    if (!content.trim()) {
      setFormError('Informe o conteúdo da resposta.')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      const result = editing
        ? await updateQuickReply({
            data: { quickReplyId: editing.id, shortcut: cleanShortcut, title: title.trim(), content: content.trim() },
          })
        : await createQuickReply({
            data: { shortcut: cleanShortcut, title: title.trim(), content: content.trim() },
          })
      if (!result) {
        setFormError('Não foi possível salvar. Você só pode editar respostas que criou.')
        return
      }
      setModalOpen(false)
      await refresh()
    } catch {
      setFormError('Não foi possível salvar. Você só pode editar respostas que criou.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeleteError(null)
    setDeletingBusy(true)
    try {
      await deleteQuickReply({ data: { quickReplyId: deleting.id } })
      setDeleting(null)
      await refresh()
    } catch {
      setDeleteError('Não foi possível excluir. Você só pode excluir respostas que criou.')
    } finally {
      setDeletingBusy(false)
    }
  }

  const query = search.trim().toLowerCase()
  const filtered = query
    ? quickReplies.filter(
        (qr) =>
          qr.shortcut.toLowerCase().includes(query) ||
          qr.title.toLowerCase().includes(query) ||
          qr.content.toLowerCase().includes(query),
      )
    : quickReplies

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">
                Respostas rápidas
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                Textos prontos para agilizar o atendimento.
              </p>
            </div>
            <Button icon={Plus} onClick={openCreate} className="self-start">
              Nova resposta
            </Button>
          </div>

          <p className="flex items-center gap-1.5 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-600">
            <Zap size={13} aria-hidden="true" className="shrink-0" />
            Dica: digite / no composer da conversa para usar uma resposta rápida.
          </p>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por atalho, título ou conteúdo…"
              className="!pl-9"
              aria-label="Buscar respostas rápidas"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={query ? 'Nenhuma resposta encontrada' : 'Nenhuma resposta rápida ainda'}
              description={
                query
                  ? 'Tente outro termo de busca.'
                  : 'Crie a primeira resposta rápida para usar no atendimento.'
              }
              action={
                !query ? (
                  <Button size="sm" icon={Plus} onClick={openCreate}>
                    Nova resposta
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((qr) => (
                <Card key={qr.id} className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 inline-flex shrink-0 items-center rounded-md bg-brand-50 px-2 py-1 font-mono text-xs font-bold text-brand-600">
                    /{qr.shortcut}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-dark-800">{qr.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{qr.content}</p>
                  </div>
                  {canManage(qr) && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(qr)}
                        aria-label={`Editar ${qr.title}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null)
                          setDeleting(qr)
                        }}
                        aria-label={`Excluir ${qr.title}`}
                        className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-error-500/5 hover:text-error-500"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar resposta rápida' : 'Nova resposta rápida'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" form="quick-reply-form" loading={saving}>
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </>
        }
      >
        <form id="quick-reply-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="qr-shortcut">Atalho</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400">
                /
              </span>
              <input
                id="qr-shortcut"
                value={shortcut}
                onChange={(e) => setShortcut(sanitizeShortcut(e.target.value))}
                placeholder="boas-vindas"
                className="!pl-7 font-mono"
                autoFocus
              />
            </div>
            <p className="mt-1 text-xs text-neutral-400">Sem a barra, em minúsculas e sem espaços.</p>
          </div>
          <div>
            <label htmlFor="qr-title">Título</label>
            <input
              id="qr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Boas-vindas ao cliente"
            />
          </div>
          <div>
            <label htmlFor="qr-content">Conteúdo</label>
            <textarea
              id="qr-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Olá! Tudo bem? Sou do time de atendimento…"
              rows={5}
            />
          </div>
          {formError && <p className="text-sm text-error-500">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Excluir resposta rápida"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deletingBusy}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-500">
          Excluir <strong className="text-dark-800">/{deleting?.shortcut}</strong> ({deleting?.title})? Esta ação
          não pode ser desfeita.
        </p>
        {deleteError && <p className="mt-3 text-sm text-error-500">{deleteError}</p>}
      </Modal>
    </InboxShell>
  )
}
