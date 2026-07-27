// Object storage de arquivos do CRM (MinIO próprio — o do Vianova é exclusivo
// de avatares). Wrapper fino sobre o S3Client nativo do Bun; usado pela API
// (presign/validação) e pelo session-host/worker (bytes pra envio ao canal).
// Espelhado de @naia/storage (Campaigns) — produtos nunca compartilham código.

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[@crm/storage] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

// Tipo estrutural do Bun.S3Client — evita `import from 'bun'`, que quebraria o
// typecheck do web quando os tipos deste package vazam pela cadeia do Eden.
type S3ClientLike = {
  presign(key: string, options: { method: 'PUT' | 'GET'; type?: string; expiresIn?: number }): string
  exists(key: string): Promise<boolean>
  stat(key: string): Promise<{ size: number }>
  file(key: string): {
    arrayBuffer(): Promise<ArrayBuffer>
    write(data: Uint8Array, options?: { type?: string }): Promise<unknown>
  }
  delete(key: string): Promise<void>
}

type BunS3 = { S3Client: new (options: {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}) => S3ClientLike }

let client: S3ClientLike | null = null

function getClient(): S3ClientLike {
  if (!client) {
    const bun = (globalThis as { Bun?: BunS3 }).Bun
    if (!bun) throw new Error('@crm/storage requer o runtime Bun')
    client = new bun.S3Client({
      endpoint: requireEnv('CRM_S3_ENDPOINT'),
      bucket: requireEnv('CRM_S3_BUCKET'),
      accessKeyId: requireEnv('CRM_S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('CRM_S3_SECRET_KEY'),
    })
  }
  return client
}

/** URL pré-assinada para o browser fazer PUT direto no MinIO. */
export function presignUpload(key: string, mimeType: string, expiresInSeconds = 900): string {
  return getClient().presign(key, { method: 'PUT', type: mimeType, expiresIn: expiresInSeconds })
}

/** URL pré-assinada de leitura (preview de anexos no inbox). */
export function presignDownload(key: string, expiresInSeconds = 3600): string {
  return getClient().presign(key, { method: 'GET', expiresIn: expiresInSeconds })
}

export async function objectExists(key: string): Promise<boolean> {
  return getClient().exists(key)
}

export async function objectSize(key: string): Promise<number> {
  const stat = await getClient().stat(key)
  return stat.size
}

/** Bytes do objeto — para envio ao canal (Baileys/Telegram). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const buffer = await getClient().file(key).arrayBuffer()
  return new Uint8Array(buffer)
}

/** Escreve bytes no objeto — mídia inbound baixada do canal pelo session-host. */
export async function putObject(key: string, data: Uint8Array, mimeType?: string): Promise<void> {
  await getClient().file(key).write(data, mimeType ? { type: mimeType } : undefined)
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().delete(key)
}
