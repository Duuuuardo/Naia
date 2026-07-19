import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface MobileNavItem {
  to: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

export function MobileNav({
  workspaceId,
  items,
}: {
  workspaceId: string
  items: MobileNavItem[]
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [open])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="md:hidden inline-flex items-center justify-center size-9 rounded-md text-neutral-500 hover:bg-neutral-50 hover:text-dark-800 transition-colors"
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navegação do workspace"
          className="fixed inset-0 z-40 md:hidden"
        >
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-xs motion-safe:animate-[fadeIn_200ms_ease-out]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] bg-neutral-0 border-r border-neutral-200 shadow-xl motion-safe:animate-[drawer-in_200ms_ease-out] flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-neutral-200">
              <span className="font-display text-sm font-bold text-dark-800">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="inline-flex items-center justify-center size-8 rounded-md text-neutral-500 hover:bg-neutral-50 hover:text-dark-800 transition-colors"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
              {items.map(({ icon: Icon, ...item }) => (
                <Link
                  key={item.to}
                  to={item.to}
                  params={{ workspaceId }}
                  activeOptions={{ exact: item.exact }}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-dark-800 hover:bg-neutral-50 transition-colors"
                  activeProps={{ className: 'bg-brand-50 text-brand-600' }}
                >
                  <Icon size={18} aria-hidden="true" className="shrink-0" />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
