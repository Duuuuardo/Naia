import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { UserRoundCog } from 'lucide-react'
import { acceptInvite } from '../../../lib/actions'
import { Button } from '../../../components/ui'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/_app/invites/$token')({
  head: () => createHeadConfig('Convite — Naia CRM'),
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
    if ('error' in result || !result.workspace) {
      setError('error' in result ? (result.error ?? 'Erro inesperado.') : 'Convite inválido ou expirado.')
      return
    }
    router.navigate({ to: '/$workspaceId', params: { workspaceId: result.workspace.id } })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
        <UserRoundCog size={22} aria-hidden="true" />
      </span>
      <h1 className="font-display text-2xl font-bold text-dark-800">Convite para o Naia CRM</h1>
      <p className="max-w-md text-sm text-neutral-500">
        Você foi convidado para gerenciar um workspace no painel de gestão. Ao aceitar, o workspace
        aparece na sua lista assim que o convite for confirmado.
      </p>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <Button onClick={handleAccept} loading={loading}>
        {loading ? 'Aceitando…' : 'Aceitar convite'}
      </Button>
    </div>
  )
}
