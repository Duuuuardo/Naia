import { createFileRoute, useLoaderData, useRouteContext } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Topbar } from '../../components/topbar'
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '../../lib/actions'
import { requireEnv } from '../../lib/env'
import { createHeadConfig } from '~/lib/seo'

const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')

export const Route = createFileRoute('/_app/notifications')({ head: () => createHeadConfig('Notificações — Naia Campanhas'),
  loader: async () => {
    try {
      const [notifications, unread] = await Promise.all([
        fetchNotifications({ data: { page: 1 } }),
        fetchUnreadNotificationCount(),
      ])
      console.log('[notifications loader]', notifications.notifications.length, unread.count)
      return { notifications, unread }
    } catch (err) {
      console.error('[notifications loader] erro:', err)
      return { notifications: { notifications: [] as NotificationItem[], total: 0, page: 1, hasMore: false }, unread: { count: 0 } }
    }
  },
  component: NotificationsPage,
})

type Filter = 'all' | 'naia' | 'unread'

function NotificationsPage() {
  const { notifications: initial, unread: initialCount } = Route.useLoaderData()
  const { user } = useRouteContext({ from: '/_app' })
  const [items, setItems] = useState<NotificationItem[]>(initial.notifications)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initial.hasMore ?? false)
  const [unreadCount, setUnreadCount] = useState(initialCount.count)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const productSlug = filter === 'naia' ? 'naia' : undefined
    fetchNotifications({ data: { page, productSlug } })
      .then((res) => {
        setItems(res.notifications)
        setHasMore(res.hasMore ?? false)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [page, filter])

  async function handleMarkAll() {
    await markAllNotificationsRead()
    setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })))
    setUnreadCount(0)
  }

  async function handleClickItem(item: NotificationItem) {
    if (!item.readAt) {
      await markNotificationRead({ data: item.id })
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
    }
    if (item.actionUrl) {
      window.location.href = item.actionUrl
    }
  }

  const filteredItems = filter === 'unread' ? items.filter((n) => !n.readAt) : items

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Topbar user={user} />
      <main className="mx-auto max-w-3xl flex-1 px-4 py-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-dark-800">Notificações</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Central de avisos da sua conta Vianova e dos produtos Naia.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAll}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-xs font-semibold text-dark-800 shadow-2xs transition-colors hover:bg-neutral-50"
          >
            <Check size={14} />
            Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <FilterButton active={filter === 'all'} onClick={() => { setFilter('all'); setPage(1) }}>
          Todas
        </FilterButton>
        <FilterButton active={filter === 'naia'} onClick={() => { setFilter('naia'); setPage(1) }}>
          Naia
        </FilterButton>
        <FilterButton active={filter === 'unread'} onClick={() => { setFilter('unread'); setPage(1) }}>
          Não lidas
        </FilterButton>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xs">
        {loading ? (
          <div className="flex items-center justify-center px-4 py-16 text-xs text-neutral-400">
            <span className="mr-2 size-4 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-500" />
            Carregando notificações…
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-neutral-50 text-neutral-400">
              <Bell size={22} />
            </span>
            <p className="mt-3 text-sm font-medium text-neutral-600">Nenhuma notificação encontrada.</p>
            <p className="text-xs text-neutral-400">Quando houver novidades, elas aparecem aqui.</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {filteredItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => handleClickItem(item)}
                  className={`flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-neutral-50 ${item.readAt ? 'opacity-70' : ''}`}
                >
                  <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-md ${iconBg(item.type)}`}>
                    <NotificationIcon type={item.type} size={16} className={iconColor(item.type)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-dark-800">{item.title}</p>
                      {!item.readAt && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                      )}
                    </div>
                    {item.body && <p className="mt-1 text-xs text-neutral-500">{item.body}</p>}
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-400">
                      <span>{formatRelative(item.createdAt)}</span>
                      {item.sourceProductSlug ? (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                          {item.sourceProductSlug}
                        </span>
                      ) : item.source ? (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                          {item.source}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {item.actionUrl && <ExternalLink size={14} className="mt-1 shrink-0 text-neutral-300" />}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!loading && filteredItems.length > 0 && (
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              Anterior
            </button>
            <span className="text-xs text-neutral-400">Página {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              Próxima
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[11px] text-neutral-400">
        Preferências de e-mail são gerenciadas na{' '}
        <a href={`${VIANOVA_WEB_URL}/settings/notifications`} className="text-brand-600 hover:underline">
          conta Vianova
        </a>
        .
      </p>
      </main>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-100 text-brand-700' : 'bg-white text-neutral-600 hover:bg-neutral-100'
      }`}
    >
      {children}
    </button>
  )
}

function NotificationIcon({
  type,
  size,
  className,
}: {
  type: NotificationItem['type']
  size: number
  className?: string
}) {
  const Icon = type === 'billing' ? Zap : type === 'security' ? ShieldAlert : type === 'marketing' ? Megaphone : Sparkles
  return <Icon size={size} className={className} />
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
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}
