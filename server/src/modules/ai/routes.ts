/**
 * AI 网关路由：
 * - GET  /api/ai/models            模型目录聚合（含连接状态与本人配额余量），登录即可
 * - POST /api/ai/images/generate   生图（百炼/火山/OpenAI），权限 ai.use，配额 image.generate
 * - POST /api/ai/text/translate    百炼批量翻译，权限 ai.use，配额 text.translate
 * - POST /api/ai/text/command      DeepSeek 智能指令解析，权限 ai.use，配额 text.command
 * - POST /api/ai/text/chat         通用 chat 代理（grounding/视觉检查/标题优化等复合 AI），权限 ai.use，配额 text.chat
 * - POST /api/ai/videos/generate   方舟视频任务提交，权限 ai.use，配额 video.generate
 * - GET  /api/ai/videos/:taskId    方舟视频任务状态查询（不计用量），权限 ai.use
 * - GET  /api/ai/usage             本月用量明细+聚合（report.view:all 全员 / report.view:self 仅本人）
 * - GET  /api/ai/quotas            组织全员配额一览，权限 member.manage
 * - PUT  /api/ai/quotas/:userId    设置成员月度配额（null=不限，0=禁止），权限 member.manage
 * 密钥全部驻留服务端 config，响应与审计均不含密钥。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { findImageModel, imageModelsOf, VIDEO_MODEL_CATALOG, TRANSLATE_MODEL } from './catalog.js'
import { assertQuota, monthKeyOf, quotaStatusOf, recordUsage, startOfMonthUtc } from './gateway.js'
import {
  bailianAvailableModelIds,
  chatCompletion,
  createVideoTask,
  generateImage,
  getVideoTask,
  linduoAvailableModelIds,
  translateTexts,
  understandCommand
} from './providers.js'

const generateImageSchema = z.object({
  model: z.string().min(1).max(100),
  prompt: z.string().min(1).max(4000),
  size: z.enum(['1K', '2K']).default('1K'),
  count: z.number().int().min(1).max(6).default(1),
  promptExtend: z.boolean().optional(),
  referenceImageUrls: z.array(z.string().url().max(2000)).max(10).optional()
})

const translateSchema = z.object({
  texts: z.array(z.string().min(1).max(2000)).min(1).max(200)
})

const commandSchema = z.object({
  text: z.string().min(1).max(500)
})

const chatSchema = z.object({
  provider: z.enum(['bailian', 'deepseek']),
  model: z.string().min(1).max(100).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.union([z.string().min(1).max(20000), z.array(z.record(z.string(), z.unknown())).min(1).max(20)])
      })
    )
    .min(1)
    .max(20),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  responseFormat: z.enum(['json_object', 'text']).optional(),
  thinkingDisabled: z.boolean().optional()
})

const videoGenerateSchema = z.object({
  prompt: z.string().min(1).max(2000),
  imageUrls: z.array(z.string().max(3000)).max(10).optional(),
  model: z.string().min(1).max(100).optional()
})

const usageQuerySchema = z.object({
  userId: z.string().min(1).max(64).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
})

const upsertQuotaSchema = z.object({
  imageLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  videoLimit: z.number().int().min(0).max(100_000).nullable().optional(),
  textLimit: z.number().int().min(0).max(1_000_000).nullable().optional()
})

/** report.view:all 与 report.view:self 任一即可（主帐号直通） */
async function requireReportAccess(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser
  if (!user.isOwner && !user.permissions.has('report.view:all') && !user.permissions.has('report.view:self')) {
    return reply.status(403).send({ error: 'FORBIDDEN', message: '没有该操作的权限', permission: 'report.view' })
  }
}

