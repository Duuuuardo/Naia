
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Informe o email.'
  if (value.length > 254 || !EMAIL_RE.test(value)) return 'Informe um email válido.'
  return null
}

export function validateOptionalEmail(email: string): string | null {
  if (!email.trim()) return null
  return validateEmail(email)
}

export function validateContactName(name: string): string | null {
  if (!name.trim()) return 'Informe o nome do contato.'
  if (name.trim().length > 200) return 'O nome deve ter no máximo 200 caracteres.'
  return null
}

export function validateContactIdentifier(
  platform: 'whatsapp' | 'telegram',
  value: string,
): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return platform === 'whatsapp'
      ? 'Informe o número de WhatsApp.'
      : 'Informe o ID do chat do Telegram.'
  }
  if (platform === 'whatsapp') {
    const digits = trimmed.replace(/[\s()+.-]/g, '')
    if (!/^[0-9]{10,20}$/.test(digits)) {
      return 'Número inválido. Use só dígitos com DDI e DDD (ex: 5511999999999).'
    }
    return null
  }
  if (!/^-?[0-9]{4,20}$/.test(trimmed)) {
    return 'ID inválido. Use o ID numérico do chat (ex: 123456789).'
  }
  return null
}
export function validateWorkspaceName(name: string): string | null {
  if (!name.trim()) return 'Informe o nome do workspace.'
  if (name.trim().length > 80) return 'O nome deve ter no máximo 80 caracteres.'
  return null
}

export function validateConnectionName(name: string): string | null {
  if (!name.trim()) return 'Informe um nome de identificação.'
  return null
}

export function validatePhone(phone: string): string | null {
  const digits = phone.replace(/[\s()+.-]/g, '')
  if (!digits) return 'Informe o número de telefone.'
  if (!/^[0-9]{10,20}$/.test(digits)) return 'Número inválido. Use código do país e DDD.'
  return null
}
