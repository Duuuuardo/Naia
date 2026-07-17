// Object storage de mídia do Campaigns (MinIO próprio — o do Vianova é
// exclusivo de avatares). Wrapper fino sobre o S3Client nativo do Bun; usado
// pela API (presign/validação) e pelo worker (bytes pra envio multipart).

// Tipo estrutural do Bun.S3Client — evita `import from 'bun'`, que quebraria o
// typecheck do web quando os tipos deste package vazam pela cadeia do Eden.
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
      endpoint: process.env.NAIA_S3_ENDPOINT ?? 'http://localhost:9102',
      bucket: process.env.NAIA_S3_BUCKET ?? 'naia-campaigns',
      accessKeyId: process.env.NAIA_S3_ACCESS_KEY ?? 'naia',
      secretAccessKey: process.env.NAIA_S3_SECRET_KEY ?? 'naia_secret_minio',
    })
  }
  return client
}

/** URL pré-assinada para o browser fazer PUT direto no MinIO. */
export function presignUpload(key: string, mimeType: string, expiresInSeconds = 900): string {
  return getClient().presign(key, { method: 'PUT', type: mimeType, expiresIn: expiresInSeconds })
}

/** URL pré-assinada de leitura (previews no wizard). */
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

/** Bytes do objeto — para envio multipart (Baileys/Telegram). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const buffer = await getClient().file(key).arrayBuffer()
  return new Uint8Array(buffer)
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().delete(key)
}
