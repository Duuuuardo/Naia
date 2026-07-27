import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface MobileNavItem {
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
  items: readonly MobileNavItem[]
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
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
        className="inline-flex size-9 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800 md:hidden"
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
          <button
            type="button"
            className="absolute inset-0 bg-dark-800/30 backdrop-blur-xs"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
          <div className="drawer-enter absolute bottom-0 left-0 top-0 flex w-64 max-w-[80vw] flex-col border-r border-neutral-200 bg-neutral-0 shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-neutral-200 px-4">
              <span className="font-display text-sm font-bold text-dark-800">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="inline-flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
              {items.map(({ icon: Icon, ...item }) => (
                <Link
                  key={item.to}
                  to={item.to}
                  params={{ workspaceId }}
                  activeOptions={{ exact: item.exact }}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-dark-800 transition-colors hover:bg-neutral-50"
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
