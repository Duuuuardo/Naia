import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import {
  workspaces,
  workspaceManagers,
  entitlements,
  agents,
  connections,
  contacts,
  contactIdentities,
  conversations,
} from '@crm/db/schema'
import { and, count, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { effectivePermissions, PERMISSION_KEYS } from '@crm/schemas'
import type { RolePermissionMap } from '@crm/schemas'
import { authManagementPlugin } from '../plugins/auth-management'
import { resolveManagerAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'
import { sendAgentActivation } from '../lib/agent-activation'

const MAX_AVATAR_LENGTH = 400_000

function isValidAvatar(value: string): boolean {
  return value.startsWith('data:image/') && value.length <= MAX_AVATAR_LENGTH
}

// Helper: slugify workspace name
const slugify = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .slice(0, 50)
}

// Helper: ensure unique slug
const ensureUniqueSlug = async (baseSlug: string, attempt = 0): Promise<string> => {
  const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`
  const existing = await db.select().from(workspaces).where(eq(workspaces.slug, candidate)).limit(1)
  return existing.length > 0 ? ensureUniqueSlug(baseSlug, attempt + 1) : candidate
}

const permissionMapSchema = t.Object(
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, t.Boolean()])) as Record<
    (typeof PERMISSION_KEYS)[number],
    ReturnType<typeof t.Boolean>
  >,
)

export const workspacesRoutes = new Elysia({ name: 'workspaces' })
  .use(authManagementPlugin)

  // GET /workspaces — lista os workspaces em que o usuário é manager.
  .get('/workspaces', async ({ user, set }) => {
    if (!user) {
      set.status = 401
      return { message: 'Não autenticado.' }
    }
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        avatarUrl: workspaces.avatarUrl,
        role: workspaceManagers.role,
        plan: entitlements.plan,
        status: entitlements.status,
      })
      .from(workspaceManagers)
      .innerJoin(workspaces, eq(workspaceManagers.workspaceId, workspaces.id))
      .leftJoin(entitlements, eq(entitlements.workspaceId, workspaces.id))
      .where(eq(workspaceManagers.vianovaUserId, user.userId))
      .orderBy(workspaces.createdAt)

    return { workspaces: rows }
  })

  // GET /workspaces/:workspaceId — detalhes do workspace (para o painel).
  .get('/workspaces/:workspaceId', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    return {
      workspace: ctx.workspace,
      role: ctx.role,
      entitlements: {
        plan: ctx.entitlements.plan,
        status: ctx.entitlements.status,
        agentsLimit: ctx.entitlements.agentsLimit,
        connectionsLimit: ctx.entitlements.connectionsLimit,
        activeConversationsLimit: ctx.entitlements.activeConversationsLimit,
        managersLimit: ctx.entitlements.managersLimit,
      },
      permissions: ctx.permissions,
    }
  })

  // GET /workspaces/:workspaceId/dashboard — visão operacional do painel.
  .get('/workspaces/:workspaceId/dashboard', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }

    const [
      agentTotals,
      activeAgentTotals,
      connectionTotals,
      activeConnectionTotals,
      conversationTotals,
      conversationStatusRows,
      unassignedTotals,
      recentConversations,
    ] = await Promise.all([
      db.select({ value: count() }).from(agents).where(eq(agents.workspaceId, params.workspaceId)),
      db
        .select({ value: count() })
        .from(agents)
        .where(and(eq(agents.workspaceId, params.workspaceId), isNotNull(agents.activatedAt))),
      db.select({ value: count() }).from(connections).where(eq(connections.workspaceId, params.workspaceId)),
      db
        .select({ value: count() })
        .from(connections)
        .where(and(eq(connections.workspaceId, params.workspaceId), eq(connections.status, 'active'))),
      db
        .select({ value: count() })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, params.workspaceId), ne(conversations.status, 'resolved'))),
      db
        .select({ status: conversations.status, value: count() })
        .from(conversations)
        .where(eq(conversations.workspaceId, params.workspaceId))
        .groupBy(conversations.status),
      db
        .select({ value: count() })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, params.workspaceId),
            eq(conversations.status, 'open'),
            isNull(conversations.assignedAgentId),
          ),
        ),
      db
        .select({
          id: conversations.id,
          status: conversations.status,
          assignedAgentId: conversations.assignedAgentId,
          updatedAt: conversations.updatedAt,
          contactName: contacts.name,
          // Canal de origem sai da identity primária do contato.
          originChannel: contactIdentities.channelType,
        })
        .from(conversations)
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .leftJoin(
          contactIdentities,
          and(eq(contactIdentities.contactId, contacts.id), eq(contactIdentities.isPrimary, true)),
        )
        .where(eq(conversations.workspaceId, params.workspaceId))
        .orderBy(desc(conversations.updatedAt))
        .limit(5),
    ])

    const conversationsByStatus = {
      open: 0,
      assigned: 0,
      pending: 0,
      resolved: 0,
    }
    for (const row of conversationStatusRows) {
      conversationsByStatus[row.status] = Number(row.value)
    }

    return {
      summary: {
        agentsCount: Number(agentTotals[0]?.value ?? 0),
        activeAgentsCount: Number(activeAgentTotals[0]?.value ?? 0),
        connectionsCount: Number(connectionTotals[0]?.value ?? 0),
        activeConnectionsCount: Number(activeConnectionTotals[0]?.value ?? 0),
        activeConversationsCount: Number(conversationTotals[0]?.value ?? 0),
        unassignedConversationsCount: Number(unassignedTotals[0]?.value ?? 0),
      },
      conversationsByStatus,
      recentConversations,
    }
  })

  .post(
  '/workspaces',
  async ({ body, user }) => {
    // Create a new workspace.
    // User must be authenticated (Vianova JWT).
    if (!user) {
      return { ok: false, error: 'Unauthorized' }
    }

    const { name } = body as { name: string }

    if (!name || name.trim().length === 0) {
      return { ok: false, error: 'Workspace name is required' }
    }

    try {
      const workspaceId = generateId()
      const slug = await ensureUniqueSlug(slugify(name))

      // Create workspace
      await db.insert(workspaces).values({
        id: workspaceId,
        name: name.trim(),
        slug,
        createdAt: new Date(),
      })

      // Add owner to workspace_managers
      await db.insert(workspaceManagers).values({
        id: generateId(),
        workspaceId,
        vianovaUserId: user.userId,
        role: 'owner',
        name: user.name,
        email: user.email,
        pictureUrl: user.picture,
        createdAt: new Date(),
      })

      // Create entitlement (free plan)
      await db.insert(entitlements).values({
        workspaceId,
        plan: 'free',
        status: 'active',
        agentsLimit: 2,
        connectionsLimit: 1,
        activeConversationsLimit: 200,
        updatedAt: new Date(),
      })

      // Auto-create owner's agent account for inbox access
      const agentId = generateId()
      await db.insert(agents).values({
        id: agentId,
        workspaceId,
        name: user.name,
        email: user.email.toLowerCase(),
        passwordHash: '', // preenchido na ativação
        role: 'superadmin',
        activatedAt: null,
      })

      // Envia email de ativação (best-effort: não bloqueia a criação do workspace).
      try {
        await sendAgentActivation({
          agentId,
          agentName: user.name,
          agentEmail: user.email,
          workspaceName: name.trim(),
          workspaceSlug: slug,
        })
      } catch (error) {
        console.error('[workspaces] falha ao enviar ativação do owner (workspace criado):', error)
      }

      return {
        ok: true,
        workspace: {
          id: workspaceId,
          name,
          slug,
        },
      }
    } catch (error) {
      console.error('[workspaces] creation failed:', error)
      return { ok: false, error: 'Failed to create workspace' }
    }
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
    }),
  },
)

  // PATCH /workspaces/:workspaceId — identidade e informações básicas.
  // Requer a permissão "settings" na matriz do workspace.
  .patch(
    '/workspaces/:workspaceId',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }
      if (!ctx.permissions.settings) {
        set.status = 403
        return { message: 'Seu papel não tem acesso às configurações do workspace.' }
      }

      if (body.avatarUrl && !isValidAvatar(body.avatarUrl)) {
        set.status = 400
        return { message: 'Avatar inválido — use uma imagem de até 300 KB.' }
      }

      await db
        .update(workspaces)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          ...(body.location !== undefined ? { location: body.location || null } : {}),
          ...(body.industry !== undefined ? { industry: body.industry || null } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl || null } : {}),
        })
        .where(eq(workspaces.id, params.workspaceId))

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      return { workspace }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        description: t.Optional(t.String({ maxLength: 300 })),
        location: t.Optional(t.String({ maxLength: 120 })),
        industry: t.Optional(t.String({ maxLength: 120 })),
        avatarUrl: t.Optional(t.String()),
      }),
    },
  )

  // GET /workspaces/:workspaceId/permissions — matriz efetiva por papel
  // (defaults + overrides de workspaces.rolePermissions); visível pra quem
  // gerencia membros. canEdit indica se o chamador é Owner.
  .get('/workspaces/:workspaceId/permissions', async ({ user, params, set }) => {
    const ctx = await resolveManagerAccess(user, params.workspaceId)
    if (!ctx) {
      set.status = 403
      return { message: 'Sem acesso a este workspace.' }
    }
    if (!ctx.permissions.members) {
      set.status = 403
      return { message: 'Seu papel não tem acesso a esta área do workspace.' }
    }

    const overrides = ctx.workspace.rolePermissions
    return {
      permissions: {
        owner: effectivePermissions('owner', overrides),
        admin: effectivePermissions('admin', overrides),
      },
      canEdit: ctx.role === 'owner',
    }
  })

  // PATCH /workspaces/:workspaceId/permissions — só o Owner redesenha a matriz.
  // Owner sempre tem tudo; só o mapa do admin é editável.
  .patch(
    '/workspaces/:workspaceId/permissions',
    async ({ user, params, body, set }) => {
      const ctx = await resolveManagerAccess(user, params.workspaceId)
      if (!ctx) {
        set.status = 403
        return { message: 'Sem acesso a este workspace.' }
      }
      if (ctx.role !== 'owner') {
        set.status = 403
        return { message: 'Apenas o Owner pode alterar permissões.' }
      }

      await db
        .update(workspaces)
        .set({ rolePermissions: { admin: body.admin as RolePermissionMap } })
        .where(eq(workspaces.id, params.workspaceId))

      return { updated: true as const }
    },
    {
      body: t.Object({
        admin: permissionMapSchema,
      }),
    },
  )
