import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, Check, ExternalLink, Megaphone, ShieldAlert, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '../lib/actions'
import { requireEnv } from '../lib/env'

const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')

type Filter = 'all' | 'naia'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
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

  useEffect(() => {
    fetchUnreadNotificationCount()
      .then((res) => setCount(res.count))
      .catch(() => setCount(0))
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchNotifications({ data: { page: 1, productSlug: filter === 'naia' ? 'naia' : undefined } })
      .then((res) => setItems(res.notifications.slice(0, 6)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, filter])

  async function handleMarkAll() {
    await markAllNotificationsRead()
    setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })))
    setCount(0)
  }

  async function handleClickItem(item: NotificationItem) {
    if (!item.readAt) {
      await markNotificationRead({ data: item.id })
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)))
      setCount((c) => Math.max(0, c - 1))
    }
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Notificações"
        title="Notificações"
        className={`relative grid size-9 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800 ${open ? 'bg-neutral-50 text-brand-600' : ''}`}
      >
        <Bell size={18} aria-hidden="true" />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-in absolute right-0 top-full z-30 mt-2 w-80 origin-top-right rounded-xl border border-neutral-200 bg-white p-2 shadow-lg sm:w-96"
        >
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Notificações</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilter('all')}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${filter === 'all' ? 'bg-brand-100 text-brand-700' : 'text-neutral-500 hover:bg-neutral-100'}`}
              >
                Todos
              </button>
              <button
                onClick={() => setFilter('naia')}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${filter === 'naia' ? 'bg-brand-100 text-brand-700' : 'text-neutral-500 hover:bg-neutral-100'}`}
              >
                Naia
              </button>
            </div>
          </div>

          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">Carregando…</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-neutral-50 text-neutral-400">
                <Bell size={18} />
              </span>
              <p className="text-xs font-medium text-neutral-500">Nenhuma notificação por enquanto.</p>
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto">
                {items.map((item) => (
                  <NotificationRow key={item.id} item={item} onClick={() => handleClickItem(item)} />
                ))}
              </div>
              <div className="mt-1 border-t border-neutral-100 pt-1">
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <Link
                    to="/notifications"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    Ver todas
                    <ExternalLink size={12} />
                  </Link>
                  {count > 0 && (
                    <button
                      onClick={handleMarkAll}
                      className="flex items-center gap-1 text-[11px] font-semibold text-neutral-500 hover:text-dark-800"
                    >
                      <Check size={12} />
                      Marcar lidas
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationRow({ item, onClick }: { item: NotificationItem; onClick: () => void }) {
  const Icon = typeIcon(item.type)
  const time = formatRelative(item.createdAt)
  const href = item.actionUrl || `${VIANOVA_WEB_URL}/notifications`

  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        onClick()
        window.location.href = href
      }}
      role="menuitem"
      className={`flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-neutral-50 ${item.readAt ? 'opacity-70' : ''}`}
    >
      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${iconBg(item.type)}`}>
        <Icon size={15} className={iconColor(item.type)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-dark-800">{item.title}</p>
        {item.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{item.body}</p>}
        <p className="mt-1 text-[10px] text-neutral-400">{time}</p>
      </div>
      {!item.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />}
    </a>
  )
}

function typeIcon(type: NotificationItem['type']) {
  switch (type) {
    case 'billing':
      return Zap
    case 'security':
      return ShieldAlert
    case 'marketing':
      return Megaphone
    default:
      return Sparkles
  }
}

function iconBg(type: NotificationItem['type']) {
  switch (type) {
    case 'billing':
      return 'bg-amber-50'
    case 'security':
      return 'bg-red-50'
    case 'marketing':
      return 'bg-brand-50'
    default:
      return 'bg-brand-50'
  }
}

function iconColor(type: NotificationItem['type']) {
  switch (type) {
    case 'billing':
      return 'text-amber-600'
    case 'security':
      return 'text-red-600'
    case 'marketing':
      return 'text-brand-600'
    default:
      return 'text-brand-600'
  }
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'agora'
  if (diffMins < 60) return `há ${diffMins} min`
  if (diffHours < 24) return `há ${diffHours} h`
  if (diffDays < 7) return `há ${diffDays} dia${diffDays === 1 ? '' : 's'}`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
