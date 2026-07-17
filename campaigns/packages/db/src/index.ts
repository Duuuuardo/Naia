import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>
}

const client =
  globalForDb.postgresClient ??
  postgres(
    process.env.NAIA_DATABASE_URL ?? 'postgres://naia:naia_secret@localhost:5435/naia',
    {
      max: Number(process.env.PG_MAX_CONNECTIONS ?? 15),
      idle_timeout: 20,
      connect_timeout: 10,
    }
  )

if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = client
}

export const db = drizzle(client, { schema })

export * from './schema'
export { schema }
