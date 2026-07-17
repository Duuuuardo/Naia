import { Elysia } from 'elysia'
import { db, revokedSessions, directoryUsers } from '@naia/db'
import { eq } from 'drizzle-orm'
import { verifyUserToken, type VianovaUser } from '@naia/vianova-auth'

// Autenticação de usuário: JWT do Vianova, validado 100% local via JWKS
// (packages/vianova-auth) — sem round-trip ao Vianova no caminho quente.
// O único lookup local é a checagem de revogação (single sign-out imediato
// via POST /internal/session-revoked, ver routes/internal.ts).
export const authPlugin = new Elysia().derive({ as: 'global' }, async ({ headers }) => {
  const authHeader = headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!token) return { session: null as VianovaUser | null, rawToken: null as string | null }

  const user = await verifyUserToken(token)
  if (!user) return { session: null as VianovaUser | null, rawToken: null as string | null }

  const [revoked] = await db
    .select({ sid: revokedSessions.sid })
    .from(revokedSessions)
    .where(eq(revokedSessions.sid, user.sid))
    .limit(1)

  if (revoked) return { session: null as VianovaUser | null, rawToken: null as string | null }

  // Cache de exibição (best-effort) — não bloqueia a request em caso de erro.
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
