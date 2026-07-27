import { createFileRoute, Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui'
import { CrmLogo } from '../../components/logo'

const reasons: Record<string, string> = {
  missing_code: 'O login não retornou o código de autorização. Tente novamente.',
  token_exchange_failed: 'Não foi possível concluir o login. Tente novamente.',
}

export const Route = createFileRoute('/auth/error')({
  validateSearch: (search: Record<string, unknown>): { reason?: string } => ({
    reason: typeof search.reason === 'string' ? search.reason : undefined,
  }),
  component: AuthError,
})

function AuthError() {
  const { reason } = Route.useSearch()
  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm text-center">
        <CrmLogo className="mx-auto mb-8" />
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-error-500/10 text-error-500">
          <TriangleAlert size={24} />
        </span>
        <h1 className="font-display text-xl font-bold text-dark-800">Erro no login</h1>
        <p className="mt-2 text-sm text-neutral-500">
          {reasons[reason ?? ''] ?? 'Algo deu errado ao entrar. Tente novamente.'}
        </p>
        <Link to="/login" className="mt-6 inline-block">
          <Button>Voltar ao login</Button>
        </Link>
      </div>
    </main>
  )
}
