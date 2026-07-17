import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.NAIA_DATABASE_URL ?? 'postgres://naia:naia_secret@localhost:5435/naia',
  },
})
