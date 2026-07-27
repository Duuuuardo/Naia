import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CheckCircle2, Lock } from 'lucide-react'
import { Button } from '../../components/ui'
import { CrmLogo } from '../../components/logo'
import { inboxActivate } from '../../lib/inbox-session'
import { getWorkspaceSlug } from '../../lib/inbox-slug'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/inbox/activate')({
  head: () => createHeadConfig('Definir senha — Naia CRM'),
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: InboxActivate,
})

function InboxActivate() {
  const { token } = Route.useSearch()
  const router = useRouter()
  const [slug, setSlug] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setSlug(getWorkspaceSlug())
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    if (!slug || !token) {
      setError('Link de ativação inválido.')
      return
    }
    setError(null)
    setLoading(true)
    const result = await inboxActivate({ data: { slug, token, password } })
    setLoading(false)
    if (!result.ok) {
      setError(result.message ?? 'Não foi possível ativar a conta.')
      return
    }
    setDone(true)
    setTimeout(() => router.navigate({ to: '/inbox/login' }), 1800)
  }

  if (done) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-50 p-6">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-500">
            <CheckCircle2 size={28} />
          </span>
          <h1 className="font-display text-xl font-bold text-dark-800">Conta ativada!</h1>
          <p className="mt-2 text-sm text-neutral-500">Redirecionando para o login…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <CrmLogo className="mx-auto mb-6" size={30} />
          <h1 className="font-display text-2xl font-bold text-dark-800">Defina sua senha</h1>
          <p className="mt-1 text-sm text-neutral-500">Crie a senha de acesso ao atendimento.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-0 p-6 shadow-sm"
        >
          <div>
            <label htmlFor="pw">Nova senha</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" className="!pl-9" autoFocus />
            </div>
          </div>
          <div>
            <label htmlFor="pw2">Confirmar senha</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repita a senha" className="!pl-9" />
            </div>
          </div>
          {error && <p className="text-sm text-error-500">{error}</p>}
          <Button type="submit" className="w-full" loading={loading} disabled={!password || !confirm}>
            Ativar conta
          </Button>
        </form>
      </div>
    </main>
  )
}