function parseMonth(month: string | undefined): { start: Date; end: Date; key: string } {
  if (!month) {
    const start = startOfMonthUtc()
    return { start, end: new Date(), key: monthKeyOf() }
  }
  const [year = 1970, mon = 1] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, mon - 1, 1))
  const end = new Date(Date.UTC(year, mon, 1))
  return { start, end, key: month }
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/models', async request => {
    const [bailianIds, linduoIds, quota] = await Promise.all([
      bailianAvailableModelIds(),
      linduoAvailableModelIds(),
      quotaStatusOf(prisma, request.currentUser.orgId, request.currentUser.id)
    ])
    const bailianModels = imageModelsOf('bailian')
    const linduoModels = imageModelsOf('linduo')
    const providers = [
      config.bailianApiKey
        ? bailianIds
          ? {
              provider: 'bailian',
              connected: true,
              message: `百炼已连接 · ${bailianModels.filter(m => bailianIds.has(m.id)).length} 个生图模型可用`,
              models: bailianModels.filter(m => bailianIds.has(m.id))
            }
          : { provider: 'bailian', connected: false, message: '百炼模型列表探测失败，请检查密钥与网络', models: [] }
        : { provider: 'bailian', connected: false, message: '未配置百炼 API Key', models: [] },
      config.arkApiKey
        ? { provider: 'volc', connected: true, message: `火山方舟已配置 · ${imageModelsOf('volc').length} 个 Seedream 生图模型可用`, models: imageModelsOf('volc') }
        : { provider: 'volc', connected: false, message: '未配置火山方舟 ARK_API_KEY', models: [] },
      config.openaiImageApiKey
        ? { provider: 'openai', connected: true, message: 'OpenAI 生图已配置', models: imageModelsOf('openai') }
        : { provider: 'openai', connected: false, message: '未配置 OPENAI_IMAGE_API_KEY', models: [] },
      config.linduoApiKey
        ? linduoIds
          ? {
              provider: 'linduo',
              connected: true,
              message: `零度API 已连接 · ${linduoModels.filter(m => linduoIds.has(m.id)).length} 个生图模型在线`,
              models: linduoModels.filter(m => linduoIds.has(m.id))
            }
          : { provider: 'linduo', connected: false, message: '零度API 模型列表探测失败，请检查 Key 与网络', models: linduoModels }
        : { provider: 'linduo', connected: false, message: '未配置零度API LINDUO_API_KEY', models: [] }
    ]
    return {
      providers,
      video: {
        connected: Boolean(config.arkApiKey && config.arkVideoModel),
        defaultModel: config.arkVideoModel || null,
        models: VIDEO_MODEL_CATALOG,
        message: config.arkApiKey && config.arkVideoModel ? '方舟视频生成已配置' : '请配置 ARK_API_KEY 和 ARK_VIDEO_MODEL'
      },
      text: {
        translate: { connected: Boolean(config.bailianApiKey), model: TRANSLATE_MODEL },
        command: { connected: Boolean(config.deepseekApiKey), model: config.deepseekModel }
      },
      quota
    }
  })

  app.post('/images/generate', { preHandler: [app.requirePermission('ai.use')] }, async request => {
    const body = generateImageSchema.parse(request.body)
    const profile = findImageModel(body.model)
    if (!profile) throw httpError(400, 'UNKNOWN_MODEL', `未知的生图模型：${body.model}`)
    const { orgId, id: userId } = request.currentUser
    await assertQuota(prisma, orgId, userId, 'image.generate', body.count)
    const result = await generateImage(profile, body)
    const units = Math.max(1, result.imageUrls.length)
    await recordUsage(prisma, { orgId, userId, provider: result.provider, model: result.model, purpose: 'image.generate', units })
    await writeAudit(prisma, {
      orgId,
      userId,
      action: 'ai.image.generate',
      targetType: 'ai',
      targetId: result.taskId,
      detail: { provider: result.provider, model: result.model, requested: body.count, generated: units },
      ip: request.ip
    })
    return { ...result, quota: await quotaStatusOf(prisma, orgId, userId) }
  })

  app.post('/text/translate', { preHandler: [app.requirePermission('ai.use')] }, async request => {
    const body = translateSchema.parse(request.body)
    const { orgId, id: userId } = request.currentUser
    const estimatedUnits = new Set(body.texts.map(text => text.trim()).filter(Boolean)).size
    if (estimatedUnits === 0) throw httpError(400, 'EMPTY_TEXTS', '没有可翻译的文本')
    await assertQuota(prisma, orgId, userId, 'text.translate', estimatedUnits)
    const result = await translateTexts(body.texts)
    await recordUsage(prisma, { orgId, userId, provider: 'bailian', model: result.model, purpose: 'text.translate', units: result.units })
    await writeAudit(prisma, {
      orgId,
      userId,
      action: 'ai.text.translate',
      targetType: 'ai',
      detail: { model: result.model, requested: body.texts.length, translated: result.units },
      ip: request.ip
    })
    return { ...result, quota: await quotaStatusOf(prisma, orgId, userId) }
  })

  app.post('/text/command', { preHandler: [app.requirePermission('ai.use')] }, async request => {
    const body = commandSchema.parse(request.body)
    const { orgId, id: userId } = request.currentUser
    await assertQuota(prisma, orgId, userId, 'text.command', 1)
    const result = await understandCommand(body.text)
    await recordUsage(prisma, { orgId, userId, provider: 'deepseek', model: result.model, purpose: 'text.command', units: 1 })
    await writeAudit(prisma, {
      orgId,
      userId,
      action: 'ai.text.command',
      targetType: 'ai',
      detail: { model: result.model, action: result.command.action },
      ip: request.ip
    })
    return result
  })

  app.post('/text/chat', { preHandler: [app.requirePermission('ai.use')] }, async request => {
    const body = chatSchema.parse(request.body)
    const { orgId, id: userId } = request.currentUser
    await assertQuota(prisma, orgId, userId, 'text.chat', 1)
    const result = await chatCompletion(body)
    await recordUsage(prisma, { orgId, userId, provider: result.provider, model: result.model, purpose: 'text.chat', units: 1 })
    await writeAudit(prisma, {
      orgId,
      userId,
      action: 'ai.text.chat',
      targetType: 'ai',
      detail: { provider: result.provider, model: result.model, messages: body.messages.length },
      ip: request.ip
    })
    return { ...result, quota: await quotaStatusOf(prisma, orgId, userId) }
  })

  app.post('/videos/generate', { preHandler: [app.requirePermission('ai.use')] }, async request => {
    const body = videoGenerateSchema.parse(request.body)
    const { orgId, id: userId } = request.currentUser
    await assertQuota(prisma, orgId, userId, 'video.generate', 1)
    const result = await createVideoTask(body)
    await recordUsage(prisma, { orgId, userId, provider: 'ark', model: result.model, purpose: 'video.generate', units: 1 })
    await writeAudit(prisma, {
      orgId,
      userId,
      action: 'ai.video.generate',
      targetType: 'ai',
      targetId: result.taskId,
      detail: { model: result.model, imageCount: body.imageUrls?.length ?? 0 },
      ip: request.ip
    })
    return { ...result, status: 'queued' as const }
  })

  app.get('/videos/:taskId', { preHandler: [app.requirePermission('ai.use')] }, async request => {
    const { taskId } = z.object({ taskId: z.string().min(1).max(200) }).parse(request.params)
    return getVideoTask(taskId)
  })

  app.get('/usage', { preHandler: [requireReportAccess] }, async request => {
    const query = usageQuerySchema.parse(request.query)
    const user = request.currentUser
    const canViewAll = user.isOwner || user.permissions.has('report.view:all')
    // 无全员权限的子帐号强制只看本人
    const effectiveUserId = canViewAll ? query.userId : user.id
    const { start, end, key } = parseMonth(query.month)
    const where = {
      orgId: user.orgId,
      ...(effectiveUserId ? { userId: effectiveUserId } : {}),
      createdAt: { gte: start, lt: end }
    }
    const [items, grouped] = await Promise.all([
      prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: { user: { select: { id: true, name: true, email: true } } }
      }),
      prisma.aiUsageLog.groupBy({
        by: ['userId', 'purpose'],
        where,
        _sum: { units: true }
      })
    ])
    const userIds = [...new Set(grouped.map(row => row.userId).filter((id): id is string => Boolean(id)))]
    const users = await prisma.user.findMany({
      where: { orgId: user.orgId, id: { in: userIds } },
      select: { id: true, name: true, email: true }
    })
    const userMap = new Map(users.map(item => [item.id, item]))
    const summaryByUser = new Map<string, { userId: string; userName: string; userEmail: string; image: number; video: number; text: number; total: number }>()
    for (const row of grouped) {
      if (!row.userId) continue
      const profile = userMap.get(row.userId)
      const entry = summaryByUser.get(row.userId) ?? {
        userId: row.userId,
        userName: profile?.name ?? '',
        userEmail: profile?.email ?? '',
        image: 0,
        video: 0,
        text: 0,
        total: 0
      }
      const units = row._sum.units ?? 0
      if (row.purpose.startsWith('image.')) entry.image += units
      else if (row.purpose.startsWith('video.')) entry.video += units
      else entry.text += units
      entry.total += units
      summaryByUser.set(row.userId, entry)
    }
    return {
      month: key,
      scope: canViewAll ? 'all' : 'self',
      summary: [...summaryByUser.values()].sort((a, b) => b.total - a.total),
      items: items.map(item => ({
        id: item.id,
        userId: item.userId,
        userName: item.user?.name ?? '',
        userEmail: item.user?.email ?? '',
        provider: item.provider,
        model: item.model,
        purpose: item.purpose,
        units: item.units,
        createdAt: item.createdAt
      }))
    }
  })

  app.get('/quotas', { preHandler: [app.requirePermission('member.manage')] }, async request => {
    const users = await prisma.user.findMany({
      where: { orgId: request.currentUser.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, isOwner: true, status: true, aiQuotas: true }
    })
    return {
      items: users.map(user => {
        const quota = user.aiQuotas[0] ?? null
        return {
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          isOwner: user.isOwner,
          status: user.status,
          imageLimit: quota?.imageLimit ?? null,
          videoLimit: quota?.videoLimit ?? null,
          textLimit: quota?.textLimit ?? null,
          updatedAt: quota?.updatedAt ?? null
        }
      })
    }
  })

  app.put('/quotas/:userId', { preHandler: [app.requirePermission('member.manage')] }, async request => {
    const { userId } = z.object({ userId: z.string().min(1).max(64) }).parse(request.params)
    const body = upsertQuotaSchema.parse(request.body)
    const { orgId, id: operatorId } = request.currentUser
    const target = await prisma.user.findFirst({ where: { id: userId, orgId }, select: { id: true, name: true, email: true } })
    if (!target) throw httpError(404, 'NOT_FOUND', '目标成员不存在')
    const patch = {
      ...(body.imageLimit !== undefined ? { imageLimit: body.imageLimit } : {}),
      ...(body.videoLimit !== undefined ? { videoLimit: body.videoLimit } : {}),
      ...(body.textLimit !== undefined ? { textLimit: body.textLimit } : {})
    }
    if (Object.keys(patch).length === 0) throw httpError(400, 'EMPTY_PATCH', '至少提供一项配额字段')
    const quota = await prisma.aiQuota.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: { orgId, userId, ...patch },
      update: patch
    })
    await writeAudit(prisma, {
      orgId,
      userId: operatorId,
      action: 'ai.quota.update',
      targetType: 'user',
      targetId: userId,
      detail: { targetEmail: target.email, ...patch },
      ip: request.ip
    })
    return {
      userId,
      imageLimit: quota.imageLimit,
      videoLimit: quota.videoLimit,
      textLimit: quota.textLimit,
      updatedAt: quota.updatedAt
    }
  })
}
