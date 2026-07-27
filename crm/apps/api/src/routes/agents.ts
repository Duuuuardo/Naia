import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import { agents } from '@crm/db/schema'
import { eq, and, count } from 'drizzle-orm'
import { canAddAgent } from '@crm/entitlements'
import { authManagementPlugin } from '../plugins/auth-management'
import { resolveManagerAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'
import { sendAgentActivation } from '../lib/agent-activation'

export const agentsRoutes = new Elysia({ name: 'agents' })
  .use(authManagementPlugin)

  // GET /workspaces/:workspaceId/agents
  .get('/workspaces/:workspaceId/agents', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.agents) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        email: agents.email,
        role: agents.role,
        activatedAt: agents.activatedAt,
        lastLoginAt: agents.lastLoginAt,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.workspaceId, params.workspaceId))
      .orderBy(agents.createdAt)

    return { agents: rows }
  })

  // POST /workspaces/:workspaceId/agents — Owner/Admin cria um agente.
  .post(
    '/workspaces/:workspaceId/agents',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }
      if (!ctx.permissions.agents) {
        set.status = 403
        return { message: 'Seu papel não tem acesso a esta área do workspace.' }
      }

      // Entitlement: limite de agentes.
      const [{ count: agentCount }] = await db
        .select({ count: count() })
        .from(agents)
        .where(eq(agents.workspaceId, params.workspaceId))

      const check = canAddAgent(ctx.entitlements, agentCount)
      if (!check.allowed) {
        set.status = 403
        return { message: check.reason, upgradeUrl: '/billing' }
      }

      // Email único no workspace.
      const [existingEmail] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.workspaceId, params.workspaceId), eq(agents.email, body.email.toLowerCase())))
        .limit(1)
      if (existingEmail) {
        set.status = 409
        return { message: 'Este email já está em uso neste workspace.' }
      }

      const agentId = generateId()
      await db.insert(agents).values({
        id: agentId,
        workspaceId: params.workspaceId,
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: '', // preenchido na ativação
        role: body.role ?? 'agent',
        activatedAt: null,
      })

      try {
        await sendAgentActivation({
          agentId,
          agentName: body.name,
          agentEmail: body.email,
          workspaceName: ctx.workspace.name,
          workspaceSlug: ctx.workspace.slug,
        })
      } catch (error) {
        await db.delete(agents).where(eq(agents.id, agentId))
        console.error('[agents] falha ao enviar email de ativação:', error)
        set.status = 502
        return { message: 'Não foi possível enviar o email de ativação. Tente novamente.' }
      }

      return {
        agent: { id: agentId, name: body.name, email: body.email.toLowerCase(), role: body.role ?? 'agent' },
        activationEmailSent: true as const,
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        email: t.String({ format: 'email' }),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('agent')])),
      }),
    },
  )

  // POST /workspaces/:workspaceId/agents/:agentId/resend-activation
  .post('/workspaces/:workspaceId/agents/:agentId/resend-activation', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.agents) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, params.agentId), eq(agents.workspaceId, params.workspaceId)))
      .limit(1)
    if (!agent) {
      set.status = 404
      return { message: 'Agente não encontrado.' }
    }
    if (agent.activatedAt) {
      set.status = 400
      return { message: 'Este agente já ativou a conta.' }
    }

    try {
      await sendAgentActivation({
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        workspaceName: ctx.workspace.name,
        workspaceSlug: ctx.workspace.slug,
      })
    } catch (error) {
      console.error('[agents] falha ao reenviar ativação:', error)
      set.status = 502
      return { message: 'Não foi possível reenviar o email. Tente novamente.' }
    }

    return { activationEmailSent: true as const }
  })

  // DELETE /workspaces/:workspaceId/agents/:agentId
  .delete('/workspaces/:workspaceId/agents/:agentId', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.agents) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    await db.delete(agents).where(and(eq(agents.id, params.agentId), eq(agents.workspaceId, params.workspaceId)))
    return { message: 'Agente removido.' }
  })
