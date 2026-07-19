import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  Film,
  ImageIcon,
  Music,
  Paperclip,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

import { MediaPicker } from '../media-picker'
import type { RolePermissionMap } from '@naia/schemas'
import type { WizardDraft, WizardVariant } from './types'
import { newVariantKey } from './types'

const MAX_VARIANTS = 4
const MAX_MEDIA_PER_VARIANT = 4
const VARIANT_LETTERS = ['A', 'B', 'C', 'D']

const TEMPLATE_VARS = [
  { token: '{{nome}}', sample: 'Maria' },
  { token: '{{telefone}}', sample: '+55 11 91234-5678' },
  { token: '{{email}}', sample: 'maria@email.com' },
  { token: '{{empresa}}', sample: 'Padaria Central' },
  { token: '{{nascimento}}', sample: '12/05' },
  { token: '{{observacoes}}', sample: 'cliente desde 2023' },
]

function renderPreview(body: string): string {
  let out = body
  for (const v of TEMPLATE_VARS) {
    out = out.replaceAll(v.token, v.sample)
  }
  return out
}

const KIND_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
}

export function StepContent({
  draft,
  patch,
  workspaceId,
  userId,
  permissions,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
  workspaceId: string
  userId: string
  permissions: RolePermissionMap
}) {
  const [activeKey, setActiveKey] = useState(draft.variants[0]?.key ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const active = draft.variants.find((v) => v.key === activeKey) ?? draft.variants[0]!

  useEffect(() => {
    if (!draft.variants.some((v) => v.key === activeKey) && draft.variants[0]) {
      setActiveKey(draft.variants[0].key)
    }
  }, [draft.variants, activeKey])

  function patchVariant(key: string, partial: Partial<WizardVariant>) {
    patch({ variants: draft.variants.map((v) => (v.key === key ? { ...v, ...partial } : v)) })
  }

  function addVariant() {
    if (draft.variants.length >= MAX_VARIANTS) return
    const variant: WizardVariant = { key: newVariantKey(), body: '', media: [] }
    patch({ variants: [...draft.variants, variant] })
    setActiveKey(variant.key)
  }

  function removeVariant(key: string) {
    if (draft.variants.length <= 1) return
    const variants = draft.variants.filter((v) => v.key !== key)
    patch({ variants })
    if (activeKey === key) setActiveKey(variants[0]!.key)
  }

  function insertVar(token: string) {
    const textarea = textareaRef.current
    if (!textarea) {
      patchVariant(active.key, { body: active.body + token })
      return
    }
    const start = textarea.selectionStart ?? active.body.length
    const end = textarea.selectionEnd ?? active.body.length
    const body = active.body.slice(0, start) + token + active.body.slice(end)
    patchVariant(active.key, { body })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block">
        <h3 className="text-sm font-bold text-dark-800">Por que usar mais de uma mensagem?</h3>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">
          Variantes dizem a mesma coisa de formas diferentes. O disparo alterna entre elas, então nenhum padrão
          fixo se repete. Isso reduz a chance da campanha ser marcada como spam.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">
          Não é obrigatório, mas duas ou três variações já fazem diferença em campanhas grandes.
        </p>
      </aside>

      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2" role="tablist" aria-label="Variantes da mensagem">
          <button
            type="button"
            onClick={addVariant}
            disabled={draft.variants.length >= MAX_VARIANTS}
            className="grid size-8 place-items-center rounded-md border border-neutral-300 text-neutral-500 transition-colors duration-150 hover:border-brand-500 hover:text-brand-600 active:scale-[0.95] disabled:opacity-40"
            aria-label="Adicionar variante"
          >
            <Plus size={15} />
          </button>
          {draft.variants.map((variant, index) => {
            const isActive = variant.key === active.key
            return (
              <span key={variant.key} className="relative">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveKey(variant.key)}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors duration-150 ${
                    isActive
                      ? 'bg-brand-500 text-white'
                      : 'border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  Mensagem {VARIANT_LETTERS[index]}
                </button>
                {draft.variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(variant.key)}
                    className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full border border-neutral-200 bg-neutral-0 text-neutral-400 transition-colors duration-150 hover:border-error-500 hover:text-error-500"
                    aria-label={`Remover mensagem ${VARIANT_LETTERS[index]}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            )
          })}
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <span className="text-xs font-bold text-dark-800">
              Mensagem {VARIANT_LETTERS[draft.variants.indexOf(active)]}
            </span>
            {draft.variants.length > 1 && (
              <button
                type="button"
                onClick={() => removeVariant(active.key)}
                className="text-neutral-400 transition-colors hover:text-error-500"
                aria-label="Remover esta variante"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={active.body}
            onChange={(e) => patchVariant(active.key, { body: e.target.value })}
            rows={7}
            placeholder={'Escreva a mensagem a ser enviada.\n\nUse {{nome}} e as demais variáveis para personalizar por contato.'}
            className="rounded-none border-0 focus:ring-0"
          />

          <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-100 px-3 py-2">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Variáveis</span>
            {TEMPLATE_VARS.map((v) => (
              <button
                key={v.token}
                type="button"
                onClick={() => insertVar(v.token)}
                className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] text-dark-800 transition-colors duration-150 hover:border-brand-300 hover:bg-brand-50"
              >
                {v.token}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-2.5">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={active.media.length >= MAX_MEDIA_PER_VARIANT}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-dark-800 transition-colors duration-150 hover:border-brand-500 hover:text-brand-600 active:scale-[0.97] disabled:opacity-40"
            >
              <Paperclip size={13} aria-hidden="true" />
              Anexar mídia
            </button>
            <span className="text-[11px] text-neutral-400">
              Escolha um arquivo do workspace ou envie um novo
            </span>
          </div>

          <MediaPicker
            workspaceId={workspaceId}
            userId={userId}
            permissions={permissions}
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={(media) => {
              patchVariant(active.key, { media: [...active.media, media] })
            }}
          />

          {active.media.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-neutral-100 px-3 py-2.5">
              {active.media.map((m) => {
                const Icon = KIND_ICON[m.kind] ?? FileText
                return (
                  <span
                    key={m.assetId}
                    className="group relative flex items-center gap-2 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 pr-2"
                  >
                    {m.kind === 'image' && m.previewUrl ? (
                      <img src={m.previewUrl} alt="" className="size-10 object-cover" />
                    ) : (
                      <span className="grid size-10 place-items-center text-neutral-400">
                        <Icon size={16} aria-hidden="true" />
                      </span>
                    )}
                    <span className="max-w-32 truncate text-[11px] font-medium text-dark-800">{m.filename}</span>
                    <button
                      type="button"
                      onClick={() =>
                        patchVariant(active.key, { media: active.media.filter((x) => x.assetId !== m.assetId) })
                      }
                      className="grid size-4 place-items-center rounded-full text-neutral-400 transition-colors hover:text-error-500"
                      aria-label={`Remover ${m.filename}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {active.body.trim() && (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-[#f6f2ee] p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              Prévia com um contato de exemplo
            </p>
            <div className="max-w-md rounded-lg rounded-tl-none bg-neutral-0 px-3 py-2 text-sm text-dark-800 shadow-2xs whitespace-pre-wrap">
              {renderPreview(active.body)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
