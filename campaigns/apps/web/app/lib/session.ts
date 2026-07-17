import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'
import { SESSION_COOKIE } from './vianova'

// Único export deste módulo é um createServerFn — seguro de importar de
// qualquer route (client ou server), já que o compilador troca a chamada por
// uma RPC no bundle do browser. Ver lib/session.server.ts pro helper que usa
// getCookie diretamente (esse sim nunca pode ser alcançável pelo client).
export const getSessionUser = createServerFn().handler(async () => {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null
  try {
    const { data, error } = await apiClient(token).auth.me.get()
    if (error || !data?.user) return null
    return data.user
  } catch {
    return null
  }
})
