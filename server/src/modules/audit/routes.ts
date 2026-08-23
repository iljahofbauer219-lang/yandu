import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  action: z.string().optional()
})

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 审计日志（仅 report.view:all 权限可查）
  app.get('/', { preHandler: [app.requirePermission('report.view:all')] }, async (request) => {
    const query = querySchema.parse(request.query)
    const logs = await prisma.auditLog.findMany({
      where: { orgId: request.currentUser.orgId, ...(query.action ? { action: query.action } : {}) },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })
    const hasMore = logs.length > query.limit
    const page = hasMore ? logs.slice(0, query.limit) : logs
    return {
      items: page.map(log => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        detail: log.detail,
        ip: log.ip,
        createdAt: log.createdAt.toISOString(),
        user: log.user
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null
    }
  })
}
