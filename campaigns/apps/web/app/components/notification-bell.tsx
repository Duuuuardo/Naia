import { useEffect, useRef, useState } from 'react'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '../lib/actions'
import { requireEnv } from '../lib/env'
import { NotificationBellView, type DashboardNotification } from './ui'

const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')
const filters = [
  { id: 'all', label: 'Todas' },
  { id: 'campaigns', label: 'Campaigns' },
] as const

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'campaigns'>('all')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function closeOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    fetchUnreadNotificationCount()
      .then(({ count: unread }) => setCount(unread))
      .catch(() => setCount(0))
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchNotifications({ data: { page: 1, productSlug: filter === 'campaigns' ? 'naia' : undefined } })
      .then((response) => setItems(response.notifications.slice(0, 6)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, filter])

  async function markAllRead() {
    await markAllNotificationsRead()
    setItems((current) => current.map((item) => ({ ...item, readAt: new Date().toISOString() })))
    setCount(0)
  }

  async function openNotification(item: DashboardNotification) {
    if (!item.readAt) {
      await markNotificationRead({ data: item.id })
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, readAt: new Date().toISOString() } : currentItem,
        ),
      )
      setCount((current) => Math.max(0, current - 1))
    }
    setOpen(false)
    window.location.href = item.actionUrl || `${VIANOVA_WEB_URL}/notifications`
  }

  return (
    <div className="relative" ref={ref}>
      <NotificationBellView
        open={open}
        count={count}
        loading={loading}
        items={items}
        filters={filters}
        activeFilter={filter}
        viewAllHref="/notifications"
        onToggle={() => setOpen((current) => !current)}
        onFilterChange={(value) => setFilter(value as 'all' | 'campaigns')}
        onOpenItem={openNotification}
        onMarkAllRead={markAllRead}
      />
    </div>
  )
}
