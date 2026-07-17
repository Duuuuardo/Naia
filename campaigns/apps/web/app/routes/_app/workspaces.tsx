import { createFileRoute, useRouteContext, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Crown,
  Filter,
  Link as LinkIcon,
  Megaphone,
  Plug,
  Plus,
  Search,
  Shield,
  User,
  X,
} from 'lucide-react'
import { Topbar } from '../../components/topbar'
import { fetchWorkspaces, createWorkspace } from '../../lib/actions'

export const Route = createFileRoute('/_app/workspaces')({
  loader: () => fetchWorkspaces(),
  component: WorkspacesPage,
})

type Workspace = Awaited<ReturnType<typeof fetchWorkspaces>>[number]

const roleConfig: Record<string, { label: string; bg: string; icon: typeof Crown }> = {
  owner: {
    label: 'Proprietário',
    bg: 'bg-dark-800 text-white border-dark-800',
    icon: Crown,
  },
  admin: {
    label: 'Administrador',
    bg: 'bg-brand-50 text-brand-600 border-brand-200 font-semibold',
    icon: Shield,
  },
  member: {
    label: 'Membro',
    bg: 'bg-neutral-100 text-neutral-600 border-neutral-200',
    icon: User,
  },
}

const tierBadge: Record<string, { label: string; color: string }> = {
  free: { label: 'Grátis', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
  starter: { label: 'Starter', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  pro: { label: 'Pro', color: 'bg-brand-50 text-brand-600 border-brand-200' },
  scale: { label: 'Scale', color: 'bg-amber-50 text-amber-700 border-amber-200' },
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (ws: Workspace) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setLoading(true)
    const result = await createWorkspace({ data: { name: name.trim() } })
    setLoading(false)
    if ('error' in result) {
      setError(result.error ?? 'Erro ao criar workspace.')
      return
    }
    onCreated({ ...result.workspace!, role: 'owner' } as Workspace)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-800/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full flex flex-col overflow-hidden border border-neutral-200"
        style={{ animation: 'modalScaleIn 200ms cubic-bezier(0.23, 1, 0.32, 1) both' }}
      >
        <div className="p-6 pb-4 border-b border-neutral-100 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-dark-800">Novo workspace</h3>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg text-neutral-400 hover:text-dark-800 hover:bg-neutral-100 flex items-center justify-center transition-all"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="p-6 space-y-4 flex-1">
            <div>
              <label htmlFor="ws-name" className="block text-sm font-medium text-dark-800 mb-1.5">
                Nome
              </label>
              <input
                ref={inputRef}
                id="ws-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha Empresa"
                required
                className="w-full h-10 px-3.5 rounded-md border border-neutral-300 text-sm font-medium text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              />
            </div>

            <p className="text-xs text-neutral-400">
              Inicia no plano Grátis (3 envios/mês).
            </p>

            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm font-medium text-error-500 flex items-center gap-2">
                <X size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-neutral-100 bg-neutral-50/70 flex gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-md border border-neutral-300 bg-white text-dark-800 text-sm font-medium hover:bg-neutral-50 active:scale-[0.98] transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 h-10 rounded-md bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all shadow-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Criando…</span>
                </>
              ) : (
                <>
                  <span>Criar</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function WorkspacesPage() {
  const initialWorkspaces = Route.useLoaderData()
  const { user } = useRouteContext({ from: '/_app' })
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  function handleCreated(ws: Workspace) {
    setShowCreate(false)
    setWorkspaces((prev) => [...prev, ws])
    router.navigate({ to: '/$workspaceId', params: { workspaceId: ws.id } })
  }

  const filteredWorkspaces = useMemo(() => {
    return workspaces.filter((ws) => {
      const matchesSearch =
        !search.trim() ||
        ws.name.toLowerCase().includes(search.toLowerCase()) ||
        ws.slug.toLowerCase().includes(search.toLowerCase())
      const matchesRole = roleFilter === 'all' || ws.role === roleFilter
      return matchesSearch && matchesRole
    })
  }, [workspaces, search, roleFilter])

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col font-sans">
      <style>{`
        @keyframes modalScaleIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>

      <Topbar user={user} />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-neutral-200">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-dark-800">
              Workspaces
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              Selecione ou crie um workspace para acessar suas campanhas.
            </p>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="h-10 px-4 rounded-md bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 active:scale-[0.98] transition-all shadow-sm inline-flex items-center justify-center gap-2 shrink-0"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Criar workspace</span>
          </button>
        </div>

        {workspaces.length > 0 && (
          <div className="my-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar workspace..."
                className="w-full h-10 pl-10 pr-4 rounded-md bg-white border border-neutral-200 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all shadow-2xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-dark-800"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <span className="text-xs font-medium text-neutral-400 flex items-center gap-1.5 mr-1 shrink-0">
                <Filter size={13} />
                Filtrar:
              </span>
              {[
                { id: 'all', label: `Todos (${workspaces.length})` },
                { id: 'owner', label: 'Proprietário' },
                { id: 'admin', label: 'Administrador' },
                { id: 'member', label: 'Membro' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setRoleFilter(tab.id)}
                  className={`h-9 px-3.5 rounded-md text-xs font-semibold transition-all shrink-0 ${
                    roleFilter === tab.id
                      ? 'bg-dark-800 text-white shadow-2xs'
                      : 'bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50 hover:text-dark-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {workspaces.length === 0 ? (
          <div className="mt-8 bg-white rounded-2xl border border-neutral-200 shadow-sm p-10 text-center max-w-lg mx-auto">
            <div className="size-14 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center mx-auto text-brand-500 mb-5 shadow-2xs">
              <Megaphone size={26} />
            </div>
            <h2 className="text-lg font-bold text-dark-800 mb-1">
              Nenhum workspace
            </h2>
            <p className="text-sm text-neutral-500 mb-6">
              Crie seu primeiro workspace para começar.
            </p>

            <button
              onClick={() => setShowCreate(true)}
              className="h-10 px-5 rounded-md bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 active:scale-[0.98] transition-all shadow-sm inline-flex items-center justify-center gap-2"
            >
              <Plus size={16} aria-hidden="true" />
              <span>Criar workspace</span>
            </button>
          </div>
        ) : filteredWorkspaces.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-neutral-200 mt-6">
            <p className="text-sm font-medium text-dark-800 mb-1">Nenhum workspace encontrado</p>
            <p className="text-xs text-neutral-400 mb-4">
              Não encontramos resultados para sua busca.
            </p>
            <button
              onClick={() => {
                setSearch('')
                setRoleFilter('all')
              }}
              className="h-9 px-4 rounded-md border border-neutral-300 bg-white text-dark-800 text-xs font-semibold hover:bg-neutral-50 transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredWorkspaces.map((ws) => {
              const roleInfo = roleConfig[ws.role] ?? roleConfig.member
              const RoleIcon = roleInfo.icon
              const tierInfo = ws.entitlements?.tier
                ? tierBadge[ws.entitlements.tier] ?? { label: ws.entitlements.tier.toUpperCase(), color: 'bg-neutral-100 text-neutral-600 border-neutral-200' }
                : { label: 'Grátis', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' }

              return (
                <button
                  key={ws.id}
                  onClick={() =>
                    router.navigate({ to: '/$workspaceId', params: { workspaceId: ws.id } })
                  }
                  className="group relative text-left bg-white rounded-xl border border-neutral-200 p-6 hover:border-brand-300 hover:shadow-md transition-all duration-200 ease-out active:scale-[0.98] flex flex-col justify-between overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="size-11 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-base font-bold text-brand-600 shrink-0 shadow-2xs group-hover:bg-brand-500 group-hover:text-white transition-colors duration-200">
                        {getInitials(ws.name)}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs border ${roleInfo.bg}`}
                      >
                        <RoleIcon size={12} className="shrink-0" />
                        <span>{roleInfo.label}</span>
                      </span>
                    </div>

                    <div className="mt-4 min-w-0">
                      <h3 className="font-bold text-base text-dark-800 truncate group-hover:text-brand-600 transition-colors">
                        {ws.name}
                      </h3>
                    </div>

                    <div className="mt-4 pt-4 border-t border-neutral-100 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${tierInfo.color}`}>
                          <span>{tierInfo.label}</span>
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          {ws.entitlements?.status === 'active' ? '● Ativo' : '● Limitado'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-neutral-500 pt-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <Megaphone size={13} className="text-neutral-400 shrink-0" />
                          <span className="truncate">
                            {ws.entitlements?.campaignsPerMonth ?? 1}{' '}
                            {ws.entitlements?.campaignsPerMonth === 1 ? 'envio' : 'envios'}/mês
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <Plug size={13} className="text-neutral-400 shrink-0" />
                          <span className="truncate">
                            {ws.entitlements?.connections ?? 1}{' '}
                            {ws.entitlements?.connections === 1 ? 'conexão' : 'conexões'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs font-semibold text-neutral-500 group-hover:text-brand-600 transition-colors">
                    <span>Acessar</span>
                    <ArrowRight
                      size={16}
                      className="text-neutral-300 group-hover:text-brand-500 group-hover:translate-x-1 transition-all duration-200 ease-out"
                    />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
