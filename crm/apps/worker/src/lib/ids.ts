import { randomBytes } from 'crypto'

// IDs curtos para PKs de texto (mesma convenção da API e do Campaigns).
export const generateId = (): string => randomBytes(8).toString('hex')
