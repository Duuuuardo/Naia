import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'

// Mesmo cookie de sessão do inbox (ver lib/inbox-session.ts — a constante é
// privada lá). Mantido em sync: se o nome mudar, mudar nos dois arquivos.
const INBOX_COOKIE = 'crm_inbox_token'

// Variante do deleteFile (inbox-session.ts) que inspeciona o erro do Eden:
// a API recusa com 409 quando o arquivo está anexado a mensagens, e a versão
// base engole o erro retornando sempre ok:true. Aqui a UI recebe o motivo.
export const deleteFileGuarded = createServerFn()
  .validator((data: { fileId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; inUse: boolean; message: string | null }> => {
    const token = getCookie(INBOX_COOKIE) ?? undefined
    const res = await apiClient(token).inbox.files({ id: data.fileId }).delete()
    if (res.error) {
      const body = res.error.value as { message?: string } | null
      // A API usa set.status dinâmico (404/409) — o tipo do Eden só conhece 422.
      const status = res.error.status as number
      return {
        ok: false,
        inUse: status === 409,
        message: body?.message ?? 'Não foi possível excluir o arquivo.',
      }
    }
    return { ok: true, inUse: false, message: null }
  })
