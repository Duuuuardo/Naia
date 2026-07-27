import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { apiClient } from './api'

// Extras do inbox que não cabem no inbox-session.ts (arquivo da fundação).
// Mesmo cookie httpOnly da sessão do inbox (nome duplicado de propósito — o
// módulo da fundação não exporta o helper de token).

const INBOX_COOKIE = 'crm_inbox_token'

// URL de leitura (presigned) para um anexo de mensagem via
// GET /inbox/files/attachment-url?key= — cobre tanto anexos da biblioteca
// (`<workspaceId>/<fileId>/<filename>`) quanto mídia inbound dos canais
// (`<workspaceId>/inbound/<externalMessageId>/<filename>`, sem row em files).
// mimeType/kind vêm do próprio attachment da mensagem (a rota só devolve a URL).
export const fetchAttachmentUrl = createServerFn()
  .validator((data: { storageKey: string }) => data)
  .handler(async ({ data }): Promise<{ url: string } | null> => {
    const res = await apiClient(getCookie(INBOX_COOKIE) ?? undefined)
      .inbox.files['attachment-url'].get({ query: { key: data.storageKey } })
    const body = res.data as { url?: string } | null
    if (!body?.url) return null
    return { url: body.url }
  })
