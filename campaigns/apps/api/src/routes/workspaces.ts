import { Elysia, t } from 'elysia'
import { db, workspaces, members, entitlements } from '@naia/db'
import { eq } from 'drizzle-orm'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from '@naia/schemas'
import type { RolePermissionMap, WorkspaceRolePermissions } from '@naia/schemas'
import { authPlugin } from '../plugins/auth'
import { resolveWorkspaceAccess } from '../lib/workspace-auth'
import { generateId } from '../lib/crypto'

const VIANOVA_API_URL = process.env.VIANOVA_API_URL ?? 'http://localhost:5000'
const VIANOVA_INTERNAL_SECRET = process.env.VIANOVA_INTERNAL_SECRET ?? 'vianova-internal-secret'
const PRODUCT_SLUG = 'naia'

async function ensureVianovaFreeSubscription(workspace: { id: string; name: string; ownerUserId: string; organizationId: string | null }) {
  try {
    await fetch(`${VIANOVA_API_URL}/internal/billing/ensure-free-subscription`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': VIANOVA_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        product_slug: PRODUCT_SLUG,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        owner_user_id: workspace.ownerUserId,
        organization_id: workspace.organizationId,
      }),
    })
  } catch (err) {
    console.error('[naia:workspaces] falha ao garantir subscription free no Vianova:', err)
  }
}

// Avatar do workspace entra como data URL já redimensionada no cliente —
// limite defensivo pra não inflar a linha no banco.
const MAX_AVATAR_LENGTH = 400_000

function isValidAvatar(value: string): boolean {
  return value.startsWith('data:image/') && value.length <= MAX_AVATAR_LENGTH
}

