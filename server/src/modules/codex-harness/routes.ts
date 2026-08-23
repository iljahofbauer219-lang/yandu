import type { FastifyInstance } from 'fastify'
import { httpError } from '../../lib/errors.js'

/**
 * 受限隔离执行器网关的短期访问票据。
 * - 受众固定 yandu-codex-gateway: 网关必须校验 aud/scope/permission/exp
 * - 网关不能接受浏览器传来的 userId/orgId
 * - 票据 5 分钟过期,主进程 client 提前 30s 自动续约
 */
const CODEX_HARNESS_AUDIENCE = 'yandu-codex-gateway'
const CODEX_HARNESS_SCOPE = 'codex:web'
const CODEX_HARNESS_PERMISSION = 'menu.advisor.online'

export async function codexHarnessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/access-ticket', { preHandler: [app.requirePermission(CODEX_HARNESS_PERMISSION)] }, async request => {
    const user = request.currentUser
    const expiresIn = '5m'
    const ticket = app.jwt.sign({
      sub: user.id,
      org: user.orgId,
      aud: CODEX_HARNESS_AUDIENCE,
      scope: [CODEX_HARNESS_SCOPE],
      permission: CODEX_HARNESS_PERMISSION
    }, { expiresIn })
    return { ticket, expiresIn, audience: CODEX_HARNESS_AUDIENCE }
  })

  /**
   * 仅供同一私有 Docker 网络内的 Codex Harness 网关调用。
   * 这里复用主服务的 JWT 校验和实时 RBAC 检查,网关永远不持有 JWT 密钥,
   * 也不会接受浏览器传来的 userId、orgId 或权限声明。
   */
  app.post('/gateway/validate', { preHandler: [app.requirePermission(CODEX_HARNESS_PERMISSION)] }, async request => {
    const claim = request.user as {
      aud?: unknown
      scope?: unknown
      permission?: unknown
      exp?: number
    }
    const scopeList = Array.isArray(claim.scope) ? claim.scope : []
    if (
      claim.aud !== CODEX_HARNESS_AUDIENCE ||
      !scopeList.includes(CODEX_HARNESS_SCOPE) ||
      claim.permission !== CODEX_HARNESS_PERMISSION
    ) {
      throw httpError(403, 'FORBIDDEN', '无效的 Codex Harness 访问票据')
    }

    return {
      userId: request.currentUser.id,
      orgId: request.currentUser.orgId,
      expiresAt: new Date(claim.exp ? claim.exp * 1000 : Date.now()).toISOString()
    }
  })
}
