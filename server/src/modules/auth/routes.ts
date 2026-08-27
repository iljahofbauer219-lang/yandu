import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { assertPasswordStrength, hashPassword, verifyPassword } from '../../lib/password.js'
import { prisma } from '../../lib/prisma.js'
import { seedOrgReferenceData } from '../../lib/seed.js'
import { ensureOrgDefaultTiers } from '../linduo/tier-seed.js'
import { generateRefreshToken, hashToken } from '../../lib/tokens.js'
import { PRESET_ROLES } from '../rbac/permissions.js'

/** 手机号校验：1 开头的 11 位数字 */
const phoneSchema = z.string().trim().regex(/^1\d{10}$/, '手机号格式不正确')

const registerSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名').max(30),
  email: phoneSchema,
  password: z.string()
})

const loginSchema = z.object({
  email: phoneSchema,
  password: z.string().min(1, '请输入密码')
})

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: z.string()
})

async function issueTokens(app: FastifyInstance, userId: string, orgId: string, meta: { ip: string; userAgent?: string }) {
  const accessToken = app.jwt.sign({ sub: userId, org: orgId }, { expiresIn: config.accessTokenTtl })
  const { token, hash } = generateRefreshToken()
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 3600 * 1000)
  await prisma.authToken.create({
    data: { userId, tokenHash: hash, expiresAt, ip: meta.ip, userAgent: meta.userAgent ?? null }
  })
  return { accessToken, refreshToken: token, refreshTokenExpiresAt: expiresAt.toISOString() }
}

export async function loadProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      org: { select: { id: true, name: true } },
      roles: { include: { role: { include: { permissions: true } } } },
      storeGrants: { include: { store: { select: { id: true, name: true, marketplaceId: true } } } }
    }
  })
  if (!user) throw httpError(401, 'UNAUTHORIZED', '账号不存在，请重新登录')
  const permissions = new Set<string>()
  for (const userRole of user.roles) {
    for (const permission of userRole.role.permissions) permissions.add(permission.code)
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isOwner: user.isOwner,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    org: user.org,
    roles: user.roles.map(userRole => ({ id: userRole.role.id, key: userRole.role.key, name: userRole.role.name })),
    permissions: user.isOwner ? ('ALL' as const) : [...permissions],
    stores: user.isOwner ? null : user.storeGrants.map(grant => grant.store)
  }
}

