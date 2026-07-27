import { type ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'

// Modal padrão do design system Naia: overlay escuro neutro, painel central
// rounded-xl com entrada sutil (fade + scale). A animação usa a variante
// `starting:` do Tailwind v4 (@starting-style) — sem CSS customizado — e é
// desligada em prefers-reduced-motion (motion-reduce:transition-none), além
// do reset global de motion dos apps.
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-dark-800/40 opacity-100 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none"
      />
      <div className="relative w-full max-w-lg rounded-xl bg-neutral-0 opacity-100 shadow-xl transition-[opacity,transform] duration-200 ease-out starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-dark-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-8 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
