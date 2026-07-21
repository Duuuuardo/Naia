import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@tanstack/react-router'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Naia — Campanhas e CRM para comunicação multicanal' },
      {
        name: 'description',
        content:
          'Campanhas em massa e atendimento multicanal no WhatsApp e Telegram. Dois produtos, uma marca: Naia.',
      },
      { name: 'theme-color', content: '#DD5973' },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Naia' },
      {
        property: 'og:description',
        content:
          'Campanhas em massa e atendimento multicanal no WhatsApp e Telegram. Dois produtos, uma marca: Naia.',
      },
      { property: 'og:url', content: 'https://naia.website' },
      { property: 'og:image', content: 'https://naia.website/og-image.png' },
      { property: 'og:locale', content: 'pt_BR' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Naia' },
      {
        name: 'twitter:description',
        content:
          'Campanhas em massa e atendimento multicanal no WhatsApp e Telegram. Dois produtos, uma marca: Naia.',
      },
      { name: 'twitter:image', content: 'https://naia.website/og-image.png' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      { rel: 'canonical', href: 'https://naia.website' },
    ],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Naia',
          url: 'https://naia.website',
          logo: 'https://naia.website/og-image.png',
          description: 'Campanhas em massa e atendimento multicanal no WhatsApp e Telegram.',
        }),
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
