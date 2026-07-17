import { Elysia } from 'elysia'

export function sanitizeErrorMessage(
  error: unknown,
  fallbackMessage = 'Ocorreu um erro interno ao processar a requisição no servidor.'
): string {
  if (error === null || error === undefined) return fallbackMessage

  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string'
          ? (error as any).message
          : String(error)

  if (!raw || typeof raw !== 'string') return fallbackMessage

  const checkStr = raw.toLowerCase()

  const isDbOrInternalLeak =
    checkStr.includes('failed query:') ||
    checkStr.includes('syntax error at or near') ||
    checkStr.includes('drizzleerror') ||
    checkStr.includes('postgreserror') ||
    checkStr.includes('update "') ||
    checkStr.includes('insert into "') ||
    checkStr.includes('delete from "') ||
    (checkStr.includes('select ') && (checkStr.includes('from "') || checkStr.includes('where '))) ||
    checkStr.includes('alter table') ||
    checkStr.includes('invalid input syntax for type') ||
    (checkStr.includes('column "') && checkStr.includes('does not exist')) ||
    (checkStr.includes('relation "') && checkStr.includes('does not exist')) ||
    checkStr.includes('violates foreign key constraint') ||
    checkStr.includes('duplicate key value violates unique constraint') ||
    checkStr.includes('sqlstate') ||
    checkStr.includes('params:') ||
    checkStr.includes('econnrefused') ||
    checkStr.includes('etimedout') ||
    checkStr.includes('at async ') ||
    checkStr.includes('at process.') ||
    /where\s+\(/i.test(raw) ||
    /\$\d+/.test(raw)

  if (isDbOrInternalLeak) {
    console.error('[SECURITY SANITIZATION] Intercepted and sanitized sensitive/database error in CRM:', error)

    if (checkStr.includes('duplicate key value violates unique constraint')) {
      return 'Este registro já existe no sistema ou entra em conflito com outro existente.'
    }
    if (checkStr.includes('violates foreign key constraint')) {
      return 'O registro referenciado não foi encontrado ou não pode ser alterado no momento.'
    }
    if (checkStr.includes('invalid input syntax for type')) {
      return 'Os dados informados possuem um formato ou tipo inválido.'
    }
    if (checkStr.includes('econnrefused') || checkStr.includes('etimedout')) {
      return 'O serviço ou banco de dados está temporariamente indisponível. Tente novamente em instantes.'
    }

    return fallbackMessage
  }

  if (raw.length > 300) {
    console.error('[SECURITY SANITIZATION] Intercepted overly long error string (>300 chars):', raw.substring(0, 500))
    return fallbackMessage
  }

  return raw
}

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
