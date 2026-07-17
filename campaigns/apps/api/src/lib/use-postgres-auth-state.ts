import path from 'path'
import fs from 'fs'
import { db, whatsappSessions } from '@naia/db'
import { eq, and, inArray } from 'drizzle-orm'
import type { AuthenticationState } from '@whiskeysockets/baileys'

function loadBaileys() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@whiskeysockets/baileys') as typeof import('@whiskeysockets/baileys')
}

export async function usePostgresAuthState(connectionId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
}> {
  const { initAuthCreds, BufferJSON, proto } = loadBaileys()

  const writeData = async (data: unknown, keyId: string) => {
    const value = JSON.stringify(data, BufferJSON.replacer)
    await db
      .insert(whatsappSessions)
      .values({
        connectionId,
        keyId,
        value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [whatsappSessions.connectionId, whatsappSessions.keyId],
        set: { value, updatedAt: new Date() },
      })
  }

  const readData = async (keyId: string): Promise<any | null> => {
    try {
      const [row] = await db
        .select({ value: whatsappSessions.value })
        .from(whatsappSessions)
        .where(and(eq(whatsappSessions.connectionId, connectionId), eq(whatsappSessions.keyId, keyId)))
        .limit(1)

      if (!row || !row.value) return null
      return JSON.parse(row.value, BufferJSON.reviver)
    } catch {
      return null
    }
  }

  const removeData = async (keyId: string) => {
    try {
      await db
        .delete(whatsappSessions)
        .where(and(eq(whatsappSessions.connectionId, connectionId), eq(whatsappSessions.keyId, keyId)))
    } catch { /* ignore */ }
  }

  // Auto-migration from legacy disk session if postgres session table has no creds yet
  const existingCredsRow = await readData('creds')
  if (!existingCredsRow) {
    const sessionDir = path.join('/home/eduardo/Naia/naia/sessions', connectionId)
    if (fs.existsSync(path.join(sessionDir, 'creds.json'))) {
      try {
        console.log(`[whatsapp-manager] Migrando sessão do disco para Postgres (${connectionId})...`)
        const files = await fs.promises.readdir(sessionDir)
        const migrationValues: Array<{ connectionId: string; keyId: string; value: string; updatedAt: Date }> = []
        for (const file of files) {
          if (!file.endsWith('.json') || file === 'contacts-cache.json') continue
          const keyId = file.replace(/\.json$/, '')
          const raw = await fs.promises.readFile(path.join(sessionDir, file), 'utf-8')
          migrationValues.push({
            connectionId,
            keyId,
            value: raw,
            updatedAt: new Date(),
          })
        }
        if (migrationValues.length > 0) {
          for (let i = 0; i < migrationValues.length; i += 50) {
            const chunk = migrationValues.slice(i, i + 50)
            await db.insert(whatsappSessions).values(chunk).onConflictDoNothing()
          }
          console.log(`[whatsapp-manager] Migração concluída: ${migrationValues.length} chaves migradas para o Postgres (${connectionId}).`)
        }
      } catch (err) {
        console.error(`[whatsapp-manager] Erro na migração do disco para Postgres (${connectionId}):`, err)
      }
    }
  }

  const creds = (await readData('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, any> = {}
          if (!ids || ids.length === 0) return data

          const keyIds = ids.map((id) => `${type}-${id}`)

          // Batch select from Postgres
          const rows = await db
            .select({ keyId: whatsappSessions.keyId, value: whatsappSessions.value })
            .from(whatsappSessions)
            .where(
              and(
                eq(whatsappSessions.connectionId, connectionId),
                inArray(whatsappSessions.keyId, keyIds),
              ),
            )

          const rowMap = new Map<string, string>()
          for (const row of rows) {
            rowMap.set(row.keyId, row.value)
          }

          await Promise.all(
            ids.map(async (id) => {
              const fullKey = `${type}-${id}`
              const rawValue = rowMap.get(fullKey)
              let value = rawValue ? JSON.parse(rawValue, BufferJSON.reviver) : null
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            }),
          )

          return data
        },
        set: async (data) => {
          const writeTasks: Array<Promise<void>> = []
          const keysToDelete: string[] = []

          for (const category in data) {
            for (const id in (data as Record<string, Record<string, any>>)[category]) {
              const value = (data as Record<string, Record<string, any>>)[category][id]
              const keyId = `${category}-${id}`
              if (value) {
                writeTasks.push(writeData(value, keyId))
              } else {
                keysToDelete.push(keyId)
              }
            }
          }

          if (keysToDelete.length > 0) {
            writeTasks.push(
              (async () => {
                await db
                  .delete(whatsappSessions)
                  .where(
                    and(
                      eq(whatsappSessions.connectionId, connectionId),
                      inArray(whatsappSessions.keyId, keysToDelete),
                    ),
                  )
              })(),
            )
          }

          await Promise.all(writeTasks)
        },
      },
    },
    saveCreds: async () => {
      return writeData(creds, 'creds')
    },
  }
}
