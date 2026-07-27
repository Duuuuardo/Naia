import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Modal } from '../ui'
import { setConversationTags, type TagItem } from '../../lib/inbox-session'

// Chips de tags da conversa + botão '+' que abre o seletor. A API de detalhe
// da conversa não retorna tags — os labels (nomes) vêm da listagem e são
// mapeados para as tags do workspace (fetchTags) para exibir a cor e montar
// os tagIds na hora de salvar (setConversationTags substitui o conjunto).
export function ConversationTags({
  conversationId,
  labels,
  tags,
  onSaved,
}: {
  conversationId: string
  labels: string[]
  tags: TagItem[]
  onSaved: (labels: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const byName = new Map(tags.map((t) => [t.name, t]))

  // Ao abrir, pré-seleciona as tags cujo nome está nos labels da conversa.
  useEffect(() => {
    if (!open) return
    setSelected(labels.map((name) => byName.get(name)?.id).filter((id): id is string => Boolean(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, labels, tags])

  function toggle(tagId: string) {
    setSelected((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    await setConversationTags({ data: { conversationId, tagIds: selected } })
    onSaved(tags.filter((t) => selected.includes(t.id)).map((t) => t.name))
    setSaving(false)
    setOpen(false)
  }

  return (
    <>
      {labels.map((name) => {
        const tag = byName.get(name)
        return (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-0 px-2 py-0.5 text-xs font-medium text-dark-800"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: tag?.color ?? 'var(--color-neutral-300)' }}
              aria-hidden="true"
            />
            {name}
          </span>
        )
      })}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Editar tags da conversa"
        title="Editar tags da conversa"
        className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-brand-500 hover:text-brand-600"
      >
        <Plus size={11} aria-hidden="true" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Tags da conversa"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={saving} onClick={handleSave}>
              Salvar
            </Button>
          </>
        }
      >
        {tags.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-400">Nenhuma tag criada no workspace.</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {tags.map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-dark-800 transition-colors hover:bg-neutral-50 has-checked:border-brand-500 has-checked:bg-brand-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(tag.id)}
                  onChange={() => toggle(tag.id)}
                  className="size-4 accent-brand-500"
                />
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{tag.name}</span>
              </label>
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
