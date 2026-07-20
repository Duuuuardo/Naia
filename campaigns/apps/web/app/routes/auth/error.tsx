import { createFileRoute, Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'

export const Route = createFileRoute('/auth/error')({
  validateSearch: (search: Record<string, unknown>): { reason?: string } => ({
    reason: typeof search.reason === 'string' ? search.reason : undefined,
  }),
  component: AuthErrorPage,
})

function AuthErrorPage() {
  const { reason } = Route.useSearch()

  const title =
    reason === 'missing_code' ? 'Código de autenticação ausente' : 'Não foi possível entrar'
  const message =
    reason === 'missing_code'
      ? 'O link de retorno não continha um código válido. Tente fazer login novamente.'
      : 'A autenticação com a conta Vianova falhou. Tente novamente ou entre em contato se o problema persistir.'

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-8 max-w-md w-full text-center">
        <div className="size-14 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto text-error-500 mb-5">
          <AlertTriangle size={28} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-dark-800 mb-2">{title}</h1>
        <p className="text-sm text-neutral-500 mb-6">{message}</p>
        <Link
          to="/login"
          className="inline-flex h-10 px-5 rounded-md bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 active:scale-[0.98] transition-all shadow-sm items-center justify-center gap-2"
        >
          Tentar novamente
        </Link>
      </div>
    </div>
  )
}
