import { join, extname } from 'path'

const port = parseInt(process.env.PORT || '3000')
const { default: h } = await import('./dist/server/server.js')
const clientDir = new URL('./dist/client', import.meta.url).pathname

const MIME = {
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.html':  'text/html; charset=utf-8',
  '.json':  'application/json',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
}

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    const file = Bun.file(join(clientDir, pathname))
    if (await file.exists()) {
      const ct = MIME[extname(pathname)] ?? 'application/octet-stream'
      return new Response(file, { headers: { 'Content-Type': ct } })
    }
    return h.fetch(req)
  },
})

console.log(`Listening on port ${port}`)
