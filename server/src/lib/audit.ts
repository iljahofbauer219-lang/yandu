import type { Prisma, PrismaClient } from '@prisma/client'

export interface AuditEntry {
  orgId: string
  userId?: string | null
  action: string
  targetType?: string
  targetId?: string
  detail?: Record<string, unknown>
  ip?: string
}

export async function writeAudit(db: PrismaClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      orgId: entry.orgId,
      userId: entry.userId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      detail: (entry.detail ?? null) as Prisma.InputJsonValue,
      ip: entry.ip ?? null
    }
  })
}
