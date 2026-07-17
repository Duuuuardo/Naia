import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Inbox, LayoutGrid, LogOut, Megaphone, UserRound } from 'lucide-react'
import { logout } from '../lib/vianova'
import { NaiaLogo } from './logo'
import { Avatar } from './ui'

export function Topbar({
  user,
  workspaceName,
  workspaceAvatarUrl,
}: {
  user: { name: string; picture?: string | null; pictureFrame?: string | null }
  workspaceName?: string
  workspaceAvatarUrl?: string | null
}) {
  const router = useRouter()

  async function handleLogout() {
    await logout()
    router.navigate({ to: '/login' })
  }

  return (
    <header className="h-14 border-b border-neutral-200 bg-white">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2">
          <Link to="/workspaces" aria-label="Seus workspaces">
            <NaiaLogo className="h-6" />
          </Link>
          {workspaceName && (
            <span className="flex items-center gap-2 text-sm">
              <ChevronRight size={14} className="text-neutral-300" aria-hidden="true" />
              {workspaceAvatarUrl ? (
                <img
                  src={workspaceAvatarUrl}
                  alt=""
                  className="size-6 rounded-md object-cover border border-neutral-200"
                />
              ) : (
                <span className="grid size-6 place-items-center rounded-md bg-brand-50 text-[11px] font-bold text-brand-600 uppercase">
                  {workspaceName[0]}
                </span>
              )}
              <span className="font-semibold text-dark-800">{workspaceName}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ProductSwitcher />
          <ProfileMenu user={user} onLogout={handleLogout} />
        </div>
      </div>
    </header>
  )
}

function ProfileMenu({
  user,
  onLogout,
}: {
  user: { name: string; picture?: string | null; pictureFrame?: string | null }
  onLogout: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu do perfil"
        className={`flex items-center gap-2 rounded-full p-0.5 transition-all outline-none focus:ring-2 focus:ring-dark-800 ${open ? 'ring-2 ring-dark-800 bg-neutral-100' : 'hover:opacity-85'}`}
      >
        <Avatar name={user.name} picture={user.picture} frame={user.pictureFrame} size="md" />
      </button>

      {open && (
        <div
          role="menu"
          className="animate-in absolute right-0 top-full z-30 mt-2 w-56 origin-top-right rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg text-sm"
        >
          <div className="px-3 py-2.5 border-b border-neutral-100 mb-1">
            <span className="block font-bold text-dark-800 truncate">{user.name}</span>
            <span className="block text-xs text-neutral-400">Sessão Ativa</span>
          </div>

          <a
            role="menuitem"
            href={VIANOVA_WEB_URL}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-dark-800 transition-colors hover:bg-neutral-50"
          >
            <UserRound size={15} className="text-neutral-500" />
            <span>Gerenciar Conta Vianova</span>
          </a>

          <div className="my-1 border-t border-neutral-100" />

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 font-semibold text-error-600 transition-colors hover:bg-error-50 text-left"
          >
            <LogOut size={15} />
            <span>Sair do Sistema</span>
          </button>
        </div>
      )}
    </div>
  )
}

const VIANOVA_WEB_URL = import.meta.env.VITE_VIANOVA_WEB_URL ?? 'http://localhost:3000'
const CRM_WEB_URL = import.meta.env.VITE_CRM_WEB_URL ?? 'http://localhost:3302'

function ProductSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Seus produtos"
        title="Seus produtos"
        className={`grid size-9 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800 ${open ? 'bg-neutral-50 text-brand-600' : ''}`}
      >
        <LayoutGrid size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="animate-in absolute right-0 top-full z-30 mt-2 w-72 origin-top-right rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-lg"
        >
          <p className="px-3 pb-2 pt-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Seus produtos
          </p>
          <span className="flex items-start gap-3 rounded-md bg-brand-50 px-3 py-2.5" aria-current="true">
            <span className="mt-0.5 grid size-8 place-items-center rounded-md bg-brand-500 text-white">
              <Megaphone size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-dark-800">Naia Campanhas</span>
              <span className="block text-xs text-neutral-500">Você está aqui</span>
            </span>
          </span>
          <a
            role="menuitem"
            href={CRM_WEB_URL}
            className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-50"
          >
            <span className="mt-0.5 grid size-8 place-items-center rounded-md bg-dark-800 text-white">
              <Inbox size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-dark-800">Naia CRM</span>
              <span className="block text-xs text-neutral-500">Atendimento multicanal</span>
            </span>
          </a>
          <div className="my-1.5 border-t border-neutral-100" />
          <a
            role="menuitem"
            href={VIANOVA_WEB_URL}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-dark-800 transition-colors hover:bg-neutral-50"
          >
            <UserRound size={16} aria-hidden="true" className="text-neutral-500" />
            Gerenciar conta
          </a>
        </div>
      )}
    </div>
  )
}
