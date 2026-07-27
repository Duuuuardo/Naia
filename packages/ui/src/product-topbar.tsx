import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Inbox,
  LayoutGrid,
  LogOut,
  Megaphone,
  UserRound,
} from 'lucide-react'
import { Avatar, WorkspaceAvatar } from './dashboard'
import { ProductBrand } from './logo'

type ProductId = 'campaigns' | 'crm'

type ProductDefinition = {
  id: ProductId
  name: string
  description: string
  href: string
}

export function ProductTopbar({
  product,
  user,
  workspaceName,
  workspaceAvatarUrl,
  mobileNav,
  utility,
  notifications,
  accountHref,
  products,
  onLogout,
}: {
  product: { id: ProductId; label: 'Campaigns' | 'CRM' }
  user: { name: string; picture?: string | null; pictureFrame?: string | null }
  workspaceName?: string
  workspaceAvatarUrl?: string | null
  mobileNav?: ReactNode
  utility?: ReactNode
  notifications: ReactNode
  accountHref: string
  products: ProductDefinition[]
  onLogout: () => Promise<void>
}) {
  return (
    <header className="h-14 border-b border-neutral-200 bg-neutral-0">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2">
          {mobileNav}
          <a
            href="/workspaces"
            aria-label="Seus workspaces"
            className="inline-flex shrink-0 items-center gap-2"
          >
            <ProductBrand product={product.label} />
          </a>
          {workspaceName && (
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <ChevronRight size={14} className="shrink-0 text-neutral-300" aria-hidden="true" />
              <WorkspaceAvatar
                name={workspaceName}
                picture={workspaceAvatarUrl}
                size="sm"
                className="shrink-0"
              />
              <span className="truncate font-semibold text-dark-800">{workspaceName}</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {utility}
          {notifications}
          <ProductSwitcher
            currentProduct={product.id}
            products={products}
            accountHref={accountHref}
          />
          <ProfileMenu user={user} accountHref={accountHref} onLogout={onLogout} />
        </div>
      </div>
    </header>
  )
}

function useDismissableMenu(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [onDismiss])

  return ref
}

function ProfileMenu({
  user,
  accountHref,
  onLogout,
}: {
  user: { name: string; picture?: string | null; pictureFrame?: string | null }
  accountHref: string
  onLogout: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissableMenu(() => setOpen(false))

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu do perfil"
        className={`grid size-9 shrink-0 place-items-center rounded-full outline-none transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
          open ? 'bg-neutral-100' : 'hover:bg-neutral-50'
        }`}
      >
        <Avatar name={user.name} picture={user.picture} frame={user.pictureFrame} size="md" />
      </button>

      {open && (
        <div
          role="menu"
          className="popover-enter absolute right-0 top-full z-30 mt-2 w-56 origin-top-right rounded-xl border border-neutral-200 bg-neutral-0 p-1.5 text-sm shadow-lg"
        >
          <div className="mb-1 border-b border-neutral-100 px-3 py-2.5">
            <span className="block truncate font-bold text-dark-800">{user.name}</span>
            <span className="block text-xs text-neutral-400">Sessão ativa</span>
          </div>
          <a
            role="menuitem"
            href={accountHref}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-dark-800 transition-colors duration-150 hover:bg-neutral-50"
          >
            <UserRound size={15} className="text-neutral-500" aria-hidden="true" />
            Gerenciar conta Vianova
          </a>
          <div className="my-1 border-t border-neutral-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void onLogout()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-semibold text-error-600 transition-colors duration-150 hover:bg-error-50"
          >
            <LogOut size={15} aria-hidden="true" />
            Sair do sistema
          </button>
        </div>
      )}
    </div>
  )
}

function ProductSwitcher({
  currentProduct,
  products,
  accountHref,
}: {
  currentProduct: ProductId
  products: ProductDefinition[]
  accountHref: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismissableMenu(() => setOpen(false))

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Seus produtos"
        title="Seus produtos"
        className={`grid size-9 place-items-center rounded-md text-neutral-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-neutral-50 hover:text-dark-800 active:scale-[0.97] ${
          open ? 'bg-neutral-50 text-brand-600' : ''
        }`}
      >
        <LayoutGrid size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="popover-enter absolute right-0 top-full z-30 mt-2 w-72 origin-top-right rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-lg"
        >
          <p className="px-3 pb-2 pt-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Seus produtos
          </p>
          {products.map((item) => {
            const active = item.id === currentProduct
            const Icon = item.id === 'campaigns' ? Megaphone : Inbox
            const content = (
              <>
                <span
                  className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-white ${
                    active ? 'bg-brand-500' : 'bg-dark-800'
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-dark-800">{item.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {active ? 'Você está aqui' : item.description}
                  </span>
                </span>
              </>
            )

            return active ? (
              <span
                key={item.id}
                className="flex items-start gap-3 rounded-md bg-brand-50 px-3 py-2.5"
                aria-current="true"
              >
                {content}
              </span>
            ) : (
              <a
                key={item.id}
                role="menuitem"
                href={item.href}
                className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors duration-150 hover:bg-neutral-50"
              >
                {content}
              </a>
            )
          })}
          <div className="my-1.5 border-t border-neutral-100" />
          <a
            role="menuitem"
            href={accountHref}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-dark-800 transition-colors duration-150 hover:bg-neutral-50"
          >
            <UserRound size={16} aria-hidden="true" className="text-neutral-500" />
            Gerenciar conta
          </a>
        </div>
      )}
    </div>
  )
}
