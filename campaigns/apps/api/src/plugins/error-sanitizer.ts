import { Elysia } from 'elysia'
import { sanitizeErrorMessage } from '@naia/schemas'

export const errorSanitizerPlugin = new Elysia({ name: 'error-sanitizer' }).onError(
  { as: 'global' },
  ({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      const rawMsg = error instanceof Error ? error.message : String(error)
      return {
        message: sanitizeErrorMessage(
          rawMsg,
          'Os dados informados não são válidos. Verifique os campos preenchidos e tente novamente.'
        ),
        error: 'VALIDATION_ERROR',
      }
    }

    if (code === 'NOT_FOUND') {
      set.status = 404
      return { message: 'Recurso não encontrado.' }
    }

    const rawMsg = error instanceof Error ? error.message : String(error)
    if ((error && typeof error === 'object' && ('isBoom' in error || (error as any).message === 'Cancelled')) || rawMsg === 'Cancelled' || rawMsg.includes('delayCancellable')) {
      set.status = 503
      return {
        message: 'A operação no WhatsApp foi temporariamente interrompida porque a conexão reiniciou ou está processando. Tente novamente em instantes.',
        error: 'WHATSAPP_BUSY',
      }
    }

    const sanitized = sanitizeErrorMessage(error, 'Ocorreu um erro interno no servidor ao processar sua requisição.')

    if (sanitized !== rawMsg || code === 'INTERNAL_SERVER_ERROR' || code === 'UNKNOWN') {
      if (!set.status || set.status === 200) {
        set.status = 500
      }
    }

    return {
      message: sanitized,
      error: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    }
  }
)
