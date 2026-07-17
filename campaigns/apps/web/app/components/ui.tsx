import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
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
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-dark-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-200 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-100 text-brand-500">
        <Icon size={24} aria-hidden="true" />
      </span>
      <p className="text-sm text-neutral-500">{title}</p>
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
  // mensagem
  queued: { icon: CircleDashed, className: 'bg-neutral-100 text-neutral-500', label: 'Na fila' },
  sent: { icon: Check, className: 'bg-neutral-100 text-neutral-500', label: 'Enviada' },
  delivered: { icon: CheckCheck, className: 'bg-neutral-100 text-dark-400', label: 'Entregue' },
  read: { icon: CheckCheck, className: 'bg-brand-100 text-brand-600', label: 'Lida' },
  failed: { icon: XCircle, className: 'bg-error-500/10 text-error-500', label: 'Falhou' },
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

// ─── Avatar (foto + moldura da conta Vianova) ────────────────────────────────

const avatarSizes = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
} as const

const avatarFrames: Record<string, string> = {
  none: 'p-0 bg-transparent',
  via: 'p-[2.5px] bg-[#c466ff]',
  gradient: 'p-[2.5px] bg-[conic-gradient(from_140deg,#c466ff,#8a2cc4,#d08bff,#c466ff)]',
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
    <span className={`inline-grid shrink-0 place-items-center rounded-full ${frameClass}`}>
      <span
        className={`relative inline-grid place-items-center overflow-hidden rounded-full border-2 border-neutral-0 bg-brand-100 font-bold text-brand-600 ${avatarSizes[size]}`}
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