const permissionMapSchema = t.Object(
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, t.Boolean()])) as Record<
    (typeof PERMISSION_KEYS)[number],
    ReturnType<typeof t.Boolean>
  >,
)

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export const workspaceRoutes = new Elysia()
  .use(authPlugin)

  // GET /workspaces — workspaces do usuário autenticado, pra tela de seletor.
  .get('/workspaces', async ({ session, set }) => {
    if (!session) { set.status = 401; return { message: 'Não autenticado.' } }

    const rows = await db
      .select({ workspace: workspaces, role: members.role, entitlements: entitlements })
      .from(members)
      .innerJoin(workspaces, eq(members.workspaceId, workspaces.id))
      .leftJoin(entitlements, eq(workspaces.id, entitlements.workspaceId))
      .where(eq(members.userId, session.userId))
      .orderBy(workspaces.createdAt)

    return { workspaces: rows.map((r) => ({ ...r.workspace, role: r.role, entitlements: r.entitlements ?? null })) }
  })

  // POST /workspaces — quem cria vira Owner automaticamente.
  .post(
    '/workspaces',
    async ({ session, body, set }) => {
      if (!session) { set.status = 401; return { message: 'Não autenticado.' } }

      const baseSlug = slugify(body.name) || 'workspace'
      let slug = baseSlug
      let suffix = 1
      while (true) {
        const [existing] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
        if (!existing) break
        slug = `${baseSlug}-${++suffix}`
      }

      const id = generateId()
      await db.insert(workspaces).values({
        id,
        name: body.name,
        slug,
        ownerUserId: session.userId,
        organizationId: body.organizationId ?? null,
      })

      await db.insert(members).values({
        id: generateId(),
        workspaceId: id,
        userId: session.userId,
        role: 'owner',
      })

      await db.insert(entitlements).values({
        workspaceId: id,
        tier: 'free',
        status: 'active',
        seats: 1,
        connections: 1,
        creditsPerCycle: 3,
        creditsBalance: 3,
        campaignsPerMonth: 1,
        automations: 0,
      })

      // Registra o workspace no Vianova para que entitlements (storage, addons,
      // etc.) sejam sincronizados a partir do catálogo de planos.
      await ensureVianovaFreeSubscription({
        id,
        name: body.name,
        ownerUserId: session.userId,
        organizationId: body.organizationId ?? null,
      })

      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1)
      const [entitlement] = await db.select().from(entitlements).where(eq(entitlements.workspaceId, id)).limit(1)
      return { workspace: { ...workspace, role: 'owner' as const, entitlements: entitlement ?? null } }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        organizationId: t.Optional(t.String()),
      }),
    },
  )

  // GET /workspaces/:workspaceId — detalhe + role + entitlement + permissões
  // efetivas do papel (pra gate de UI).
  .get('/workspaces/:workspaceId', async ({ session, params, set }) => {
    const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
    if (!ctx) { set.status = 401; return { message: 'Não autenticado ou sem acesso a este workspace.' } }

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
    if (!workspace) { set.status = 404; return { message: 'Workspace não encontrado.' } }

    return { workspace, role: ctx.role, entitlements: ctx.entitlements, permissions: ctx.permissions }
  })

  // PATCH /workspaces/:workspaceId — configurações do workspace (requer a
  // permissão "settings"; membros só se a matriz do workspace liberar).
  .patch(
    '/workspaces/:workspaceId',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado ou sem acesso a este workspace.' } }
      if (!ctx.permissions.settings) { set.status = 403; return { message: 'Seu papel não tem acesso às configurações do workspace.' } }

      if (body.avatarUrl && !isValidAvatar(body.avatarUrl)) {
        set.status = 400
        return { message: 'Avatar inválido — use uma imagem de até 300 KB.' }
      }

      await db
        .update(workspaces)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          ...(body.location !== undefined ? { location: body.location || null } : {}),
          ...(body.industry !== undefined ? { industry: body.industry || null } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, params.workspaceId))
      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1)
      return { workspace }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.String()),
        location: t.Optional(t.String()),
        industry: t.Optional(t.String()),
        // Data URL pequena ou string vazia pra remover.
        avatarUrl: t.Optional(t.String()),
      }),
    },
  )

  // GET /workspaces/:workspaceId/permissions — matriz por papel (admin/member)
  // com os defaults aplicados; visível pra quem gerencia membros.
  .get('/workspaces/:workspaceId/permissions', async ({ session, params, set }) => {
    const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
    if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
    if (!ctx.permissions.members) { set.status = 403; return { message: 'Seu papel não tem acesso a esta área do workspace.' } }

    const [workspace] = await db
      .select({ rolePermissions: workspaces.rolePermissions })
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .limit(1)

    const overrides = workspace?.rolePermissions ?? null
    return {
      permissions: {
        admin: { ...DEFAULT_ROLE_PERMISSIONS.admin, ...(overrides?.admin ?? {}) },
        member: { ...DEFAULT_ROLE_PERMISSIONS.member, ...(overrides?.member ?? {}) },
      } satisfies WorkspaceRolePermissions,
      canEdit: ctx.role === 'owner',
    }
  })

  // PATCH /workspaces/:workspaceId/permissions — só o Owner redesenha a matriz.
  .patch(
    '/workspaces/:workspaceId/permissions',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (ctx.role !== 'owner') { set.status = 403; return { message: 'Apenas o Owner pode alterar permissões.' } }

      await db
        .update(workspaces)
        .set({
          rolePermissions: {
            admin: body.admin as RolePermissionMap,
            member: body.member as RolePermissionMap,
          },
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, params.workspaceId))

      return { updated: true as const }
    },
    {
      body: t.Object({
        admin: permissionMapSchema,
        member: permissionMapSchema,
      }),
    },
  )

  // GET /workspaces/:workspaceId/notification-preferences — só Owner vê/editou.
  .get('/workspaces/:workspaceId/notification-preferences', async ({ session, params, set }) => {
    const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
    if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
    if (ctx.role !== 'owner') { set.status = 403; return { message: 'Apenas o Owner pode ver as preferências de notificação.' } }

    const [workspace] = await db
      .select({ notificationPreferences: workspaces.notificationPreferences })
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .limit(1)

    const defaults = {
      emailOnCampaignCompleted: true,
      emailOnCampaignFailed: true,
      emailOnCreditsExhausted: true,
      emailOnConnectionDisconnected: true,
    }
    return { preferences: { ...defaults, ...(workspace?.notificationPreferences ?? {}) } }
  })

  // PATCH /workspaces/:workspaceId/notification-preferences — só Owner altera.
  .patch(
    '/workspaces/:workspaceId/notification-preferences',
    async ({ session, params, body, set }) => {
      const ctx = await resolveWorkspaceAccess(session, params.workspaceId)
      if (!ctx) { set.status = 401; return { message: 'Não autenticado.' } }
      if (ctx.role !== 'owner') { set.status = 403; return { message: 'Apenas o Owner pode alterar as preferências de notificação.' } }

      const [workspace] = await db
        .select({ notificationPreferences: workspaces.notificationPreferences })
        .from(workspaces)
        .where(eq(workspaces.id, params.workspaceId))
        .limit(1)

      const current = workspace?.notificationPreferences ?? {}
      const next = {
        emailOnCampaignCompleted: body.emailOnCampaignCompleted ?? current.emailOnCampaignCompleted ?? true,
        emailOnCampaignFailed: body.emailOnCampaignFailed ?? current.emailOnCampaignFailed ?? true,
        emailOnCreditsExhausted: body.emailOnCreditsExhausted ?? current.emailOnCreditsExhausted ?? true,
        emailOnConnectionDisconnected: body.emailOnConnectionDisconnected ?? current.emailOnConnectionDisconnected ?? true,
      }

      await db
        .update(workspaces)
        .set({ notificationPreferences: next, updatedAt: new Date() })
        .where(eq(workspaces.id, params.workspaceId))

      return { preferences: next }
    },
    {
      body: t.Object({
        emailOnCampaignCompleted: t.Optional(t.Boolean()),
        emailOnCampaignFailed: t.Optional(t.Boolean()),
        emailOnCreditsExhausted: t.Optional(t.Boolean()),
        emailOnConnectionDisconnected: t.Optional(t.Boolean()),
      }),
    },
  )
