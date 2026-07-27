// Auth state do Baileys persistido no Postgres (tabela whatsapp_sessions).
// Portado do session-host do Campaigns, adaptado: aqui `value` é jsonb (lá era
// texto), então serializamos para um objeto JSON-safe em vez de string crua.
import { db, whatsappSessions } from '@crm/db'
import { eq, and, inArray } from 'drizzle-orm'
import type { AuthenticationState } from '@whiskeysockets/baileys'

function loadBaileys() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@whiskeysockets/baileys') as typeof import('@whiskeysockets/baileys')
}

// BufferJSON.replacer converte Buffers/Uint8Arrays em objetos JSON-safe; o
// parse/stringify duplo garante que só JSON puro chegue à coluna jsonb.
function toJsonValue(data: unknown, replacer: (key: string, value: unknown) => unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data, replacer)) as Record<string, unknown>
}

export async function usePostgresAuthState(connectionId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
}> {
  const { initAuthCreds, BufferJSON, proto } = loadBaileys()

  const writeData = async (data: unknown, keyId: string) => {
    const value = toJsonValue(data, BufferJSON.replacer)
    await db
      .insert(whatsappSessions)
      .values({ connectionId, keyId, value })
      .onConflictDoUpdate({
        target: [whatsappSessions.connectionId, whatsappSessions.keyId],
        set: { value },
      })
  }

  const readData = async (keyId: string): Promise<any | null> => {
    try {
      const [row] = await db
        .select({ value: whatsappSessions.value })
        .from(whatsappSessions)
        .where(and(eq(whatsappSessions.connectionId, connectionId), eq(whatsappSessions.keyId, keyId)))
        .limit(1)

      if (!row || row.value == null) return null
      return JSON.parse(JSON.stringify(row.value), BufferJSON.reviver)
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

  const creds = (await readData('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, any> = {}
          if (!ids || ids.length === 0) return data

          const keyIds = ids.map((id) => `${type}-${id}`)

          // Leitura em lote no Postgres
          const rows = await db
            .select({ keyId: whatsappSessions.keyId, value: whatsappSessions.value })
            .from(whatsappSessions)
            .where(
              and(
                eq(whatsappSessions.connectionId, connectionId),
                inArray(whatsappSessions.keyId, keyIds),
              ),
            )

          const rowMap = new Map<string, unknown>()
          for (const row of rows) {
            rowMap.set(row.keyId, row.value)
          }

          for (const id of ids) {
            const rawValue = rowMap.get(`${type}-${id}`)
            let value = rawValue != null ? JSON.parse(JSON.stringify(rawValue), BufferJSON.reviver) : null
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value)
            }
            data[id] = value
          }

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
