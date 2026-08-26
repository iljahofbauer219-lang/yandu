/**
 * Linduo 聊天模型选用 + 授权管理 API（M1）：
 * - GET    /api/linduo/chat-models              当前用户按 grant 过滤的 enabled 列表
 * - GET    /api/linduo/chat-models/all          全部（含 disabled），需 member.manage
 * - PATCH  /api/linduo/chat-models/:id/enabled  切换 enabled，需 member.manage
 * - GET    /api/linduo/grants                   所有 grant 矩阵，需 member.manage
 * - POST   /api/linduo/grants                   body: { userId, modelId }，需 member.manage
 * - DELETE /api/linduo/grants                   body: { userId, modelId }，需 member.manage
 * - GET    /api/linduo/preferred-model          当前用户
 * - PUT    /api/linduo/preferred-model          body: { modelId: string | null }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import type { LinduoChatModelView, UserLinduoGrantView } from './types.js'

function toModelView(row: {
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  capabilities: string
  effort: string
  enabled: boolean
}): LinduoChatModelView {
  let caps: string[] = []
  try { caps = JSON.parse(row.capabilities) } catch { caps = [] }
  return {
    id: row.id,
    modelId: row.modelId,
    vendor: row.vendor,
    displayName: row.displayName,
    description: row.description,
    contextLabel: row.contextLabel,
    capabilities: caps,
    effort: row.effort,
    enabled: row.enabled
  }
}

const grantSchema = z.object({
  userId: z.string().min(1),
  modelId: z.string().min(1)
})

const preferredSchema = z.object({
  modelId: z.string().min(1).nullable()
})

const enabledPatchSchema = z.object({
  enabled: z.boolean()
})

export async function linduoChatModelsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 当前用户可用的 enabled 模型（按 grant 过滤）
  app.get('/chat-models', async (request) => {
    const userId = request.user.sub
    const grants = await prisma.userLinduoGrant.findMany({
      where: { userId },
      include: { model: true }
    })
    return grants
      .filter(g => g.model.enabled)
      .map(g => toModelView(g.model))
  })

  // 全部模型（管理员）
  app.get('/chat-models/all', { preHandler: [app.requirePermission('member.manage')] }, async () => {
    const rows = await prisma.linduoChatModel.findMany({ orderBy: [{ enabled: 'desc' }, { modelId: 'asc' }] })
    return rows.map(toModelView)
  })

  // 切换 enabled
  app.patch('/chat-models/:id/enabled', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const body = enabledPatchSchema.parse(request.body)
    const row = await prisma.linduoChatModel.findUnique({ where: { id } })
    if (!row) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const updated = await prisma.linduoChatModel.update({ where: { id }, data: { enabled: body.enabled } })
    return toModelView(updated)
  })

  // 所有 grant
  app.get('/grants', { preHandler: [app.requirePermission('member.manage')] }, async () => {
    const rows = await prisma.userLinduoGrant.findMany({
      include: { model: true, user: { select: { id: true, name: true, email: true } } }
    })
    return rows.map(r => ({
      userId: r.userId,
      userName: r.user.name,
      modelId: r.modelId,
      displayName: r.model.displayName,
      vendor: r.model.vendor,
      grantedBy: r.grantedBy,
      grantedAt: r.grantedAt.toISOString()
    } satisfies UserLinduoGrantView & { userName: string }))
  })

  // 创建 grant
  app.post('/grants', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = grantSchema.parse(request.body)
    const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
    if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const user = await prisma.user.findUnique({ where: { id: body.userId } })
    if (!user) throw httpError(404, 'USER_NOT_FOUND', '用户不存在')
    const grant = await prisma.userLinduoGrant.upsert({
      where: { userId_modelId: { userId: body.userId, modelId: model.id } },
      create: { userId: body.userId, modelId: model.id, grantedBy: request.user.sub },
      update: { grantedBy: request.user.sub, grantedAt: new Date() }
    })
    return { userId: grant.userId, modelId: grant.modelId, grantedBy: grant.grantedBy, grantedAt: grant.grantedAt.toISOString() }
  })

  // 删除 grant（如该 grant 是用户的 preferred，自动清空）
  app.delete('/grants', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = grantSchema.parse(request.body)
    const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
    if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    await prisma.$transaction([
      prisma.userLinduoGrant.delete({ where: { userId_modelId: { userId: body.userId, modelId: model.id } } }),
      prisma.user.updateMany({
        where: { id: body.userId, preferredLinduoModelId: model.id },
        data: { preferredLinduoModelId: null }
      })
    ])
    return { ok: true }
  })

  // 当前用户 preferred model
  app.get('/preferred-model', async (request) => {
    const userId = request.user.sub
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLinduoModelId: true } })
    return { modelId: user?.preferredLinduoModelId ?? null }
  })

  // 设置 preferred model（null = 清空）
  app.put('/preferred-model', async (request) => {
    const body = preferredSchema.parse(request.body)
    const userId = request.user.sub
    if (body.modelId !== null) {
      // 校验 grant
      const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
      if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
      if (!model.enabled) throw httpError(400, 'MODEL_DISABLED', '模型已禁用')
      const grant = await prisma.userLinduoGrant.findUnique({
        where: { userId_modelId: { userId, modelId: model.id } }
      })
      if (!grant) throw httpError(403, 'LINDUO_MODEL_NOT_GRANTED', '当前用户未被授权使用该模型')
    }
    await prisma.user.update({ where: { id: userId }, data: { preferredLinduoModelId: body.modelId } })
    return { modelId: body.modelId }
  })
}
