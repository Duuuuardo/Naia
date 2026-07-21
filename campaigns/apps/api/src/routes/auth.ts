import { Elysia } from 'elysia'
import { authPlugin } from '../plugins/auth'

// Naia não tem cadastro/login próprio — este endpoint só expõe, pro frontend,
// os claims já validados localmente via JWKS do Vianova (ver plugins/auth.ts).
export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(authPlugin)

  .get('/me', async ({ session, set }) => {
    if (!session) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }

    return {
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        picture: session.picture,
        pictureFrame: session.pictureFrame,
        emailVerified: session.emailVerified,
      },
    }
  })
