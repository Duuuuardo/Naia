import { db, auditLogs } from '@naia/db'
import { generateId } from './crypto'

export interface AuditInput {
  actorUserId: string
  action: string
  resourceType: string
  resourceId?: string | null
  workspaceId?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
  userAgent?: string | null
}

export async function logAudit(input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    id: generateId(),
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    workspaceId: input.workspaceId ?? null,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}
