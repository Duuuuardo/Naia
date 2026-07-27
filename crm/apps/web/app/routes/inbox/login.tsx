import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AtSign, Lock } from 'lucide-react'
import { Button } from '../../components/ui'
import { CrmLogo } from '../../components/logo'
import { inboxLogin } from '../../lib/inbox-session'
import { getWorkspaceSlug } from '../../lib/inbox-slug'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/inbox/login')({
  head: () => createHeadConfig('Entrar no inbox — Naia CRM'),
  component: InboxLogin,
})

function InboxLogin() {
  const router = useRouter()
  const [slug, setSlug] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSlug(getWorkspaceSlug())
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) {
      setError('Workspace não identificado no endereço.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Informe um email válido.')
      return
    }
    setError(null)
    setLoading(true)
    const result = await inboxLogin({ data: { slug, email: normalizedEmail, password } })
    setLoading(false)
    if (!result.ok) {
      setError(result.message ?? 'Não foi possível entrar.')
      return
    }
    router.navigate({ to: '/inbox' })
  }

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <CrmLogo className="mx-auto mb-6" size={30} />
          <h1 className="font-display text-2xl font-bold text-dark-800">Entrar no atendimento</h1>
          {slug && <p className="mt-1 text-sm text-neutral-500">{slug}.crm.naia.website</p>}
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-0 p-6 shadow-sm"
        >
          <div>
            <label htmlFor="email">Email</label>
            <div className="relative">
              <AtSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                className="!pl-9"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label htmlFor="password">Senha</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="!pl-9"
              />
            </div>
          </div>
          {error && <p className="text-sm text-error-500">{error}</p>}
          <Button type="submit" className="w-full" loading={loading} disabled={!email.trim() || !password}>
            Entrar
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-400">
          Recebeu um convite? Verifique seu email para definir a senha.
        </p>
      </div>
    </main>
  )
}
