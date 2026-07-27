import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
import { Topbar } from '../../components/topbar'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '../../lib/actions'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/_app/notifications')({
  head: () => createHeadConfig('Notificações — Naia CRM'),
  loader: async () => {
    const [notifications, unread] = await Promise.all([
      fetchNotifications({ data: { page: 1 } }),
      fetchUnreadNotificationCount(),
    ])
    return { notifications, unread }
  },
  component: NotificationsPage,
})

type Filter = 'all' | 'crm' | 'unread'

function NotificationsPage() {
  const { notifications: initial, unread: initialCount } = Route.useLoaderData()
  const { user } = useRouteContext({ from: '/_app' })
  const [items, setItems] = useState<NotificationItem[]>(initial.notifications)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initial.hasMore ?? false)
  const [unreadCount, setUnreadCount] = useState(initialCount.count)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchNotifications({
      data: { page, productSlug: filter === 'crm' ? 'naia-crm' : undefined },
    })
      .then((response) => {
        setItems(response.notifications)
        setHasMore(response.hasMore ?? false)
      })
      .catch(() => setError('Não foi possível carregar as notificações. Tente novamente.'))
      .finally(() => setLoading(false))
  }, [page, filter])

  async function handleMarkAll() {
    const result = await markAllNotificationsRead()
    if ('error' in result) {
      setError(result.error ?? 'Erro ao marcar notificações como lidas.')
      return
    }
    setItems((current) =>
      current.map((notification) => ({ ...notification, readAt: new Date().toISOString() })),
    )
    setUnreadCount(0)
  }

  async function handleClickItem(item: NotificationItem) {
    if (!item.readAt) {
      const result = await markNotificationRead({ data: item.id })
      if ('error' in result) {
        setError(result.error ?? 'Erro ao marcar notificação como lida.')
        return
      }
      setItems((current) =>
        current.map((notification) =>
          notification.id === item.id
            ? { ...notification, readAt: new Date().toISOString() }
            : notification,
        ),
      )
      setUnreadCount((current) => Math.max(0, current - 1))
    }
    if (item.actionUrl) window.location.href = item.actionUrl
  }

  const filteredItems = filter === 'unread' ? items.filter((item) => !item.readAt) : items

  return (
    <div className="flex min-h-screen flex-col font-sans">
      <Topbar user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {error && (
          <p
            className="mb-4 rounded-md border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-600"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-dark-800">Notificações</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              Central de avisos da sua conta Vianova e dos produtos Naia.
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-xs font-semibold text-dark-800 shadow-2xs transition-colors hover:bg-neutral-50"
            >
              <Check size={14} aria-hidden="true" />
              Marcar todas como lidas
            </button>
          )}
        </div>

        <div className="mb-4 flex items-center gap-2">
          <FilterButton active={filter === 'all'} onClick={() => { setFilter('all'); setPage(1) }}>
            Todas
          </FilterButton>
          <FilterButton active={filter === 'crm'} onClick={() => { setFilter('crm'); setPage(1) }}>
            CRM
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
                <Bell size={22} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-neutral-600">Nenhuma notificação encontrada.</p>
              <p className="text-xs text-neutral-400">Quando houver novidades, elas aparecem aqui.</p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {filteredItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleClickItem(item)}
                    className={`flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-neutral-50 ${
                      item.readAt ? 'opacity-70' : ''
                    }`}
                  >
                    <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-md ${iconBackground(item.type)}`}>
                      <NotificationIcon type={item.type} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-sm font-semibold text-dark-800">{item.title}</span>
                        {!item.readAt && (
                          <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                        )}
                      </span>
                      {item.body && <span className="mt-1 block text-xs text-neutral-500">{item.body}</span>}
                      <span className="mt-2 flex items-center gap-3 text-[11px] text-neutral-400">
                        <span>{formatRelative(item.createdAt)}</span>
                        {(item.sourceProductSlug || item.source) && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                            {item.sourceProductSlug || item.source}
                          </span>
                        )}
                      </span>
                    </span>
                    {item.actionUrl && (
                      <ExternalLink size={14} className="mt-1 shrink-0 text-neutral-300" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!loading && filteredItems.length > 0 && (
            <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                Anterior
              </button>
              <span className="text-xs text-neutral-400">Página {page}</span>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!hasMore}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              >
                Próxima
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
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
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-100 text-brand-700' : 'bg-white text-neutral-600 hover:bg-neutral-100'
      }`}
    >
      {children}
    </button>
  )
}

function NotificationIcon({ type }: { type: NotificationItem['type'] }) {
  const Icon =
    type === 'billing'
      ? Zap
      : type === 'security'
        ? ShieldAlert
        : type === 'marketing'
          ? Megaphone
          : Sparkles
  return <Icon size={16} className={iconColor(type)} aria-hidden="true" />
}

function iconBackground(type: NotificationItem['type']) {
  if (type === 'billing') return 'bg-amber-50'
  if (type === 'security') return 'bg-error-50'
  return 'bg-brand-50'
}

function iconColor(type: NotificationItem['type']) {
  if (type === 'billing') return 'text-amber-600'
  if (type === 'security') return 'text-error-600'
  return 'text-brand-600'
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const difference = Date.now() - date.getTime()
  const minutes = Math.floor(difference / 60_000)
  const hours = Math.floor(difference / 3_600_000)
  const days = Math.floor(difference / 86_400_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  if (hours < 24) return `há ${hours} h`
  if (days < 7) return `há ${days} dia${days === 1 ? '' : 's'}`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}
