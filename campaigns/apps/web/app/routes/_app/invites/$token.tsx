import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { acceptInvite } from '../../../lib/actions'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/_app/invites/$token')({ head: () => createHeadConfig('Convite — Naia Campanhas'),
  component: AcceptInvitePage,
})

function AcceptInvitePage() {
  const { token } = Route.useParams()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleAccept() {
    setLoading(true)
    setError(null)
    const result = await acceptInvite({ data: token })
    setLoading(false)
    if ('error' in result) { setError(result.error ?? 'Erro inesperado.'); return }
    router.navigate({ to: '/$workspaceId', params: { workspaceId: result.workspace!.id } })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-dark-800">Convite para o Naia</h1>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <button
        onClick={handleAccept}
        disabled={loading}
        className="h-10 px-5 rounded-md bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
      >
        {loading ? 'Aceitando…' : 'Aceitar convite'}
      </button>
    </div>
  )
}
