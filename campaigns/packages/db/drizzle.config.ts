import { defineConfig } from 'drizzle-kit'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[drizzle.config] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: requireEnv('NAIA_DATABASE_URL'),
  },
})
