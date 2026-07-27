// URL do inbox de um workspace. Em produção é o subdomínio wildcard
// [slug].crm.naia.website; em dev usa [slug].localhost (browsers resolvem
// *.localhost para 127.0.0.1 automaticamente).
export const buildInboxUrl = (slug: string, path = ''): string => {
  const isProduction = process.env.NODE_ENV === 'production'
  if (isProduction) {
    return `https://${slug}.crm.naia.website${path}`
  }
  const port = process.env.CRM_WEB_PORT ?? '3002'
  return `http://${slug}.localhost:${port}${path}`
}
