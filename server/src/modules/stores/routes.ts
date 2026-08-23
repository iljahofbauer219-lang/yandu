import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'

const createStoreSchema = z.object({
  name: z.string().trim().min(1, '请填写店铺名称').max(50),
  marketplaceId: z.string().trim().min(1).default('EBAY_US')
})

const updateStoreSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional()
})

function serializeStore(store: {
  id: string; name: string; marketplaceId: string; status: string
  createdAt: Date; updatedAt: Date; _count?: { grants: number }
}) {
  return {
    id: store.id,
    name: store.name,
    marketplaceId: store.marketplaceId,
    status: store.status,
    grantedMemberCount: store._count?.grants ?? 0,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString()
  }
}

export async function storeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 店铺列表：主帐号看全部，子帐号只看被授权的
  app.get('/', async (request) => {
    const { orgId, storeScope } = request.currentUser
    const stores = await prisma.ebayStore.findMany({
      where: { orgId, ...(storeScope ? { id: { in: storeScope } } : {}) },
      include: { _count: { select: { grants: true } } },
      orderBy: { createdAt: 'asc' }
    })
    return stores.map(serializeStore)
  })

  // 添加店铺
  app.post('/', { preHandler: [app.requirePermission('store.manage')] }, async (request) => {
    const body = createStoreSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    const store = await prisma.ebayStore.create({
      data: { orgId, name: body.name, marketplaceId: body.marketplaceId },
      include: { _count: { select: { grants: true } } }
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'store.create', targetType: 'store', targetId: store.id,
      detail: { name: store.name, marketplaceId: store.marketplaceId }, ip: request.ip
    })
    return serializeStore(store)
  })

  // 编辑店铺
  app.patch('/:id', { preHandler: [app.requirePermission('store.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = updateStoreSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    const store = await prisma.ebayStore.findFirst({ where: { id, orgId } })
    if (!store) throw httpError(404, 'STORE_NOT_FOUND', '店铺不存在')

    const updated = await prisma.ebayStore.update({
      where: { id: store.id },
      data: { ...(body.name ? { name: body.name } : {}), ...(body.status ? { status: body.status } : {}) },
      include: { _count: { select: { grants: true } } }
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'store.update', targetType: 'store', targetId: store.id,
      detail: body, ip: request.ip
    })
    return serializeStore(updated)
  })

  // 删除店铺（授权记录级联删除）
  app.delete('/:id', { preHandler: [app.requirePermission('store.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const orgId = request.currentUser.orgId
    const store = await prisma.ebayStore.findFirst({ where: { id, orgId } })
    if (!store) throw httpError(404, 'STORE_NOT_FOUND', '店铺不存在')

    await prisma.ebayStore.delete({ where: { id: store.id } })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'store.delete', targetType: 'store', targetId: store.id,
      detail: { name: store.name }, ip: request.ip
    })
    return { ok: true }
  })
}
