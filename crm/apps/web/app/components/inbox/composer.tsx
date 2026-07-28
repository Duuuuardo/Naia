import { useEffect, useRef, useState } from 'react'
import { FileText, Paperclip, Send as SendIcon, X, Zap } from 'lucide-react'
import { Button } from '../ui'
import { fetchQuickReplies, type QuickReplyItem } from '../../lib/inbox-session'
import { AttachmentPicker, type ComposerAttachment } from './attachment-picker'
import { EmojiPicker } from './emoji-picker'
import { AudioRecorder } from './audio-recorder'

// Composer da thread: texto + anexos (chips) + respostas rápidas. Digitar '/'
// no início abre o autocomplete (filtro pelo texto após a barra, navegação
// com ↑↓ Enter Esc); selecionar substitui o texto pelo content da resposta.
// Emoji entra na posição do cursor; o microfone grava áudio na hora e anexa
// como kind 'audio' pelo fluxo presigned da biblioteca de arquivos.
export function Composer({
  onSend,
}: {
  onSend: (input: { content: string; attachments: ComposerAttachment[] }) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const [replies, setReplies] = useState<QuickReplyItem[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const slashOpen = draft.startsWith('/') && !slashDismissed
  const query = slashOpen ? draft.slice(1).toLowerCase() : ''

  // Auto-grow: acompanha a altura do conteúdo (limitada por max-h-32 no CSS,
  // que ativa a rolagem interna). Sem isso o textarea fica travado em 1 linha
  // e corta tanto o texto digitado quanto o placeholder quando o campo estreita.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  // Carrega as respostas rápidas só na primeira vez que o autocomplete abre.
  useEffect(() => {
    if (slashOpen && replies === null) {
      fetchQuickReplies({ data: {} }).then(setReplies)
    }
  }, [slashOpen, replies])

  const matches = slashOpen
    ? (replies ?? [])
        .filter(
          (r) =>
            !query ||
            r.shortcut.toLowerCase().includes(query) ||
            r.title.toLowerCase().includes(query),
        )
        .slice(0, 6)
    : []

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function pickReply(reply: QuickReplyItem) {
    // content ' ' é o placeholder de resposta só-anexo — não vira texto.
    setDraft(reply.content.trim())
    // Anexos da resposta entram no composer (dedup por fileId).
    if (reply.attachments.length > 0) {
      setAttachments((prev) => {
        const existing = new Set(prev.map((a) => a.fileId))
        return [...prev, ...reply.attachments.filter((a) => !existing.has(a.fileId))]
      })
    }
    setSlashDismissed(false)
    textareaRef.current?.focus()
  }

  // Insere o emoji na posição do cursor do textarea e devolve o foco.
  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    setDraft(draft.slice(0, start) + emoji + draft.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  const canSend = draft.trim().length > 0 || attachments.length > 0

  async function handleSend() {
    if (!canSend || sending) return
    setSending(true)
    // A API exige content com minLength 1 — anexo sem texto vai com ' '.
    await onSend({ content: draft.trim() || ' ', attachments })
    setDraft('')
    setAttachments([])
    setSlashDismissed(false)
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        pickReply(matches[activeIndex]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-neutral-200 bg-neutral-0 px-4 py-3">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.fileId}
              className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-1 pl-2.5 pr-1 text-xs font-medium text-dark-800"
            >
              <FileText size={12} className="shrink-0 text-brand-500" aria-hidden="true" />
              <span className="truncate">{a.filename}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((p) => p.fileId !== a.fileId))}
                aria-label={`Remover anexo ${a.filename}`}
                className="grid size-4 shrink-0 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-dark-800"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
        className="flex items-end gap-2"
      >
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label="Anexar arquivo"
          className="grid size-10 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
        >
          <Paperclip size={18} aria-hidden="true" />
        </button>

        <EmojiPicker onPick={insertEmoji} />

        <div className="relative min-w-0 flex-1">
          {matches.length > 0 && (
            <div
              role="listbox"
              aria-label="Respostas rápidas"
              className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0 shadow-lg"
            >
              {matches.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => pickReply(r)}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                    i === activeIndex ? 'bg-brand-50' : 'bg-neutral-0'
                  }`}
                >
                  <Zap size={13} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-dark-800">
                      /{r.shortcut} — {r.title}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-400">{r.content}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSlashDismissed(false)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Escreva uma mensagem…  ( / respostas rápidas )"
            rows={1}
            className="block max-h-32 w-full flex-1 resize-none overflow-y-auto !py-2.5 placeholder:truncate"
          />
        </div>

        <AudioRecorder onAttach={(a) => setAttachments((prev) => [...prev, a])} />

        <Button type="submit" icon={SendIcon} loading={sending} disabled={!canSend}>
          Enviar
        </Button>
      </form>

      <AttachmentPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selected={attachments} onChange={setAttachments} />
    </div>
  )
}
