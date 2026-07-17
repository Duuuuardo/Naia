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

  // Verificação rigorosa de vazamentos de banco de dados, SQL e rastros de stack
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

  if ((error && typeof error === 'object' && ('isBoom' in error || (error as any).message === 'Cancelled')) || checkStr === 'cancelled' || checkStr.includes('delaycancellable') || checkStr.includes('promisetimeout')) {
    return 'A operação no WhatsApp foi temporariamente interrompida porque a conexão reiniciou ou está processando. Tente novamente em instantes.'
  }

  if (isDbOrInternalLeak) {
    console.error('[SECURITY SANITIZATION] Intercepted and sanitized sensitive/database error:', error)

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

  // Prevenir mensagens exageradamente longas que possam conter dumps ou pilhas
  if (raw.length > 300) {
    console.error('[SECURITY SANITIZATION] Intercepted overly long error string (>300 chars):', raw.substring(0, 500))
    return fallbackMessage
  }

  return raw
}
