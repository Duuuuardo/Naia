
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[@naia/storage] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

type S3ClientLike = {
  presign(key: string, options: { method: 'PUT' | 'GET'; type?: string; expiresIn?: number }): string
  exists(key: string): Promise<boolean>
  stat(key: string): Promise<{ size: number }>
  file(key: string): { arrayBuffer(): Promise<ArrayBuffer> }
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
    if (!bun) throw new Error('@naia/storage requer o runtime Bun')
    client = new bun.S3Client({
      endpoint: requireEnv('NAIA_S3_ENDPOINT'),
      bucket: requireEnv('NAIA_S3_BUCKET'),
      accessKeyId: requireEnv('NAIA_S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('NAIA_S3_SECRET_KEY'),
    })
  }
  return client
}

export function presignUpload(key: string, mimeType: string, expiresInSeconds = 900): string {
  return getClient().presign(key, { method: 'PUT', type: mimeType, expiresIn: expiresInSeconds })
}

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

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const buffer = await getClient().file(key).arrayBuffer()
  return new Uint8Array(buffer)
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().delete(key)
}
