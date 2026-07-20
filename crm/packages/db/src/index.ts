import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.CRM_DATABASE_URL

if (!connectionString) {
  throw new Error('[crm/db] CRM_DATABASE_URL is required')
}

const client = postgres(connectionString)

export const db = drizzle(client, { schema })
export * from './schema'
