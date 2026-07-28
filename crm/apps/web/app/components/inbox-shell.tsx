import { useEffect, useState, type ReactNode } from 'react'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  Bot,
  Clock,
  FolderOpen,
  Gauge,
  IdCard,
  KanbanSquare,
  ListTree,
  LogOut,
  Menu,
  MessagesSquare,
  MessageSquare,
  Plug,
  ShieldCheck,
  Star,
  Tags,
  UserCog,
  Users,
  UsersRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { CrmLogo } from './logo'
import { fetchInternalChats, inboxLogout, type InboxAgentRole } from '../lib/inbox-session'
import { useInboxSocket } from '../lib/use-inbox-socket'

type NavItem = { to: string; label: string; icon: LucideIcon }

const mainNav: NavItem[] = [
  { to: '/inbox/meu-desempenho', label: 'Meu desempenho', icon: Gauge },
  { to: '/inbox/atendimento', label: 'Atendimento', icon: MessageSquare },
  { to: '/inbox/funis', label: 'Funis', icon: KanbanSquare },
  { to: '/inbox/contatos', label: 'Contatos', icon: Users },
  { to: '/inbox/chat', label: 'Chat interno', icon: MessagesSquare },
  { to: '/inbox/bot', label: 'Bot', icon: Bot },
  { to: '/inbox/arquivos', label: 'Arquivos', icon: FolderOpen },
  { to: '/inbox/respostas', label: 'Respostas rápidas', icon: Zap },
]

// Relatórios gerais da workspace (todos os agentes/filas/CSAT): só admin.
const workspaceReportsNav: NavItem = { to: '/inbox/relatorios', label: 'Relatórios', icon: BarChart3 }

const adminNav: NavItem[] = [
  { to: '/inbox/admin/conexoes', label: 'Conexões', icon: Plug },
  { to: '/inbox/admin/filas', label: 'Filas', icon: ListTree },
  { to: '/inbox/admin/equipes', label: 'Equipes', icon: UsersRound },
  { to: '/inbox/admin/agentes', label: 'Agentes', icon: UserCog },
  { to: '/inbox/admin/permissoes', label: 'Permissões', icon: ShieldCheck },
  { to: '/inbox/admin/tags', label: 'Tags', icon: Tags },
  { to: '/inbox/admin/horarios', label: 'Horários', icon: Clock },
  { to: '/inbox/admin/avaliacao', label: 'Avaliação', icon: Star },
  { to: '/inbox/admin/identificacao', label: 'Identificação', icon: IdCard },
]

const roleMeta: Record<InboxAgentRole, { label: string; className: string }> = {
  superadmin: { label: 'Superadmin', className: 'bg-brand-50 text-brand-600' },
  admin: { label: 'Admin', className: 'bg-blue-50 text-blue-600' },
  agent: { label: 'Agente', className: 'bg-neutral-100 text-neutral-500' },
}

function isActive(pathname: string, to: string): boolean {
  // Atendimento cobre a lista e a thread (/inbox/atendimento e .../c/:id); as
  // demais casam por prefixo (rota exata ou com um segmento abaixo).
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NavLink({
  item,
  pathname,
  badge,
  onNavigate,
}: {
  item: NavItem
  pathname: string
  badge?: number
  onNavigate?: () => void
}) {
  const active = isActive(pathname, item.to)
  const Icon = item.icon
  return (
    <Link
      to={item.to as never}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-brand-50 text-brand-600' : 'text-neutral-500 hover:bg-neutral-50 hover:text-dark-800'
      }`}
    >
      <Icon size={20} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-brand-500 px-1.5 text-[10px] font-bold leading-5 text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  )
}

function SidebarContent({
  agentName,
  role,
  pathname,
  chatUnread,
  onNavigate,
}: {
  agentName: string
  role: InboxAgentRole
  pathname: string
  chatUnread: number
  onNavigate?: () => void
}) {
  const router = useRouter()
  const roleInfo = roleMeta[role] ?? roleMeta.agent

  async function handleLogout() {
    await inboxLogout()
    router.navigate({ to: '/inbox/login' })
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-neutral-100 px-4">
        <CrmLogo size={24} />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {mainNav.map((item) => (
          <NavLink
            key={item.to}
            item={item}
            pathname={pathname}
            badge={item.to === '/inbox/chat' ? chatUnread : undefined}
            onNavigate={onNavigate}
          />
        ))}

        {(role === 'superadmin' || role === 'admin') && (
          <NavLink item={workspaceReportsNav} pathname={pathname} onNavigate={onNavigate} />
        )}

        {role === 'superadmin' && (
          <>
            <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Administração
            </p>
            {adminNav.map((item) => (
              <NavLink key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </>
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-2 border-t border-neutral-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-dark-800">{agentName}</p>
          <span
            className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${roleInfo.className}`}
          >
            {roleInfo.label}
          </span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
          aria-label="Sair"
        >
          <LogOut size={16} />
        </button>
      </div>
    </>
  )
}

// Frame de navegação do app do agente: sidebar fixa no desktop, drawer no
// mobile. O conteúdo de cada área vive nas rotas (a lista de conversas, por
// exemplo, está em /inbox).
export function InboxShell({
  agentName,
  role,
  children,
}: {
  agentName: string
  role: InboxAgentRole
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  async function refreshChatUnread() {
    const chats = await fetchInternalChats()
    setChatUnread(chats.reduce((total, chat) => total + chat.unreadCount, 0))
  }

  useEffect(() => {
    refreshChatUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Badge do chat interno acompanha mensagens novas em tempo real.
  useInboxSocket((event) => {
    if (event.type === 'internal:message:new') refreshChatUnread()
  })

  useEffect(() => {
    if (!mobileOpen) return
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <div className="flex h-screen bg-neutral-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-0 md:flex">
        <SidebarContent agentName={agentName} role={role} pathname={pathname} chatUnread={chatUnread} />
      </aside>

      {/* Drawer (mobile) */}
      {mobileOpen && (
        <div role="dialog" aria-modal="true" aria-label="Navegação" className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-dark-800/30 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          />
          <div className="drawer-enter absolute bottom-0 left-0 top-0 flex w-64 max-w-[80vw] flex-col border-r border-neutral-200 bg-neutral-0 shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-100 px-4">
              <CrmLogo size={24} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Fechar menu"
                className="grid size-8 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <SidebarContent
              agentName={agentName}
              role={role}
              pathname={pathname}
              chatUnread={chatUnread}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar (mobile) */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200 bg-neutral-0 px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={mobileOpen}
            className="grid size-9 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-dark-800"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <CrmLogo size={22} />
        </div>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
