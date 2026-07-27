import { type ButtonHTMLAttributes, type ReactNode, useState, useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  CheckCheck,
  Check,
  CircleDashed,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plug,
  TriangleAlert,
  X,
  XCircle,
  Layers,
  MessageCircle,
  Send,
  MessageSquare,
  Mail,
  ExternalLink,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'

// ─── Botões ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600',
  secondary: 'border border-neutral-300 bg-neutral-0 text-dark-800 hover:bg-neutral-50',
  ghost: 'text-dark-800 hover:bg-neutral-50',
  danger: 'border border-error-500 text-error-500 hover:bg-error-500/5',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: LucideIcon
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${buttonSizes[size]} ${buttonStyles[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

// ─── Superfícies ─────────────────────────────────────────────────────────────

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-neutral-200 bg-neutral-0 ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 border-b border-neutral-200 pb-5 md:flex-row md:flex-wrap md:items-center">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">{title}</h1>
        {subtitle && <p className="mt-1 max-w-xl text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function WorkspaceShell({
  header,
  banner,
  sidebar,
  children,
}: {
  header: ReactNode
  banner?: ReactNode
  sidebar: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {header}
      {banner}
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <aside className="hidden w-48 shrink-0 border-r border-neutral-200 py-8 pr-4 md:block">
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  )
}

export function WorkspaceDashboardHeader({
  workspaceName,
  planLabel,
  title = 'Visão geral',
  description,
  actions,
}: {
  workspaceName: string
  planLabel: string
  title?: string
  description: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-neutral-200 pb-5 md:flex-row md:items-center">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-500">
            Workspace · {workspaceName}
          </span>
          <span className="h-3 w-px bg-neutral-300" aria-hidden="true" />
          <span className="rounded-md border border-brand-200/60 bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700 shadow-2xs">
            Plano {planLabel}
          </span>
        </div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">{title}</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-neutral-500">{description}</p>
      </div>
      {actions && (
        <div className="flex w-full shrink-0 items-center gap-2.5 md:w-auto">
          {actions}
        </div>
      )}
    </div>
  )
}

export function DashboardMetricCard({
  icon: Icon,
  iconClassName = 'text-neutral-500',
  label,
  value,
  aside,
  progress,
  progressClassName = 'bg-brand-500',
  footer,
}: {
  icon: LucideIcon
  iconClassName?: string
  label: ReactNode
  value: ReactNode
  aside?: ReactNode
  progress?: number
  progressClassName?: string
  footer?: ReactNode
}) {
  const safeProgress = progress === undefined ? undefined : Math.min(100, Math.max(0, progress))

  return (
    <div className="group space-y-2 rounded-2xl border border-neutral-200 bg-neutral-0 p-5 shadow-2xs transition-colors duration-200 hover:border-neutral-300">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">{label}</span>
        <Icon
          size={14}
          className={`${iconClassName} transition-transform duration-200 group-hover:scale-110`}
          aria-hidden="true"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <span className="font-display text-3xl font-extrabold tracking-tight text-dark-800">{value}</span>
        {aside}
      </div>
      {safeProgress !== undefined && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full ${progressClassName}`}
            style={{ width: `${safeProgress}%` }}
          />
        </div>
      )}
      {footer && (
        <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-1 text-xs font-medium text-neutral-500">
          {footer}
        </div>
      )}
    </div>
  )
}

export type DashboardNotification = {
  id: string
  type: 'billing' | 'security' | 'product' | 'marketing'
  title: string
  body: string | null
  readAt: string | null
  actionUrl: string | null
  createdAt: string
}

export function NotificationBellView<T extends DashboardNotification>({
  open,
  count,
  loading,
  items,
  filters,
  activeFilter,
  viewAllHref,
  onToggle,
  onFilterChange,
  onOpenItem,
  onMarkAllRead,
}: {
  open: boolean
  count: number
  loading: boolean
  items: T[]
  filters: ReadonlyArray<{ id: string; label: string }>
  activeFilter: string
  viewAllHref: string
  onToggle: () => void
  onFilterChange: (filter: string) => void
  onOpenItem: (item: T) => void
  onMarkAllRead: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Notificações"
        className={`relative grid size-9 place-items-center rounded-full transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
          open
            ? 'bg-neutral-100 text-dark-800'
            : 'text-neutral-500 hover:bg-neutral-50 hover:text-dark-800'
        }`}
      >
        <Bell size={18} aria-hidden="true" />
        {count > 0 && (
          <span
            aria-live="polite"
            className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full border-2 border-neutral-0 bg-brand-500 px-1 text-[9px] font-bold leading-3 text-white"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="popover-enter absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-xl border border-neutral-200 bg-neutral-0 text-sm shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
            <span className="text-sm font-bold text-dark-800">Notificações</span>
            <div className="flex items-center gap-1">
              {filters.map((filter) => (
                <button
                  type="button"
                  key={filter.id}
                  onClick={() => onFilterChange(filter.id)}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                    activeFilter === filter.id
                      ? 'bg-brand-100 text-brand-700'
                      : 'text-neutral-500 hover:bg-neutral-100'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid place-items-center px-4 py-10">
              <Loader2 size={18} className="animate-spin text-brand-500" aria-label="Carregando notificações" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-neutral-50 text-neutral-400">
                <Bell size={18} aria-hidden="true" />
              </span>
              <p className="text-xs font-medium text-neutral-500">Nenhuma notificação por enquanto.</p>
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto p-1.5">
                {items.map((item) => (
                  <NotificationRow key={item.id} item={item} onClick={() => onOpenItem(item)} />
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50/60 px-4 py-3">
                <a
                  href={viewAllHref}
                  className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  Ver todas
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                {count > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="flex items-center gap-1 text-[11px] font-semibold text-neutral-500 hover:text-dark-800"
                  >
                    <Check size={12} aria-hidden="true" />
                    Marcar lidas
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function NotificationRow({ item, onClick }: { item: DashboardNotification; onClick: () => void }) {
  const Icon =
    item.type === 'billing'
      ? Zap
      : item.type === 'security'
        ? ShieldAlert
        : item.type === 'marketing'
          ? Megaphone
          : Sparkles
  const iconColor =
    item.type === 'billing'
      ? 'text-amber-600'
      : item.type === 'security'
        ? 'text-error-600'
        : 'text-brand-600'
  const iconBackground =
    item.type === 'billing'
      ? 'bg-amber-50'
      : item.type === 'security'
        ? 'bg-error-50'
        : 'bg-brand-50'

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-neutral-50 ${
        item.readAt ? 'opacity-70' : ''
      }`}
    >
      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${iconBackground}`}>
        <Icon size={15} className={iconColor} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-dark-800">{item.title}</span>
        {item.body && <span className="mt-0.5 line-clamp-2 block text-[11px] text-neutral-500">{item.body}</span>}
        <span className="mt-1 block text-[10px] text-neutral-400">{formatRelativeTime(item.createdAt)}</span>
      </span>
      {!item.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />}
      <ExternalLink size={12} className="mt-1 text-neutral-300" aria-hidden="true" />
    </button>
  )
}

function formatRelativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(elapsed / 3_600_000)
  const days = Math.floor(elapsed / 86_400_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  if (hours < 24) return `há ${hours} h`
  if (days < 7) return `há ${days} dia${days === 1 ? '' : 's'}`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-200 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-100 text-brand-500">
        <Icon size={24} aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-medium text-dark-800">{title}</p>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-0 p-4">
      <div className="flex items-center gap-2 text-neutral-500">
        <Icon size={16} aria-hidden="true" />
        <p className="text-xs">{label}</p>
      </div>
      <p className="mt-1.5 text-lg font-semibold capitalize text-dark-800">{value}</p>
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-error-500/25 bg-error-500/5 px-3 py-2 text-sm text-error-500"
    >
      <XCircle size={16} aria-hidden="true" className="shrink-0" />
      {children}
    </div>
  )
}

// ─── Status (cores e ícones de docs/design.md) ───────────────────────────────

const statusConfig: Record<string, { icon: LucideIcon; className: string; label: string }> = {
  // campanha
  draft: { icon: Pencil, className: 'bg-neutral-100 text-neutral-500', label: 'Rascunho' },
  scheduled: { icon: Clock, className: 'bg-warning-500/10 text-warning-500', label: 'Agendada' },
  running: { icon: Play, className: 'bg-brand-100 text-brand-600', label: 'Enviando' },
  paused: { icon: Pause, className: 'bg-warning-500/10 text-warning-600', label: 'Pausada' },
  completed: { icon: Check, className: 'bg-success-500/10 text-success-500', label: 'Concluída' },
  cancelled: { icon: X, className: 'bg-neutral-100 text-neutral-400', label: 'Cancelada' },
  // run
  pending: { icon: Clock, className: 'bg-neutral-100 text-neutral-500', label: 'Pendente' },
  skipped_quota: { icon: TriangleAlert, className: 'bg-warning-500/10 text-warning-600', label: 'Pulada (cota)' },
  // mensagem em trânsito
  sending: { icon: Loader2, className: 'bg-brand-100 text-brand-600', label: 'Enviando' },
  // conexão
  active: { icon: Check, className: 'bg-success-500/10 text-success-500', label: 'Ativa' },
  disconnected: {
    icon: Plug,
    className: 'bg-neutral-100 text-neutral-500',
    label: 'Desconectada',
  },
  error: { icon: XCircle, className: 'bg-error-500/10 text-error-500', label: 'Erro' },
  // conversa do CRM
  open: { icon: MessageSquare, className: 'bg-brand-100 text-brand-600', label: 'Aberta' },
  assigned: { icon: Play, className: 'bg-blue-50 text-blue-700', label: 'Em atendimento' },
  resolved: { icon: CheckCheck, className: 'bg-success-500/10 text-success-500', label: 'Resolvida' },
  // mensagem
  queued: { icon: CircleDashed, className: 'bg-neutral-100 text-neutral-500', label: 'Na fila' },
  sent: { icon: Check, className: 'bg-neutral-100 text-neutral-500', label: 'Enviada' },
  delivered: { icon: CheckCheck, className: 'bg-neutral-100 text-dark-400', label: 'Entregue' },
  read: { icon: CheckCheck, className: 'bg-brand-100 text-brand-600', label: 'Lida' },
  // extras/billing
  trialing: { icon: Clock, className: 'bg-brand-100 text-brand-600', label: 'Em teste (trial)' },
  past_due: { icon: TriangleAlert, className: 'bg-warning-500/10 text-warning-600', label: 'Pagamento pendente' },
  unpaid: { icon: XCircle, className: 'bg-error-500/10 text-error-500', label: 'Não pago' },
  processing: { icon: Loader2, className: 'bg-brand-100 text-brand-600', label: 'Processando' },
}

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? {
    icon: CircleDashed,
    className: 'bg-neutral-100 text-neutral-500',
    label: status,
  }
  const Icon = config.icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      <Icon size={12} aria-hidden="true" />
      {config.label}
    </span>
  )
}

// ─── Canis (WhatsApp, Telegram, Misto, etc.) ────────────────────────────────

const channelConfig: Record<string, { icon: LucideIcon; className: string; label: string }> = {
  whatsapp: { icon: MessageCircle, className: 'bg-emerald-50 text-emerald-800 border-emerald-200/80', label: 'WhatsApp' },
  telegram: { icon: Send, className: 'bg-blue-50 text-blue-800 border-blue-200/80', label: 'Telegram' },
  mixed: { icon: Layers, className: 'bg-purple-50 text-purple-800 border-purple-200/80', label: 'Misto' },
  discord: { icon: MessageSquare, className: 'bg-indigo-50 text-indigo-800 border-indigo-200/80', label: 'Discord' },
  email: { icon: Mail, className: 'bg-amber-50 text-amber-800 border-amber-200/80', label: 'E-mail' },
  custom: { icon: Plug, className: 'bg-neutral-100 text-neutral-700 border-neutral-200', label: 'Personalizado' },
}

export function formatChannelName(channel?: string | null): string {
  if (!channel) return '—'
  return channelConfig[channel.toLowerCase()]?.label ?? channel
}

export function ChannelBadge({ channel, className = '' }: { channel?: string | null; className?: string }) {
  if (!channel) return <span className="text-neutral-400">—</span>
  const config = channelConfig[channel.toLowerCase()] ?? {
    icon: Plug,
    className: 'bg-neutral-100 text-neutral-700 border-neutral-200',
    label: channel,
  }
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${config.className} ${className}`}>
      <Icon size={13} aria-hidden="true" className="shrink-0" />
      <span>{config.label}</span>
    </span>
  )
}


