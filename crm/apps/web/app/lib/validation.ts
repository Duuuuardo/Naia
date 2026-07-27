// Validação client-side dos forms — mensagens em pt-BR, mesmas regras que a API espera.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Informe o email.'
  if (value.length > 254 || !EMAIL_RE.test(value)) return 'Informe um email válido.'
  return null
}
