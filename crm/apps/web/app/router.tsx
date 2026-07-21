import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { ErrorPage, NotFoundPage } from './components/error-pages'
import { routeTree } from './routeTree.gen'

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: ErrorPage,
  })
}

export function getRouter() {
  return createRouter()
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
