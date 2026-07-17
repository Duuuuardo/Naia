import { getCookie } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'
import { apiClient } from './api'
import { SESSION_COOKIE } from './vianova'

// Módulo estritamente server-only (sufixo .server.ts) — só pode ser importado
// de dentro de outro createServerFn (contexto de request já garantido).
// Nunca importar isto de um arquivo que também é alcançável pelo bundle do
// client (ex.: routes/index.tsx, routes/_app.tsx) — quebra a hidratação
// inteira, já que @tanstack/react-start/server não existe no browser.
export async function requireApi() {
  const token = getCookie(SESSION_COOKIE)
  if (!token) throw redirect({ to: '/login' })
  return apiClient(token)
}
