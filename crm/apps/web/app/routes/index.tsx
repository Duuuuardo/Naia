import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

// Placeholder do Milestone 3 — o produto CRM ainda não foi iniciado.
// Este app existe só para a estrutura do monorepo estar pronta.
function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-dark-800">Naia CRM</h1>
        <p className="mt-2 text-sm text-neutral-500">Em breve.</p>
      </div>
    </main>
  )
}
