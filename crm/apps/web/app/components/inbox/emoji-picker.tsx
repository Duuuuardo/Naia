import { useEffect, useRef, useState } from 'react'
import { Smile } from 'lucide-react'

// Picker de emoji próprio (sem dependência): grid hardcoded agrupado por
// categoria. Fecha ao clicar fora ou apertar Esc.
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Sorrisos e pessoas',
    emojis: [
      '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '🥳', '😅', '😉', '😋', '😜', '🤪',
      '😌', '😴', '🤗', '🤔', '🤨', '😐', '😑', '🙄', '😬', '😔', '😪', '😢', '😭', '😤', '😡',
      '🤯', '😱', '🥺', '😇', '🤠', '🥰', '😻', '👍', '👎', '👏', '🙌', '🙏', '🤝', '✌️', '🤞',
      '👌', '🤙', '💪', '👋', '👀', '🙋', '🙅', '💁', '🤷',
    ],
  },
  {
    label: 'Corações e símbolos',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '✨', '⭐', '🌟', '💫', '🔥', '💯', '✅', '❌', '⚠️', '❓', '❗', '💡', '🎉',
      '🎊', '🎈', '🎁', '🏆', '🥇', '🎯', '🔔',
    ],
  },
  {
    label: 'Objetos e cotidiano',
    emojis: [
      '📱', '💻', '⌚', '📷', '📞', '✉️', '📧', '📅', '🕐', '⏰', '⏳', '📌', '📎', '🔒', '🔑',
      '💰', '💳', '💵', '🛒', '🛍️', '📦', '✈️', '🚗', '🚀', '🏠', '🏢', '🏥', '🏦', '🌎',
      '☀️', '🌙', '⛅', '🌧️', '❄️', '🌈', '☕', '🍕', '🍔', '🍎', '🍰', '🎂', '🍺', '🍷',
      '🥂', '🎵', '🎶', '⚽', '🏀', '🎮', '🎬', '📚', '📰', '📝', '💼', '🎓', '🐶', '🐱',
      '🦄', '🌸', '🌹', '🍀',
    ],
  },
]

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-lg">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="mb-1 last:mb-0">
              <p className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {group.label}
              </p>
              <div className="grid grid-cols-8">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onPick(emoji)
                      setOpen(false)
                    }}
                    className="grid size-8 place-items-center rounded-md text-lg transition-colors hover:bg-neutral-100"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Inserir emoji"
        aria-expanded={open}
        className="grid size-10 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
      >
        <Smile size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
