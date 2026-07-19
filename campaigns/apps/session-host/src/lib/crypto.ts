import { randomBytes } from 'crypto'

export function generateId(): string {
  return randomBytes(10).toString('hex')
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}
