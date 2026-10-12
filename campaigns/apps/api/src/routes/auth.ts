import { Elysia } from 'elysia'
import { authPlugin } from '../plugins/auth'

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
