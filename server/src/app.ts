import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { config } from './config.js'
import { HttpError } from './lib/errors.js'
import { aiRoutes } from './modules/ai/routes.js'
import { auditRoutes } from './modules/audit/routes.js'
import { authRoutes } from './modules/auth/routes.js'
import { collectionRoutes } from './modules/collection/routes.js'
import { complianceRoutes } from './modules/compliance/routes.js'
import { ebayRoutes } from './modules/ebay/routes.js'
import { mediaPublicRoutes, mediaRoutes } from './modules/media/routes.js'
import { memberRoutes } from './modules/members/routes.js'
import { roleRoutes } from './modules/roles/routes.js'
import { storeRoutes } from './modules/stores/routes.js'
import { authPlugin } from './plugins/auth.js'
import { codexHarnessRoutes } from './modules/codex-harness/routes.js'
import { dashboardRoutes } from './modules/dashboard/routes.js'
import { linduoPricingRoutes } from './modules/linduo/pricing-routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' }
  })

  await app.register(cors, { origin: config.corsOrigin === '*' ? true : config.corsOrigin })
  await app.register(jwt, { secret: config.jwtSecret })
  await app.register(authPlugin)

  // 必须先于任何路由注册：Fastify 在注册路由时快照当前上下文的 errorHandler，后置设置不会对已注册路由生效
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION',
        message: '请求参数不合法',
        issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
      })
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message })
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: (error as { code?: string }).code ?? 'REQUEST_ERROR',
        message: error instanceof Error ? error.message : '请求失败'
      })
    }
    request.log.error(error)
    return reply.status(500).send({ error: 'INTERNAL', message: '服务器内部错误' })
  })

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(memberRoutes, { prefix: '/api/members' })
  await app.register(roleRoutes, { prefix: '/api/roles' })
  await app.register(storeRoutes, { prefix: '/api/stores' })
  await app.register(auditRoutes, { prefix: '/api/audit-logs' })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  await app.register(collectionRoutes, { prefix: '/api/collection' })
  await app.register(complianceRoutes, { prefix: '/api/compliance' })
  await app.register(ebayRoutes, { prefix: '/api/ebay' })
  await app.register(mediaRoutes, { prefix: '/api/media' })
  await app.register(aiRoutes, { prefix: '/api/ai' })
  await app.register(codexHarnessRoutes, { prefix: '/api/codex-harness' })
  // 零度API 价格抓取路由（DB 持久化 + 用户名密码自动登录）
  await app.register(linduoPricingRoutes, { prefix: '/api/linduo' })
  // 公共下载路由（local 驱动，HMAC 签名即授权；OSS 驱动下返回 404）
  await app.register(mediaPublicRoutes)

  return app
}