// ─── Avatar (foto + moldura da conta Vianova) ────────────────────────────────

const avatarSizes = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-16 text-xl',
} as const

const avatarFrames: Record<string, string> = {
  none: 'p-0 bg-transparent',
  via: 'p-[2.5px] bg-brand-500',
  gradient: 'p-[2.5px] bg-gradient-to-br from-brand-300 via-brand-500 to-brand-700',
}

export function Avatar({
  name,
  picture,
  frame,
  size = 'md',
}: {
  name: string
  picture?: string | null
  frame?: string | null
  size?: keyof typeof avatarSizes
}) {
  const frameClass = avatarFrames[frame ?? 'none'] ?? avatarFrames.none
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()

  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full ${avatarSizes[size]} ${frameClass}`}
    >
      <span
        className="relative inline-grid size-full place-items-center overflow-hidden rounded-full border-2 border-neutral-0 bg-brand-100 font-bold text-brand-600"
      >
        {picture ? (
          <img src={picture} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          initials || '?'
        )}
      </span>
    </span>
  )
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}

export function WorkspaceAvatar({
  name,
  picture,
  size = 'md',
  className = '',
}: {
  name: string
  picture?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'size-6 rounded-md text-[10px]',
    md: 'size-10 rounded-lg text-sm',
    lg: 'size-20 rounded-xl text-2xl',
  } as const

  return picture ? (
    <img
      src={picture}
      alt=""
      className={`${sizes[size]} shrink-0 border border-neutral-200 object-cover ${className}`}
    />
  ) : (
    <span
      className={`grid shrink-0 place-items-center border border-brand-100 bg-brand-50 font-bold uppercase text-brand-600 ${sizes[size]} ${className}`}
      aria-hidden="true"
    >
      {getInitials(name) || '?'}
    </span>
  )
}

export function Badge({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

export const planBadge: Record<string, { label: string; color: string }> = {
  none: { label: 'Sem plano', color: 'border-neutral-200 bg-neutral-100 text-neutral-600' },
  free: { label: 'Grátis', color: 'border-neutral-200 bg-neutral-100 text-neutral-600' },
  starter: { label: 'Starter', color: 'border-blue-200 bg-blue-50 text-blue-600' },
  pro: { label: 'Pro', color: 'border-brand-200 bg-brand-50 text-brand-600' },
  scale: { label: 'Scale', color: 'border-amber-200 bg-amber-50 text-amber-700' },
}

// ─── Switch & Toggle (Naia Design System — #DD5973) ──────────────────────────

export type SwitchSize = 'sm' | 'md'

export function Switch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: SwitchSize
}) {
  const [internalChecked, setInternalChecked] = useState(checked)

  useEffect(() => {
    setInternalChecked(checked)
  }, [checked])

  const handleToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (disabled) return
    const next = !internalChecked
    setInternalChecked(next)
    onChange(next)
  }

  const isSm = size === 'sm'
  const trackSize = isSm ? 'h-5 w-9' : 'h-6 w-11'
  const thumbSize = isSm ? 'size-4' : 'size-5'
  const thumbTranslate = isSm
    ? internalChecked
      ? 'translate-x-[18px]'
      : 'translate-x-[2px]'
    : internalChecked
      ? 'translate-x-[22px]'
      : 'translate-x-[2px]'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={internalChecked}
      disabled={disabled}
      {...props}
      onClick={(e) => {
        handleToggle(e)
        props.onClick?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          handleToggle(e)
        }
        props.onKeyDown?.(e)
      }}
      className={`group relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${trackSize} ${
        internalChecked
          ? 'bg-brand-500 shadow-inner-sm'
          : 'bg-neutral-200/90 hover:bg-neutral-300 border border-neutral-300/60'
      } ${className}`}
    >
      <span
        className={`pointer-events-none inline-block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.06] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${thumbSize} ${thumbTranslate}`}
        aria-hidden="true"
      />
    </button>
  )
}

export function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  icon: Icon,
  disabled = false,
  size = 'md',
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  onChange: (on: boolean) => void
  icon?: LucideIcon
  disabled?: boolean
  size?: SwitchSize
}) {
  const [internalChecked, setInternalChecked] = useState(checked)

  useEffect(() => {
    setInternalChecked(checked)
  }, [checked])

  const handleRowClick = () => {
    if (disabled) return
    const next = !internalChecked
    setInternalChecked(next)
    onChange(next)
  }

  return (
    <div
      onClick={handleRowClick}
      className={`group/row flex items-center justify-between gap-4 select-none ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0 flex-1">
        <label
          htmlFor={id}
          onClick={(e) => e.preventDefault()}
          className={`mb-0 flex items-center gap-1.5 text-sm font-semibold text-dark-800 transition-colors duration-150 ${
            disabled ? 'cursor-not-allowed' : 'cursor-pointer group-hover/row:text-dark-900'
          }`}
        >
          {Icon && (
            <Icon
              size={16}
              className="shrink-0 text-brand-500 transition-transform duration-200 group-hover/row:scale-105"
              aria-hidden="true"
            />
          )}
          {label}
        </label>
        {hint && (
          <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
            {hint}
          </span>
        )}
      </span>
      <Switch
        id={id}
        checked={internalChecked}
        onChange={(val) => {
          setInternalChecked(val)
          onChange(val)
        }}
        disabled={disabled}
        size={size}
        aria-label={typeof label === 'string' ? label : undefined}
      />
    </div>
  )
}
