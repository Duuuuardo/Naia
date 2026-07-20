import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[@naia/db] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>
}

const client =
  globalForDb.postgresClient ??
  postgres(requireEnv('NAIA_DATABASE_URL'), {
    max: Number(process.env.PG_MAX_CONNECTIONS ?? 15),
    idle_timeout: 20,
    connect_timeout: 10,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = client
}

export const db = drizzle(client, { schema })

export * from './schema'
export { schema }
