import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Badge, Button, Card, Modal } from '../ui'
import { fetchTags, setContactTags, type ContactDetail, type TagItem } from '../../lib/inbox-session'

// Seção de tags do detalhe do contato: trabalha com as tags reais do
// workspace (tabela tags). O botão '+' abre um modal com checkboxes e o
// vínculo é salvo via setContactTags (substitui as tags do contato).
// Tags novas são criadas em /inbox/admin/tags — a criação inline ficou fora
// de propósito; admins veem um link para a tela de administração.
export function ContactTagsSection({
  contactId,
  contact,
  isAdmin,
  onChanged,
}: {
  contactId: string
  contact: ContactDetail
  isAdmin: boolean
  onChanged: () => Promise<void>
}) {
  const [workspaceTags, setWorkspaceTags] = useState<TagItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchTags()
      .then(setWorkspaceTags)
      .catch(() => setWorkspaceTags([]))
  }, [])

  // O detalhe do contato traz tags como nomes; cruzamos com as tags do
  // workspace para obter id e cor. Nomes sem tag correspondente (legado)
  // aparecem como chips neutros.
  const byName = useMemo(() => new Map(workspaceTags.map((t) => [t.name, t])), [workspaceTags])
  const linked = contact.tags.map((name) => byName.get(name) ?? null)

  function openPicker() {
    const names = new Set(contact.tags)
    setSelected(workspaceTags.filter((t) => names.has(t.name)).map((t) => t.id))
    setPickerOpen(true)
  }

  function toggle(tagId: string) {
    setSelected((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await setContactTags({ data: { contactId, tagIds: selected } })
      setPickerOpen(false)
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-800">Tags</h2>
        <button
          type="button"
          onClick={openPicker}
          aria-label="Editar tags do contato"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500"
        >
          <Plus size={12} aria-hidden="true" />
          Editar tags
        </button>
      </div>
      {contact.tags.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhuma tag vinculada a este contato.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {contact.tags.map((name, index) => {
            const tag = linked[index]
            return (
              <Badge key={name} className="border-neutral-200 bg-neutral-50 text-neutral-600">
                {tag && <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />}
                {name}
              </Badge>
            )
          })}
        </div>
      )}

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Editar tags"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPickerOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={saving} onClick={handleSave}>
              Salvar
            </Button>
          </>
        }
      >
        {workspaceTags.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhuma tag cadastrada no workspace.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {workspaceTags.map((tag) => (
              <li key={tag.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-dark-800 transition-colors hover:bg-neutral-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(tag.id)}
                    onChange={() => toggle(tag.id)}
                    className="size-4 accent-brand-500"
                  />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                  {tag.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
            Novas tags são criadas em{' '}
            <Link
              to={'/inbox/admin/tags' as never}
              className="font-semibold text-brand-600 transition-colors hover:text-brand-500"
            >
              Administração → Tags
            </Link>
            .
          </p>
        )}
      </Modal>
    </Card>
  )
}
