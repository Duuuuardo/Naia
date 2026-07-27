import { db } from '@crm/db'
import { workspaceManagers, workspaces, entitlements } from '@crm/db/schema'
import { eq, and } from 'drizzle-orm'
import { effectivePermissions, type ManagerRole, type RolePermissionMap } from '@crm/schemas'
import type { VianovaUser } from '@naia/vianova-auth'
import type { EntitlementRow, Workspace } from '@crm/db/schema'

export interface ManagerAccess {
  userId: string
  workspace: Workspace
  role: ManagerRole
  entitlements: EntitlementRow
  // Permissões efetivas do papel (defaults + overrides de workspaces.rolePermissions).
  permissions: RolePermissionMap
}

// Resolve o acesso de um manager (owner/admin) a um workspace.
// Retorna null se não autenticado ou não for manager do workspace.
export const resolveManagerAccess = async (
  session: VianovaUser | null,
  workspaceId: string,
): Promise<ManagerAccess | null> => {
  if (!session) return null

  const [manager] = await db
    .select()
    .from(workspaceManagers)
    .where(and(eq(workspaceManagers.workspaceId, workspaceId), eq(workspaceManagers.vianovaUserId, session.userId)))
    .limit(1)

  if (!manager) return null

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
  if (!workspace) return null

  const [ent] = await db.select().from(entitlements).where(eq(entitlements.workspaceId, workspaceId)).limit(1)
  if (!ent) return null

  return {
    userId: session.userId,
    workspace,
    role: manager.role,
    entitlements: ent,
    permissions: effectivePermissions(manager.role, workspace.rolePermissions),
  }
}
