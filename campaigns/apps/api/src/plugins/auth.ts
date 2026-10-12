import { Elysia } from 'elysia'
import { db, revokedSessions, directoryUsers } from '@naia/db'
import { eq } from 'drizzle-orm'
import { verifyUserToken, type VianovaUser } from '@naia/vianova-auth'

export const authPlugin = new Elysia().derive({ as: 'global' }, async ({ headers, cookie }) => {
  let token: string | undefined
  const authHeader = headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  }

  if (!token && cookie.naia_session) {
    token = cookie.naia_session.value as string
  }

  if (!token) return { session: null as VianovaUser | null, rawToken: null as string | null }

  const user = await verifyUserToken(token)
  if (!user) return { session: null as VianovaUser | null, rawToken: null as string | null }

  const [revoked] = await db
    .select({ sid: revokedSessions.sid })
    .from(revokedSessions)
    .where(eq(revokedSessions.sid, user.sid))
    .limit(1)

  if (revoked) return { session: null as VianovaUser | null, rawToken: null as string | null }

  db.insert(directoryUsers)
    .values({
      id: user.userId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      pictureFrame: user.pictureFrame,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: directoryUsers.id,
      set: {
        email: user.email,
        name: user.name,
        picture: user.picture,
        pictureFrame: user.pictureFrame,
        updatedAt: new Date(),
      },
    })
    .catch(() => {})

  return { session: user as VianovaUser | null, rawToken: token as string | null }
})
