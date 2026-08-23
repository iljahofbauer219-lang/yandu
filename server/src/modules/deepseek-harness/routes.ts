import type { FastifyInstance } from 'fastify'
import { httpError } from '../../lib/errors.js'

/**
 * 远程 Harness 网关消费的短期访问票据。
 * 网关必须自行校验签名、aud、exp 和 permission，且以这些 claims 创建会话命名空间；
 * 不能接受浏览器传来的 userId/orgId。
 */
export async function deepSeekHarnessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/access-ticket', { preHandler: [app.requirePermission('menu.advisor.harness')] }, async request => {
    const user = request.currentUser
    const expiresIn = '5m'
    const ticket = app.jwt.sign({
      sub: user.id,
      org: user.orgId,
      aud: 'deepseek-harness-gateway',
      scope: ['harness:web'],
      permission: 'menu.advisor.harness'
    }, { expiresIn })
    return { ticket, expiresIn, audience: 'deepseek-harness-gateway' }
  })

  /**
   * 仅供同一私有 Docker 网络内的 Harness 网关调用。
   * 这里复用主服务的 JWT 校验和实时 RBAC 检查，网关永远不持有 JWT 密钥，
   * 也不会接受浏览器传来的 userId、orgId 或权限声明。
   */
  app.post('/gateway/validate', { preHandler: [app.requirePermission('menu.advisor.harness')] }, async request => {
    const claim = request.user
    if (
      claim.aud !== 'deepseek-harness-gateway' ||
      !claim.scope?.includes('harness:web') ||
      claim.permission !== 'menu.advisor.harness'
    ) {
      throw httpError(403, 'FORBIDDEN', '无效的 Harness 访问票据')
    }

    return {
      userId: request.currentUser.id,
      orgId: request.currentUser.orgId,
      expiresAt: new Date((claim as { exp?: number }).exp ? (claim as { exp: number }).exp * 1000 : Date.now()).toISOString()
    }
  })
}
