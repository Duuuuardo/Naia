import { db, members, entitlements, workspaces } from '@naia/db'
import { eq, and } from 'drizzle-orm'
import type { WorkspaceRole, Entitlements, RolePermissionMap } from '@naia/schemas'
import { effectivePermissions } from '@naia/schemas'
import type { VianovaUser } from '@naia/vianova-auth'

export type WorkspaceContext = {
  userId: string
  role: WorkspaceRole
  entitlements: Entitlements
  permissions: RolePermissionMap
}

export const FREE_ENTITLEMENTS: Entitlements = {
  tier: 'free',
  status: 'active',
  seats: 1,
  connections: 1,
  creditsPerCycle: 3,
  creditsBalance: 3,
  campaignsPerMonth: 1,
  automations: 0,
  storageBytes: 104_857_600,
  maxFileSizeBytes: 5_242_880,
}

// Resolução local de acesso a workspace — antes era uma chamada cross-service
// pro core-api; agora Naia é dono completo do seu tenant model (workspace,
// membros, entitlement sincronizado), só a identidade da pessoa vem de fora.
export async function resolveWorkspaceAccess(
  session: VianovaUser | null,
  workspaceId: string,
): Promise<WorkspaceContext | null> {
  if (!session) return null

  const [member] = await db
    .select({ role: members.role, rolePermissions: workspaces.rolePermissions })
    .from(members)
    .innerJoin(workspaces, eq(members.workspaceId, workspaces.id))
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, session.userId)))
    .limit(1)

  if (!member) return null

  const permissions = effectivePermissions(member.role, member.rolePermissions)

  const [ent] = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.workspaceId, workspaceId))
    .limit(1)

  if (!ent || ent.tier === 'free' || ent.tier === 'none') {
    return {
      userId: session.userId,
      role: member.role,
      entitlements: FREE_ENTITLEMENTS,
      permissions,
    }
  }

  return {
    userId: session.userId,
    role: member.role,
    permissions,
    entitlements: {
      tier: ent.tier,
      status: ent.status,
      seats: ent.seats,
      connections: ent.connections,
      creditsPerCycle: ent.creditsPerCycle,
      creditsBalance: ent.creditsBalance,
      campaignsPerMonth: ent.campaignsPerMonth,
      automations: ent.automations,
      storageBytes: ent.storageBytes,
      maxFileSizeBytes: ent.maxFileSizeBytes,
    },
  }
}
