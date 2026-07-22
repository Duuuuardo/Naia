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
      { title: 'Naia | Campanhas e atendimento no WhatsApp e Telegram' },
      {
        name: 'description',
        content:
          'Envie campanhas em massa e organize o atendimento da sua equipe no WhatsApp e Telegram com os produtos Naia.',
      },
      { name: 'theme-color', content: '#DD5973' },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Naia: campanhas e atendimento multicanal' },
      {
        property: 'og:description',
        content:
          'Envie campanhas em massa e organize o atendimento da sua equipe no WhatsApp e Telegram.',
      },
      { property: 'og:url', content: 'https://naia.website' },
      { property: 'og:locale', content: 'pt_BR' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: 'Naia: campanhas e atendimento multicanal' },
      {
        name: 'twitter:description',
        content:
          'Envie campanhas em massa e organize o atendimento da sua equipe no WhatsApp e Telegram.',
      },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/favicon.png?v=2' },
      { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico?v=2' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=2' },
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
          description: 'Produtos para campanhas em massa e atendimento no WhatsApp e Telegram.',
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
