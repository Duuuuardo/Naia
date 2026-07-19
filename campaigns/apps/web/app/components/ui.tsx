import { type ButtonHTMLAttributes, type ReactNode, useState, useEffect } from 'react'
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
  Layers,
  MessageCircle,
  Send,
  MessageSquare,
  Mail,
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
    <div className="mb-6 flex flex-col md:flex-row md:flex-wrap md:items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-dark-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
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
  const thumbBase = isSm ? 'h-4' : 'h-5'
  const thumbWidth = isSm
    ? 'w-4 group-active:w-6'
    : 'w-5 group-active:w-7'
  const thumbTranslate = isSm
    ? internalChecked
      ? 'translate-x-[18px] group-active:translate-x-[10px]'
      : 'translate-x-[2px] group-active:translate-x-[2px]'
    : internalChecked
      ? 'translate-x-[22px] group-active:translate-x-[14px]'
      : 'translate-x-[2px] group-active:translate-x-[2px]'

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
        className={`pointer-events-none inline-block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.06] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${thumbBase} ${thumbWidth} ${thumbTranslate}`}
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

