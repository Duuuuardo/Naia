import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Crown, Filter, Inbox, Plug, Plus, Search, Shield, Users, X } from 'lucide-react'
import { Topbar } from '../../components/topbar'
import { planBadge, WorkspaceAvatar } from '../../components/ui'
import { fetchWorkspaces, createWorkspace, type WorkspaceListItem } from '../../lib/actions'
import { getSessionUser } from '../../lib/session'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/_app/workspaces')({
  head: () => createHeadConfig('Workspaces — Naia CRM'),
  loader: async () => {
    const [user, workspaces] = await Promise.all([getSessionUser(), fetchWorkspaces()])
    return { user: user!, workspaces }
  },
  component: WorkspacesPage,
})

const roleConfig: Record<string, { label: string; bg: string; icon: typeof Crown }> = {
  owner: { label: 'Proprietário', bg: 'bg-dark-800 text-white border-dark-800', icon: Crown },
  admin: { label: 'Administrador', bg: 'bg-brand-50 text-brand-600 border-brand-200 font-semibold', icon: Shield },
}

function WorkspacesPage() {
  const { user, workspaces: initial } = Route.useLoaderData()
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>(initial)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  function handleCreated(ws: WorkspaceListItem) {
    setShowCreate(false)
    setWorkspaces((prev) => [...prev, ws])
    router.navigate({ to: '/$workspaceId', params: { workspaceId: ws.id } })
  }

  const filtered = useMemo(() => {
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
    <div className="flex min-h-screen flex-col bg-neutral-50 font-sans">
      <Topbar user={user} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-6 border-b border-neutral-200 pb-8 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-dark-800">Workspaces</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Selecione ou crie um workspace para gerenciar seu atendimento.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-brand-600 active:scale-[0.98] md:w-auto"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Criar workspace</span>
          </button>
        </div>

        {workspaces.length > 0 && (
          <div className="my-6 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
            <div className="relative max-w-md flex-1">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar workspace..."
                className="h-10 w-full rounded-md border border-neutral-200 bg-white pl-10 pr-4 text-sm text-dark-800 shadow-2xs outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-dark-800">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <span className="mr-1 flex shrink-0 items-center gap-1.5 text-xs font-medium text-neutral-400">
                <Filter size={13} />
                Filtrar:
              </span>
              {[
                { id: 'all', label: `Todos (${workspaces.length})` },
                { id: 'owner', label: 'Proprietário' },
                { id: 'admin', label: 'Administrador' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setRoleFilter(tab.id)}
                  className={`h-9 shrink-0 rounded-md px-3.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 ease-out ${
                    roleFilter === tab.id
                      ? 'bg-dark-800 text-white shadow-2xs'
                      : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-dark-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {workspaces.length === 0 ? (
          <div className="mx-auto mt-8 max-w-lg rounded-2xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-500 shadow-2xs">
              <Inbox size={26} />
            </div>
            <h2 className="mb-1 text-lg font-bold text-dark-800">Nenhum workspace</h2>
            <p className="mb-6 text-sm text-neutral-500">Crie seu primeiro workspace para começar a atender.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-500 px-5 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-brand-600 active:scale-[0.98]"
            >
              <Plus size={16} aria-hidden="true" />
              <span>Criar workspace</span>
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-xl border border-neutral-200 bg-white py-16 text-center">
            <p className="mb-1 text-sm font-medium text-dark-800">Nenhum workspace encontrado</p>
            <p className="mb-4 text-xs text-neutral-400">Não encontramos resultados para sua busca.</p>
            <button
              onClick={() => {
                setSearch('')
                setRoleFilter('all')
              }}
              className="h-9 rounded-md border border-neutral-300 bg-white px-4 text-xs font-semibold text-dark-800 transition-colors hover:bg-neutral-50"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ws) => {
              const roleInfo = roleConfig[ws.role] ?? roleConfig.admin
              const RoleIcon = roleInfo.icon
              const tierInfo = planBadge[ws.plan ?? 'free'] ?? planBadge.free

              return (
                <button
                  key={ws.id}
                  onClick={() => router.navigate({ to: '/$workspaceId', params: { workspaceId: ws.id } })}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-neutral-200 bg-white p-6 text-left outline-none transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-brand-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-[0.98]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <WorkspaceAvatar name={ws.name} picture={ws.avatarUrl} size="md" />
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${roleInfo.bg}`}>
                        <RoleIcon size={12} className="shrink-0" />
                        <span>{roleInfo.label}</span>
                      </span>
                    </div>

                    <div className="mt-4 min-w-0">
                      <h3 className="truncate text-base font-bold text-dark-800 transition-colors group-hover:text-brand-600">
                        {ws.name}
                      </h3>
                      <p className="truncate text-xs text-neutral-400">{ws.slug}.crm.naia.website</p>
                    </div>

                    <div className="mt-4 space-y-2.5 border-t border-neutral-100 pt-4">
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${tierInfo.color}`}>
                          {tierInfo.label}
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          {ws.status === 'active' ? '● Ativo' : '● Limitado'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs text-neutral-500">
                        <div className="flex items-center gap-1.5 truncate">
                          <Users size={13} className="shrink-0 text-neutral-400" />
                          <span className="truncate">Agentes</span>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <Plug size={13} className="shrink-0 text-neutral-400" />
                          <span className="truncate">Canais</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs font-semibold text-neutral-500 transition-colors group-hover:text-brand-600">
                    <span>Acessar</span>
                    <ArrowRight size={16} className="text-neutral-300 transition-colors duration-150 group-hover:text-brand-500" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>

      {showCreate && <CreateWorkspaceModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
    </div>
  )
}

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (ws: WorkspaceListItem) => void
}) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const slugPreview = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !agreed) return
    setError(null)
    setLoading(true)
    const result = await createWorkspace({ data: { name: name.trim() } })
    setLoading(false)
    if ('error' in result) {
      setError(result.error ?? 'Erro ao criar workspace.')
      return
    }
    onCreated({ ...result.workspace, avatarUrl: null, role: 'owner', plan: 'free', status: 'active' })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-800/60 p-4 backdrop-blur-xs" style={{ animation: 'fadeIn 200ms ease-out' }}>
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
        style={{ animation: 'modalScaleIn 200ms cubic-bezier(0.23, 1, 0.32, 1) both' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 p-6 pb-4">
          <h3 className="text-lg font-bold text-dark-800">Novo workspace</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 p-6">
            <div>
              <label htmlFor="ws-name" className="mb-1.5 block text-sm font-medium text-dark-800">
                Nome do workspace <span className="text-error-500">*</span>
              </label>
              <input
                ref={inputRef}
                id="ws-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha Empresa"
                required
                maxLength={80}
                className="h-10 w-full rounded-md border border-neutral-300 px-3.5 text-sm font-medium text-dark-800 outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              {slugPreview && (
                <p className="mt-1.5 text-xs text-neutral-400">
                  Endereço do inbox: <span className="font-medium text-brand-600">{slugPreview}.crm.naia.website</span>
                </p>
              )}
            </div>

            <label className="flex cursor-pointer select-none items-start gap-2.5">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-neutral-300 accent-brand-500"
              />
              <span className="text-xs leading-relaxed text-neutral-500">
                Concordo com os{' '}
                <a href="https://app.vianova.software/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-500 underline-offset-2 hover:text-brand-600 hover:underline">
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a href="https://app.vianova.software/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-500 underline-offset-2 hover:text-brand-600 hover:underline">
                  Política de Privacidade
                </a>.
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-error-500">
                <X size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="text-xs text-neutral-400">Inicia no plano Grátis: 2 agentes, 1 canal, 200 conversas/mês.</p>
          </div>

          <div className="flex shrink-0 gap-3 border-t border-neutral-100 bg-neutral-50/70 p-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-md border border-neutral-300 bg-white text-sm font-medium text-dark-800 transition-[background-color,transform] duration-150 ease-out hover:bg-neutral-50 active:scale-[0.98]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !agreed}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-brand-500 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-brand-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Criando…</span>
                </>
              ) : (
                <>
                  <span>Criar workspace</span>
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
