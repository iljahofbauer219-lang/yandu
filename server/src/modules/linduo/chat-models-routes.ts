/**
 * Linduo 聊天模型选用 + 授权管理 API (M1/R-2):
 * - GET    /api/linduo/chat-models                当前用户可用的 enabled 模型(走 R-2 白名单)
 * - GET    /api/linduo/chat-models/all            全部(含 disabled),需 member.manage
 * - PATCH  /api/linduo/chat-models/:id/enabled    切换 enabled,需 member.manage
 * - GET    /api/linduo/tiers                      列出当前 org 的所有 LinduoModelTier
 * - GET    /api/linduo/tiers/:id/models           该 tier 默认开通的模型
 * - PUT    /api/linduo/tiers/:id/models           body: { modelIds: string[] }
 * - GET    /api/linduo/members/:id/tier-and-exceptions  成员 tier + exceptions 汇总
 * - PUT    /api/linduo/members/:id/tier           body: { tierId: string | null }
 * - GET    /api/linduo/exceptions                 所有例外(GRANT+REVOKE),需 member.manage
 * - POST   /api/linduo/exceptions                 body: { userId, modelId, kind }
 * - DELETE /api/linduo/exceptions                 body: { userId, modelId }
 * - GET    /api/linduo/preferred-model            当前用户
 * - PUT    /api/linduo/preferred-model            body: { modelId: string | null }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import type { LinduoChatModelView, LinduoModelTierView, LinduoMemberTierView, UserLinduoExceptionView } from './types.js'
import { getAvailableModelsForUser, userCanUseModel } from './tier-resolver.js'

// ============== 转换器 ==============

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

function toTierView(
  row: {
    id: string
    key: string
    name: string
    description: string | null
    displayOrder: number
    isSystem: boolean
    _count: { grants: number }
  },
  grants?: LinduoChatModelView[]
): LinduoModelTierView {
  return {
    id: row.id,
    key: row.key as LinduoModelTierView['key'],
    name: row.name,
    description: row.description,
    displayOrder: row.displayOrder,
    isSystem: row.isSystem,
    grantCount: row._count.grants,
    grants
  }
}

async function toMemberTierView(
  userId: string,
  orgId: string
): Promise<LinduoMemberTierView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      orgId: true,
      name: true,
      email: true,
      isOwner: true,
      linduoTierId: true,
      linduoTier: {
        select: {
          id: true, key: true, name: true, description: true, displayOrder: true, isSystem: true,
          _count: { select: { grants: true } }
        }
      },
      linduoExceptions: {
        include: { model: { select: { displayName: true, vendor: true } } }
      }
    }
  })
  if (!user || user.orgId !== orgId) return null
  return {
    memberId: user.id,
    memberName: user.name,
    memberEmail: user.email,
    isOwner: user.isOwner,
    tier: user.linduoTier ? toTierView(user.linduoTier) : null,
    exceptions: user.linduoExceptions.map(e => ({
      modelId: e.modelId,
      modelDisplayName: e.model.displayName,
      vendor: e.model.vendor,
      kind: e.kind as 'GRANT' | 'REVOKE',
      grantedBy: e.grantedBy,
      grantedAt: e.grantedAt.toISOString()
    }))
  }
}

// ============== Zod schemas ==============

const grantSchema = z.object({
  userId: z.string().min(1),
  modelId: z.string().min(1)
})

const exceptionCreateSchema = z.object({
  userId: z.string().min(1),
  modelId: z.string().min(1),
  kind: z.enum(['GRANT', 'REVOKE'])
})

const preferredSchema = z.object({
  modelId: z.string().min(1).nullable()
})

const enabledPatchSchema = z.object({
  enabled: z.boolean()
})

const tierModelsPutSchema = z.object({
  modelIds: z.array(z.string().min(1))
})

const memberTierPutSchema = z.object({
  tierId: z.string().min(1).nullable()
})

// ============== 路由 ==============

export async function linduoChatModelsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // ----- 当前用户可用的 enabled 模型 (R-2:走 tier + exception 完整公式) -----
  app.get('/chat-models', async (request) => {
    const userId = request.currentUser.id
    const models = await getAvailableModelsForUser(userId)
    return models.map(toModelView)
  })

  // ----- 全部模型(管理员) -----
  app.get('/chat-models/all', { preHandler: [app.requirePermission('member.manage')] }, async () => {
    const rows = await prisma.linduoChatModel.findMany({ orderBy: [{ enabled: 'desc' }, { modelId: 'asc' }] })
    return rows.map(toModelView)
  })

  // ----- 切换 enabled -----
  app.patch('/chat-models/:id/enabled', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const body = enabledPatchSchema.parse(request.body)
    const row = await prisma.linduoChatModel.findUnique({ where: { id } })
    if (!row) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const updated = await prisma.linduoChatModel.update({ where: { id }, data: { enabled: body.enabled } })
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id,
      action: 'linduo.chat_model.toggle_enabled', targetType: 'LinduoChatModel', targetId: id,
      detail: { modelId: row.modelId, enabled: body.enabled }, ip: request.ip
    })
    return toModelView(updated)
  })

  // ----- Tier 列表(管理员) -----
  app.get('/tiers', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const rows = await prisma.linduoModelTier.findMany({
      where: { orgId: request.currentUser.orgId },
      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
      include: { _count: { select: { grants: true } } }
    })
    return rows.map(r => toTierView(r))
  })

  // ----- Tier 的模型列表(管理员) -----
  app.get('/tiers/:id/models', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const tier = await prisma.linduoModelTier.findFirst({
      where: { id, orgId: request.currentUser.orgId },
      include: {
        _count: { select: { grants: true } },
        grants: {
          include: { model: true }
        }
      }
    })
    if (!tier) throw httpError(404, 'TIER_NOT_FOUND', 'Tier 不存在')
    const models = tier.grants.map(g => toModelView(g.model))
    return { tier: toTierView(tier, models), models }
  })

  // ----- 设置 tier 的模型列表(管理员) -----
  app.put('/tiers/:id/models', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const body = tierModelsPutSchema.parse(request.body)
    const tier = await prisma.linduoModelTier.findFirst({
      where: { id, orgId: request.currentUser.orgId }
    })
    if (!tier) throw httpError(404, 'TIER_NOT_FOUND', 'Tier 不存在')
    if (tier.isSystem && tier.key === 'full') {
      throw httpError(400, 'TIER_READONLY', 'full tier 随 Linduo 聊天模型自动同步,不可手动改')
    }

    // 校验所有 modelId 真实存在
    const validModels = await prisma.linduoChatModel.findMany({
      where: { id: { in: body.modelIds } },
      select: { id: true }
    })
    const validIds = new Set(validModels.map(m => m.id))
    const filtered = body.modelIds.filter(m => validIds.has(m))

    await prisma.$transaction([
      prisma.linduoTierGrant.deleteMany({ where: { tierId: id } }),
      ...(filtered.length > 0
        ? [prisma.linduoTierGrant.createMany({ data: filtered.map(modelId => ({ tierId: id, modelId })) })]
        : [])
    ])

    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id,
      action: 'linduo.tier.models.set', targetType: 'LinduoModelTier', targetId: id,
      detail: { tierKey: tier.key, modelCount: filtered.length }, ip: request.ip
    })

    const updated = await prisma.linduoModelTier.findUnique({
      where: { id },
      include: { _count: { select: { grants: true } }, grants: { include: { model: true } } }
    })
    if (!updated) throw httpError(404, 'TIER_NOT_FOUND', 'Tier 不存在')
    return toTierView(updated, updated.grants.map(g => toModelView(g.model)))
  })

  // ----- 成员 tier + exceptions 汇总(管理员) -----
  app.get('/members/:id/tier-and-exceptions', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const view = await toMemberTierView(id, request.currentUser.orgId)
    if (!view) throw httpError(404, 'MEMBER_NOT_FOUND', '成员不存在')
    return view
  })

  // ----- 设置成员 tier(管理员;null = 清除,仅依赖 exceptions) -----
  app.put('/members/:id/tier', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const id = (request.params as { id: string }).id
    const body = memberTierPutSchema.parse(request.body)
    // 校验 member 存在且属于同一 org
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, orgId: true, isOwner: true } })
    if (!user || user.orgId !== request.currentUser.orgId) {
      throw httpError(404, 'MEMBER_NOT_FOUND', '成员不存在')
    }
    // OWNER 必须保持 full tier(spec §12 风险表要求后端也强制,UI 禁用是外层,API 是兜底)
    if (user.isOwner) {
      const fullTier = await prisma.linduoModelTier.findFirst({
        where: { orgId: request.currentUser.orgId, key: 'full' },
        select: { id: true }
      })
      const targetIsFull = fullTier !== null && body.tierId === fullTier.id
      if (!targetIsFull) {
        throw httpError(400, 'OWNER_TIER_LOCKED', '主帐号必须在全开组,不可降级或清空')
      }
    }
    // 校验 tier 存在且属于同一 org(tierId 非 null 时)
    if (body.tierId !== null) {
      const tier = await prisma.linduoModelTier.findFirst({
        where: { id: body.tierId, orgId: request.currentUser.orgId },
        select: { id: true }
      })
      if (!tier) throw httpError(404, 'TIER_NOT_FOUND', 'Tier 不存在')
    }
    await prisma.user.update({ where: { id }, data: { linduoTierId: body.tierId } })
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id,
      action: 'linduo.member.tier.set', targetType: 'User', targetId: id,
      detail: { tierId: body.tierId }, ip: request.ip
    })
    const view = await toMemberTierView(id, request.currentUser.orgId)
    return view
  })

  // ----- 所有例外(GRANT + REVOKE) -----
  app.get('/exceptions', { preHandler: [app.requirePermission('member.manage')] }, async () => {
    const rows = await prisma.userLinduoException.findMany({
      include: { model: true, user: { select: { id: true, name: true, email: true } } }
    })
    return rows.map(r => ({
      userId: r.userId,
      userName: r.user.name,
      modelId: r.modelId,
      displayName: r.model.displayName,
      vendor: r.model.vendor,
      kind: r.kind as 'GRANT' | 'REVOKE',
      grantedBy: r.grantedBy,
      grantedAt: r.grantedAt.toISOString()
    } satisfies UserLinduoExceptionView & { userName: string }))
  })

  // ----- 提交例外(GRANT/REVOKE) -----
  app.post('/exceptions', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = exceptionCreateSchema.parse(request.body)
    const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
    if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const user = await prisma.user.findUnique({ where: { id: body.userId } })
    if (!user) throw httpError(404, 'USER_NOT_FOUND', '用户不存在')
    const exception = await prisma.userLinduoException.upsert({
      where: { userId_modelId: { userId: body.userId, modelId: model.id } },
      create: { userId: body.userId, modelId: model.id, kind: body.kind, grantedBy: request.currentUser.id },
      update: { kind: body.kind, grantedBy: request.currentUser.id, grantedAt: new Date() }
    })
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id,
      action: body.kind === 'GRANT' ? 'linduo.exception.grant' : 'linduo.exception.revoke',
      targetType: 'UserLinduoException',
      targetId: `${body.userId}:${model.id}`,
      detail: { targetUserId: body.userId, modelId: model.id, modelName: model.displayName, kind: body.kind },
      ip: request.ip
    })
    return { userId: exception.userId, modelId: exception.modelId, kind: exception.kind, grantedBy: exception.grantedBy, grantedAt: exception.grantedAt.toISOString() }
  })

  // ----- 删除例外(若 modelId 是用户 preferred,自动清空) -----
  app.delete('/exceptions', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = grantSchema.parse(request.body)
    const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
    if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
    const before = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { preferredLinduoModelId: true }
    })
    await prisma.$transaction([
      prisma.userLinduoException.delete({ where: { userId_modelId: { userId: body.userId, modelId: model.id } } }),
      prisma.user.updateMany({
        where: { id: body.userId, preferredLinduoModelId: model.id },
        data: { preferredLinduoModelId: null }
      })
    ])
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id,
      action: 'linduo.exception.delete', targetType: 'UserLinduoException',
      targetId: `${body.userId}:${model.id}`,
      detail: { targetUserId: body.userId, modelId: model.id, modelName: model.displayName, clearedPreferred: before?.preferredLinduoModelId === model.id }, ip: request.ip
    })
    return { ok: true }
  })

  // ----- 当前用户 preferred model -----
  app.get('/preferred-model', async (request) => {
    const userId = request.currentUser.id
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLinduoModelId: true } })
    return { modelId: user?.preferredLinduoModelId ?? null }
  })

  // ----- 当前用户自己的 tier + exceptions 汇总(无需 member.manage,供 LinduoPreferenceModal 用) -----
  app.get('/me/tier-and-exceptions', async (request) => {
    const view = await toMemberTierView(request.currentUser.id, request.currentUser.orgId)
    if (!view) throw httpError(404, 'USER_NOT_FOUND', '当前用户不存在')
    return view
  })

  // ----- 设置 preferred model(null = 清空;R-2:用 userCanUseModel 校验白名单) -----
  app.put('/preferred-model', async (request) => {
    const body = preferredSchema.parse(request.body)
    const userId = request.currentUser.id
    if (body.modelId !== null) {
      const model = await prisma.linduoChatModel.findUnique({ where: { id: body.modelId } })
      if (!model) throw httpError(404, 'MODEL_NOT_FOUND', '模型不存在')
      if (!model.enabled) throw httpError(400, 'MODEL_DISABLED', '模型已禁用')
      // R-2:用 tier + exception 完整公式校验
      if (!(await userCanUseModel(userId, model.id))) {
        throw httpError(403, 'LINDUO_MODEL_NOT_GRANTED', '当前用户未被授权使用该模型')
      }
    }
    await prisma.user.update({ where: { id: userId }, data: { preferredLinduoModelId: body.modelId } })
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id,
      action: 'linduo.preferred_model.set', targetType: 'User', targetId: userId,
      detail: { modelId: body.modelId }, ip: request.ip
    })
    return { modelId: body.modelId }
  })
}
