import { Elysia, t } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { db } from '@crm/db'
import { agents, agentInviteTokens, agentSessions, workspaces } from '@crm/db/schema'
import { eq, and } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import * as bcrypt from 'bcrypt'
import { authInboxPlugin } from '../plugins/auth-inbox'

const CRM_JWT_SECRET = process.env.CRM_JWT_SECRET || 'dev-secret'
const generateSid = () => randomBytes(32).toString('hex')

// Helper: generate random ID
const generateId = () => randomBytes(8).toString('hex')

export const inboxAuthRoutes = new Elysia({ name: 'inbox-auth' })
  .use(
    jwt({
      name: 'jwtInbox',
      secret: CRM_JWT_SECRET,
      schema: t.Object({
        agentId: t.String(),
        workspaceId: t.String(),
        sid: t.String(),
      }),
    }),
  )
  // Perfil fresco do agente logado (role vem sempre do banco — reflete
  // promoções/rebaixamentos sem exigir novo login).
  .use(authInboxPlugin)
  .get('/inbox/me', async ({ agent, set }) => {
    if (!agent) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    return { id: agent.id, name: agent.name, role: agent.role, workspaceId: agent.workspaceId }
  })
  .post(
    '/inbox/auth/activate',
    async ({ body }) => {
      // Activate agent account: set password using activation token.
      const { token, password, workspaceSlug } = body as {
        token: string
        password: string
        workspaceSlug: string
      }

      if (!token || !password || !workspaceSlug) {
        return { ok: false, error: 'Missing required fields' }
      }

      try {
        // Find workspace by slug
        const workspace = await db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1)
        if (workspace.length === 0) {
          return { ok: false, error: 'Workspace not found' }
        }

        // Find activation token
        const inviteTokenRow = await db
          .select()
          .from(agentInviteTokens)
          .where(eq(agentInviteTokens.token, token))
          .limit(1)

        if (inviteTokenRow.length === 0) {
          return { ok: false, error: 'Invalid activation token' }
        }

        const inviteToken = inviteTokenRow[0]

        // Check expiration
        if (inviteToken.expiresAt < new Date()) {
          return { ok: false, error: 'Activation token expired' }
        }

        if (inviteToken.usedAt) {
          return { ok: false, error: 'Activation token already used' }
        }

        // Get agent
        const agent = await db.select().from(agents).where(eq(agents.id, inviteToken.agentId)).limit(1)
        if (agent.length === 0) {
          return { ok: false, error: 'Agent not found' }
        }

        const agentRow = agent[0]

        // Verify workspace matches
        if (agentRow.workspaceId !== workspace[0].id) {
          return { ok: false, error: 'Workspace mismatch' }
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12)

        // Update agent: set password and activated_at
        await db
          .update(agents)
          .set({
            passwordHash,
            activatedAt: new Date(),
          })
          .where(eq(agents.id, inviteToken.agentId))

        // Mark token as used
        await db
          .update(agentInviteTokens)
          .set({
            usedAt: new Date(),
          })
          .where(eq(agentInviteTokens.id, inviteToken.id))

        return { ok: true, message: 'Account activated' }
      } catch (error) {
        console.error('[inbox-auth] activation failed:', error)
        return { ok: false, error: 'Failed to activate account' }
      }
    },
    {
      body: t.Object({
        token: t.String(),
        password: t.String({ minLength: 8 }),
        workspaceSlug: t.String(),
      }),
    },
  )
  .post(
    '/inbox/auth/login',
    async ({ body, jwtInbox, cookie }) => {
      // Agent login: email + password.
      const { email, password, workspaceSlug } = body as {
        email: string
        password: string
        workspaceSlug: string
      }

      if (!email || !password || !workspaceSlug) {
        return { ok: false, error: 'Missing required fields' }
      }

      try {
        // Find workspace by slug
        const workspace = await db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1)
        if (workspace.length === 0) {
          return { ok: false, error: 'Workspace not found' }
        }

        // Find agent
        const agent = await db
          .select()
          .from(agents)
          .where(and(eq(agents.workspaceId, workspace[0].id), eq(agents.email, email.toLowerCase())))
          .limit(1)

        if (agent.length === 0) {
          return { ok: false, error: 'Invalid credentials' }
        }

        const agentRow = agent[0]

        // Check if activated
        if (!agentRow.activatedAt) {
          return { ok: false, error: 'Account not activated' }
        }

        // Verify password
        const passwordValid = await bcrypt.compare(password, agentRow.passwordHash)
        if (!passwordValid) {
          return { ok: false, error: 'Invalid credentials' }
        }

        // Create session
        const sid = generateSid()
        const expirationTime = new Date()
        expirationTime.setHours(expirationTime.getHours() + 24)

        await db.insert(agentSessions).values({
          id: generateId(),
          agentId: agentRow.id,
          sid,
          createdAt: new Date(),
          expiresAt: expirationTime,
        })

        // Update last login
        await db.update(agents).set({ lastLoginAt: new Date() }).where(eq(agents.id, agentRow.id))

        // Issue JWT token
        const token = await jwtInbox.sign({
          agentId: agentRow.id,
          workspaceId: workspace[0].id,
          sid,
        })

        // Set httpOnly cookie
        cookie.crm_inbox_session.set({
          value: token,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24, // 24h
          path: '/',
        })

        return {
          ok: true,
          agent: {
            id: agentRow.id,
            name: agentRow.name,
            role: agentRow.role,
          },
          token,
        }
      } catch (error) {
        console.error('[inbox-auth] login failed:', error)
        return { ok: false, error: 'Failed to login' }
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String(),
        workspaceSlug: t.String(),
      }),
    },
  )
