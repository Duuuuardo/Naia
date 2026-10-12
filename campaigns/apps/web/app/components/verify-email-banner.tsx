import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { MailWarning } from 'lucide-react'
import { tryRefreshSession, VIANOVA_WEB_URL } from '../lib/vianova'

export function VerifyEmailBanner({ email }: { email: string }) {
  const router = useRouter()
  const [checking, setChecking] = useState(false)

  async function handleConfirmed() {
    setChecking(true)
    try {
      await tryRefreshSession()
      await router.invalidate()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <MailWarning size={16} aria-hidden="true" className="shrink-0 text-amber-600" />
        <p className="text-sm text-amber-900 flex-1 min-w-48">
          Confirme o email <strong className="font-semibold">{email}</strong> para liberar o
          disparo de campanhas e automações.
        </p>
        <a
          href={VIANOVA_WEB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-amber-800 hover:text-amber-900 underline underline-offset-2 transition-colors"
        >
          Reenviar link na conta Vianova
        </a>
        <button
          onClick={handleConfirmed}
          disabled={checking}
          className="text-sm font-semibold text-amber-800 hover:text-amber-900 underline underline-offset-2 disabled:opacity-60 transition-colors"
        >
          {checking ? 'Verificando…' : 'Já confirmei'}
        </button>
      </div>
    </div>
  )
}
