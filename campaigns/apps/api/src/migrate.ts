import { db } from '@naia/db'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

await migrate(db as any, { migrationsFolder: './drizzle' })
console.log('[migrate] Done')
process.exit(0)
