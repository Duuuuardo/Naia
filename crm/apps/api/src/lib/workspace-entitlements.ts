import { db } from '@crm/db'
import { entitlements } from '@crm/db/schema'
import { eq } from 'drizzle-orm'
import type { CrmEntitlements } from '@crm/entitlements'

// Entitlements do workspace (linha sincronizada pelo Vianova via
// POST /internal/entitlements). Sem linha = defaults do plano free,
// os mesmos defaults da tabela.
export async function getWorkspaceEntitlements(workspaceId: string): Promise<CrmEntitlements> {
  const [row] = await db.select().from(entitlements).where(eq(entitlements.workspaceId, workspaceId)).limit(1)
  if (!row) {
    return {
      plan: 'free',
      status: 'active',
      agentsLimit: 2,
      connectionsLimit: 1,
      activeConversationsLimit: 200,
      managersLimit: 2,
    }
  }
  return {
    plan: row.plan,
    status: row.status,
    agentsLimit: row.agentsLimit,
    connectionsLimit: row.connectionsLimit,
    activeConversationsLimit: row.activeConversationsLimit,
    managersLimit: row.managersLimit,
  }
}
