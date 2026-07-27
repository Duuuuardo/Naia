import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, EmptyState, Modal } from '../../../components/ui'
import {
  createTag,
  deleteTag,
  fetchTags,
  getInboxAgent,
  updateTag,
  type TagItem,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/tags')({
  head: () => createHeadConfig('Tags — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const tags = await fetchTags()
    return { agent, tags }
  },
  component: AdminTags,
})

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

function AdminTags() {
  const initial = Route.useLoaderData()
  const [tags, setTags] = useState<TagItem[]>(initial.tags)
  const [editorTag, setEditorTag] = useState<TagItem | null | 'new'>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setTags(await fetchTags())
  }

  async function handleDelete(tag: TagItem) {
    if (
      !window.confirm(
        `Excluir a tag "${tag.name}"? Ela é removida de todos os contatos e conversas em que está aplicada.`,
      )
    )
      return
    setBusyId(tag.id)
    setError(null)
    await deleteTag({ data: { tagId: tag.id } })
    setBusyId(null)
    await reload()
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">Tags</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Organize contatos e conversas com tags — filtros e relatórios usam essas marcações.
              </p>
            </div>
            <Button icon={Plus} onClick={() => setEditorTag('new')}>
              Nova tag
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm font-medium text-error-500">
              {error}
            </div>
          )}

          {tags.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="Nenhuma tag ainda"
              description="Crie tags como VIP ou Reclamação para classificar contatos e conversas."
              action={
                <Button icon={Plus} onClick={() => setEditorTag('new')}>
                  Nova tag
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-dark-800">{tag.name}</p>
                    <p className="text-xs text-neutral-400">
                      {tag.contactCount} {tag.contactCount === 1 ? 'contato' : 'contatos'} · {tag.conversationCount}{' '}
                      {tag.conversationCount === 1 ? 'conversa' : 'conversas'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditorTag(tag)}
                      aria-label={`Editar ${tag.name}`}
                      className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tag)}
                      disabled={busyId === tag.id}
                      aria-label={`Excluir ${tag.name}`}
                      className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-error-500/10 hover:text-error-500 disabled:opacity-50"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <TagEditorModal
        tag={editorTag === 'new' ? null : editorTag}
        open={editorTag !== null}
        onClose={() => setEditorTag(null)}
        onSaved={async () => {
          setEditorTag(null)
          await reload()
        }}
        onError={setError}
      />
    </InboxShell>
  )
}

function TagEditorModal({
  tag,
  open,
  onClose,
  onSaved,
  onError,
}: {
  tag: TagItem | null
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const editing = tag !== null
  const [name, setName] = useState('')
  const [color, setColor] = useState('#DD5973')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Preenche o formulário ao abrir (criação = vazio, edição = dados da tag).
  const formKey = open ? (tag?.id ?? 'new') : null
  if (formKey && loadedFor !== formKey) {
    setLoadedFor(formKey)
    setName(tag?.name ?? '')
    setColor(tag?.color ?? '#DD5973')
    setFormError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setFormError(null)
    const payload = { name: name.trim(), color }
    const saved = editing ? await updateTag({ data: { tagId: tag.id, ...payload } }) : await createTag({ data: payload })
    setSaving(false)
    if (!saved) {
      setFormError('Não foi possível salvar a tag. Tente novamente.')
      return
    }
    onError(null)
    await onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar tag' : 'Nova tag'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="tag-name" className="mb-1.5 block text-sm font-medium text-dark-800">
            Nome
          </label>
          <input
            id="tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: VIP"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="tag-color" className="mb-1.5 block text-sm font-medium text-dark-800">
            Cor
          </label>
          <div className="flex items-center gap-3">
            <input
              id="tag-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-neutral-300 bg-neutral-0 p-1"
            />
            <span className="font-mono text-xs text-neutral-500">{color}</span>
          </div>
        </div>

        {formError && <p className="text-sm font-medium text-error-500">{formError}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>
            {editing ? 'Salvar' : 'Criar tag'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
