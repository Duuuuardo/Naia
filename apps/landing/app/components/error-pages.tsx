import { Link, useMatch, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { House, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

const BRAND = '#DD5973'

function WaveLost() {
  return (
    <svg width="140" height="44" viewBox="0 0 140 44" fill="none" aria-hidden="true">
      <path
        d="M8 22 C16 6 24 6 32 22 S48 38 56 22 S72 6 80 22"
        stroke={BRAND}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="98" cy="22" r="3.5" fill={BRAND} opacity="0.55" />
      <circle cx="112" cy="22" r="3.5" fill={BRAND} opacity="0.3" />
      <circle cx="126" cy="22" r="3.5" fill={BRAND} opacity="0.15" />
    </svg>
  )
}

function WaveFlatline() {
  return (
    <svg width="140" height="44" viewBox="0 0 140 44" fill="none" aria-hidden="true">
      <path
        d="M8 22 C16 6 24 6 32 22 S48 38 56 22 S66 12 72 18 L80 22 H132"
        stroke={BRAND}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function ErrorShell({
  embedded = false,
  signature,
  code,
  title,
  description,
  actions,
  detail,
}: {
  embedded?: boolean
  signature: ReactNode
  code: string
  title: string
  description: string
  actions: ReactNode
  detail?: ReactNode
}) {
  return (
    <main
      className={`err-page flex flex-col items-center justify-center px-6 text-center ${
        embedded ? 'min-h-[60vh] py-12' : 'min-h-dvh bg-neutral-50 py-16'
      }`}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .err-page [data-err-item] {
            opacity: 0;
            transform: translateY(8px);
            animation: err-rise 400ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
          }
          .err-page [data-err-item="1"] { animation-delay: 40ms; }
          .err-page [data-err-item="2"] { animation-delay: 80ms; }
          .err-page [data-err-item="3"] { animation-delay: 120ms; }
          .err-page [data-err-item="4"] { animation-delay: 160ms; }
          @keyframes err-rise {
            to { opacity: 1; transform: translateY(0); }
          }
        }
      `}</style>
      {!embedded && (
        <img
          src="/brand/naia-logo-dark.png"
          alt="Naia"
          className="mb-14 h-6 w-auto"
          data-err-item="0"
        />
      )}
      <div data-err-item="1">{signature}</div>
      <p
        className="mt-8 font-mono text-xs font-semibold tracking-[0.2em] text-brand-500"
        data-err-item="2"
      >
        {code}
      </p>
      <h1
        className="mt-2 font-display text-3xl font-bold tracking-tight text-dark-800"
        data-err-item="2"
      >
        {title}
      </h1>
      <p className="mt-3 max-w-md text-base text-neutral-500" data-err-item="3">
        {description}
      </p>
      <div className="mt-8 flex flex-col items-center gap-4" data-err-item="4">
        {actions}
      </div>
      {detail}
    </main>
  )
}

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-brand-600 active:scale-[0.97]'
const quietLink =
  'inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 underline-offset-4 transition-colors duration-150 hover:text-dark-800 hover:underline'

function NotFoundContent({ embedded = false }: { embedded?: boolean }) {
  return (
    <ErrorShell
      embedded={embedded}
      signature={<WaveLost />}
      code="ERRO 404"
      title="Página não encontrada"
      description="O endereço que você acessou não existe ou foi movido. Confira o link ou volte para o início."
      actions={
        <Link to="/" className={primaryBtn}>
          <House className="size-4" aria-hidden="true" />
          Voltar ao início
        </Link>
      }
    />
  )
}

function ErrorContent({
  embedded = false,
  error,
  reset,
}: { embedded?: boolean } & ErrorComponentProps) {
  const router = useRouter()

  return (
    <ErrorShell
      embedded={embedded}
      signature={<WaveFlatline />}
      code="ERRO 500"
      title="Algo deu errado"
      description="Um problema inesperado impediu esta página de carregar. Tente novamente — se persistir, fale com o suporte."
      actions={
        <>
          <button
            type="button"
            className={primaryBtn}
            onClick={() => {
              reset()
              router.invalidate()
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Tentar novamente
          </button>
          <Link to="/" className={quietLink}>
            ou voltar ao início
          </Link>
        </>
      }
      detail={
        import.meta.env.DEV && error instanceof Error ? (
          <pre className="mt-10 max-w-xl overflow-auto rounded-md border border-neutral-200 bg-white p-4 text-left font-mono text-xs text-neutral-600">
            {error.message}
          </pre>
        ) : null
      }
    />
  )
}

export function NotFoundPage() {
  return <NotFoundContent />
}

export function NotFoundEmbedded() {
  return <NotFoundContent embedded />
}

export function ErrorPage(props: ErrorComponentProps) {
  const match = useMatch({ strict: false })
  const insideShell = String(match.routeId).startsWith('/_app/$workspaceId/')
  return <ErrorContent embedded={insideShell} {...props} />
}

export function ErrorEmbedded(props: ErrorComponentProps) {
  return <ErrorContent embedded {...props} />
}
