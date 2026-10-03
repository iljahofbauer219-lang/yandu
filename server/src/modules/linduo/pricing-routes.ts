/**
 * 零度API 价格抓取路由：
 * - GET  /api/linduo/pricing            拉取 37 个模型价格（DB 已落库的最新值；空时回退到 fallback）
 * - GET  /api/linduo/login/status       登录态（是否已登录、cookie 过期时间）
 * - POST /api/linduo/login              用户名密码自动登录（存加密密码到 DB）
 * - POST /api/linduo/logout             清除登录态
 * - POST /api/linduo/pricing/refresh    立即触发一次抓取
 *
 * 权限：所有路由登录即可（ai.use），含登录与刷新（与下方各路由 preHandler 实际门控一致；
 * 历史上此处误写「登录/刷新稍高（member.manage）」，实际从未要求 member.manage）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import { fallbackPricingList } from './pricing-fallback.js'
import { getLoginStatus, clearLoginSession } from './pricing-login.js'
import { loginOnly, scrapeAndPersist } from './pricing-scraper.js'
import type { LinduoModelPricing } from './types.js'

const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200)
})

function toPricingResponse(row: {
  modelId: string
  vendor: string
  inputPrice: number | null
  outputPrice: number | null
  cachePrice: number | null
  currency: string
  billingType: string
  pricePerUnit: number | null
  unitLabel: string | null
  fetchedAt: Date
  stale: boolean
}): LinduoModelPricing {
  return {
    modelId: row.modelId,
    vendor: row.vendor as LinduoModelPricing['vendor'],
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    cachePrice: row.cachePrice,
    currency: 'USD',
    billingType: row.billingType as LinduoModelPricing['billingType'],
    pricePerUnit: row.pricePerUnit,
    unitLabel: row.unitLabel,
    fetchedAt: row.fetchedAt.toISOString(),
    stale: row.stale
  }
}

export async function linduoPricingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 拉取价格：DB → 兜底
  app.get('/pricing', async () => {
    const rows = await prisma.linduoModelPricing.findMany({ orderBy: { modelId: 'asc' } })
    const items = rows.length > 0 ? rows.map(toPricingResponse) : fallbackPricingList()
    const refreshedAt = rows[0]?.fetchedAt?.toISOString() ?? null
    return {
      items,
      refreshedAt,
      allStale: rows.length > 0 && rows.every(row => row.stale)
    }
  })

  // 登录态
  app.get('/login/status', async () => {
    return getLoginStatus()
  })

  // 登出
  app.post('/logout', { preHandler: [app.requirePermission('ai.use')] }, async () => {
    await clearLoginSession()
    return { ok: true }
  })

  // 用户名密码登录（仅登录，不抓取；首次或用户主动触发）
  app.post('/login', { preHandler: [app.requirePermission('ai.use')] }, async (request, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body)
    const result = await loginOnly(body.username.trim(), body.password)
    if (!result.ok) {
      throw httpError(400, 'LOGIN_FAILED', result.error || '登录失败')
    }
    return { ok: true, expiresAt: result.expiresAt }
  })

  // 立即抓取：ai.use 即可（与文件头权限说明一致；另需登录态存在，否则回退兜底并报 ok:false）
  app.post('/pricing/refresh', { preHandler: [app.requirePermission('ai.use')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAt = Date.now()
    let credentials: { username: string; password: string } | undefined = undefined
    const raw = (request.body ?? {}) as { credentials?: { username?: unknown; password?: unknown } }
    if (raw.credentials && typeof raw.credentials.username === 'string' && typeof raw.credentials.password === 'string') {
      credentials = { username: raw.credentials.username, password: raw.credentials.password }
    }
    try {
      const result = await scrapeAndPersist({ credentials })
      // 抓取失败回退兜底常量时不得再报 ok:true（plan frosty-wood-gudgeon #26）：
      // ok:false + reason，前端（LinduoModelMallPage / LlmApiKeysPage）已按 result.error 展示失败
      if (result.fromFallback) {
        const reason = result.reason ?? '抓取失败，已回退兜底价格'
        return {
          ok: false,
          count: result.items.length,
          refreshedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          fromFallback: true,
          reason,
          error: reason
        }
      }
      return {
        ok: true,
        count: result.items.length,
        refreshedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        fromFallback: false
      }
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        count: 0,
        refreshedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : '抓取失败'
      })
    }
  })
}
