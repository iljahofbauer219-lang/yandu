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

/** 写审计。db 放宽为事务客户端，使资产变更类操作能把审计纳入同一 $transaction（有审计 ⇔ 变更真实发生） */
export async function writeAudit(db: PrismaClient | Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
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
