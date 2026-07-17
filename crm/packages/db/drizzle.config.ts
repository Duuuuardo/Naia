import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.CRM_DATABASE_URL ?? 'postgres://crm:crm_secret@localhost:5436/crm',
  },
})
