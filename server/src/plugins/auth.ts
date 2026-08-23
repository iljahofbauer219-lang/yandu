import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'

export interface CurrentUser {
  id: string
  orgId: string
  email: string
  name: string
  isOwner: boolean
  permissions: Set<string>
  /** null 表示可访问组织内全部店铺（主帐号）；否则为被授权的店铺 id 列表 */
  storeScope: string[] | null
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requirePermission: (code: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; org: string; aud?: string; scope?: string[]; permission?: string }
    user: { sub: string; org: string; aud?: string; scope?: string[]; permission?: string; exp?: number }
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('currentUser', null as unknown as CurrentUser)

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: '未登录或登录已过期' })
    }
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: {
        roles: { include: { role: { include: { permissions: true } } } },
        storeGrants: true
      }
    })
    if (!user || user.orgId !== request.user.org) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: '账号不存在，请重新登录' })
    }
    if (user.status !== 'ACTIVE') {
      return reply.status(401).send({ error: 'ACCOUNT_DISABLED', message: '账号已被禁用，请联系主帐号' })
    }
    const permissions = new Set<string>()
    for (const userRole of user.roles) {
      for (const permission of userRole.role.permissions) permissions.add(permission.code)
    }
    request.currentUser = {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      isOwner: user.isOwner,
      permissions,
      storeScope: user.isOwner ? null : user.storeGrants.map(grant => grant.storeId)
    }
  })

  app.decorate('requirePermission', (code: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser
    if (!user.isOwner && !user.permissions.has(code)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: '没有该操作的权限', permission: code })
    }
  })
})

export function hasStoreAccess(user: CurrentUser, storeId: string): boolean {
  return user.storeScope === null || user.storeScope.includes(storeId)
}
