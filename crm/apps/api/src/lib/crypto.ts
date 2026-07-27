import { randomBytes } from 'crypto'

// IDs curtos para PKs de texto (mesma convenção do Campaigns).
export const generateId = (): string => randomBytes(8).toString('hex')

// Tokens opacos para ativação de agente / convite de manager.
export const generateToken = (): string => randomBytes(32).toString('hex')

// SID de sessão de agente no inbox.
export const generateSid = (): string => randomBytes(32).toString('hex')