export async function authRoutes(app: FastifyInstance) {
  // 注册：无需组织名称。
  // - 库中无组织（首次安装）：自动创建默认组织「砚都跨境」，首个用户成为主帐号并直接登录（引导流程）。
  // - 已有组织：注册为待审核成员（PENDING），不自动登录，待管理员审核通过并分配权限后方可登录。
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body)
    assertPasswordStrength(body.password)
    const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true, status: true } })
    if (existing) {
      if (existing.status === 'REJECTED') throw httpError(409, 'REGISTER_REJECTED', '该手机号的注册申请未通过，请联系管理员')
      if (existing.status === 'PENDING') throw httpError(409, 'REGISTER_PENDING', '该手机号已提交注册申请，请等待管理员审核')
      throw httpError(409, 'EMAIL_TAKEN', '该手机号已注册，请直接登录')
    }

    const passwordHash = await hashPassword(body.password)
    const firstOrg = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } })

    if (firstOrg) {
      // 加入现有主组织，待审核
      const pendingUser = await prisma.user.create({
        data: {
          orgId: firstOrg.id,
          email: body.email,
          name: body.name,
          passwordHash,
          status: 'PENDING',
          mustChangePassword: false
        }
      })
      await writeAudit(prisma, {
        orgId: firstOrg.id, userId: pendingUser.id, action: 'auth.register',
        targetType: 'user', targetId: pendingUser.id,
        detail: { email: body.email, name: body.name, mode: 'join-request' }, ip: request.ip
      })
      return reply.status(200).send({ pending: true, message: '注册申请已提交，请等待管理员审核' })
    }

    // 首次安装：创建默认组织 + 预置角色 + 主帐号，直接登录
    const owner = await prisma.$transaction(async tx => {
      const org = await tx.organization.create({ data: { name: '砚都跨境' } })
      for (const preset of PRESET_ROLES) {
        await tx.role.create({
          data: {
            orgId: org.id,
            key: preset.key,
            name: preset.name,
            isSystem: true,
            permissions: { create: preset.permissions.map(code => ({ code })) }
          }
        })
      }
      const ownerRole = await tx.role.findFirstOrThrow({ where: { orgId: org.id, key: 'OWNER' } })
      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email: body.email,
          name: body.name,
          passwordHash,
          isOwner: true,
          roles: { create: [{ roleId: ownerRole.id }] }
        }
      })
      return user
    })
    await writeAudit(prisma, {
      orgId: owner.orgId, userId: owner.id, action: 'auth.register',
      targetType: 'organization', targetId: owner.orgId,
      detail: { orgName: '砚都跨境', email: body.email, mode: 'bootstrap' }, ip: request.ip
    })
    // 组织级参考数据种子（供应/市场平台、产品仓库、合规知识）。幂等，失败不阻断注册，可由运维重跑。
    try {
      await seedOrgReferenceData(owner.orgId)
    } catch (error) {
      request.log.error({ err: error, orgId: owner.orgId }, 'seedOrgReferenceData failed')
    }
    // Linduo 三组种子 + 进阶组默认 13 模型 + OWNER 进全开组（spec §4.2/§12）。幂等，失败不阻断注册。
    try {
      await ensureOrgDefaultTiers(owner.orgId)
    } catch (error) {
      request.log.error({ err: error, orgId: owner.orgId }, 'ensureOrgDefaultTiers failed')
    }
    const tokens = await issueTokens(app, owner.id, owner.orgId, { ip: request.ip, userAgent: request.headers['user-agent'] })
    return reply.status(200).send({ tokens, user: await loadProfile(owner.id) })
  })

  // 登录
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw httpError(401, 'BAD_CREDENTIALS', '手机号或密码不正确')
    }
    if (user.status === 'PENDING') {
      throw httpError(403, 'ACCOUNT_PENDING', '帐号审核中，请等待管理员审核')
    }
    if (user.status === 'REJECTED') {
      throw httpError(403, 'ACCOUNT_REJECTED', '注册申请未通过，请联系管理员')
    }
    if (user.status !== 'ACTIVE') {
      throw httpError(403, 'ACCOUNT_DISABLED', '账号已被禁用，请联系主帐号')
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await writeAudit(prisma, { orgId: user.orgId, userId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: request.ip })
    const tokens = await issueTokens(app, user.id, user.orgId, { ip: request.ip, userAgent: request.headers['user-agent'] })
    return { tokens, user: await loadProfile(user.id) }
  })

  // 刷新令牌（旋转：旧令牌立即吊销）
  app.post('/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body)
    const record = await prisma.authToken.findUnique({
      where: { tokenHash: hashToken(body.refreshToken) },
      include: { user: true }
    })
    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      throw httpError(401, 'INVALID_REFRESH_TOKEN', '刷新令牌无效或已过期，请重新登录')
    }
    if (record.user.status !== 'ACTIVE') {
      throw httpError(401, 'ACCOUNT_DISABLED', '账号已被禁用，请联系主帐号')
    }
    await prisma.authToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } })
    const tokens = await issueTokens(app, record.userId, record.user.orgId, { ip: request.ip, userAgent: request.headers['user-agent'] })
    return { tokens }
  })

  // 登出：吊销当前刷新令牌
  app.post('/logout', { preHandler: [app.authenticate] }, async (request) => {
    const body = refreshSchema.partial().parse(request.body ?? {})
    if (body.refreshToken) {
      await prisma.authToken.updateMany({
        where: { userId: request.currentUser.id, tokenHash: hashToken(body.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() }
      })
    }
    await writeAudit(prisma, { orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'auth.logout', targetType: 'user', targetId: request.currentUser.id, ip: request.ip })
    return { ok: true }
  })

  // 修改密码：吊销本人全部刷新令牌
  app.post('/change-password', { preHandler: [app.authenticate] }, async (request) => {
    const body = changePasswordSchema.parse(request.body)
    assertPasswordStrength(body.newPassword)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.currentUser.id } })
    if (!(await verifyPassword(body.oldPassword, user.passwordHash))) {
      throw httpError(400, 'BAD_CREDENTIALS', '原密码不正确')
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false }
    })
    await prisma.authToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await writeAudit(prisma, { orgId: user.orgId, userId: user.id, action: 'auth.change-password', targetType: 'user', targetId: user.id, ip: request.ip })
    return { ok: true, message: '密码已更新，其它登录态已失效' }
  })

  // 当前登录信息
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    return loadProfile(request.currentUser.id)
  })
}
