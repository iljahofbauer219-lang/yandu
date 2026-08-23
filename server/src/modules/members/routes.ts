import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { assertPasswordStrength, hashPassword } from '../../lib/password.js'
import { prisma } from '../../lib/prisma.js'
import { OWNER_ROLE_KEY, PERMISSION_CODE_SET } from '../rbac/permissions.js'

const createMemberSchema = z.object({
  email: z.string().trim().regex(/^1\d{10}$/, '手机号格式不正确'),
  name: z.string().trim().min(1, '请填写姓名').max(30),
  password: z.string(),
  roleIds: z.array(z.string().min(1)).default([]),
  permissions: z.array(z.string()).default([]),
  storeIds: z.array(z.string().min(1)).default([])
})

const updateMemberSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  roleIds: z.array(z.string().min(1)).min(1, '请为子帐号选择角色').optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional()
})

const storeGrantsSchema = z.object({ storeIds: z.array(z.string().min(1)) })

const approveSchema = z.object({
  permissions: z.array(z.string()).min(1, '请为成员勾选使用权限')
})

const resetPasswordSchema = z.object({ password: z.string() })

const memberInclude = {
  roles: { include: { role: { select: { id: true, key: true, name: true, isSystem: true } } } },
  storeGrants: { include: { store: { select: { id: true, name: true, marketplaceId: true } } } }
} as const

function serializeMember(user: {
  id: string; email: string; name: string; isOwner: boolean; status: string
  mustChangePassword: boolean; lastLoginAt: Date | null; createdAt: Date
  roles: { role: { id: string; key: string | null; name: string; isSystem: boolean } }[]
  storeGrants: { store: { id: string; name: string; marketplaceId: string } }[]
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isOwner: user.isOwner,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    roles: user.roles.map(userRole => userRole.role),
    stores: user.storeGrants.map(grant => grant.store)
  }
}

/** 校验角色与店铺都属于当前组织，且不允许分配主帐号角色 */
async function validateAssignments(orgId: string, roleIds: string[], storeIds: string[]) {
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds }, orgId } })
  if (roles.length !== new Set(roleIds).size) throw httpError(400, 'ROLE_NOT_FOUND', '存在不属于本组织的角色')
  if (roles.some(role => role.key === OWNER_ROLE_KEY)) throw httpError(400, 'OWNER_ROLE_LOCKED', '主帐号角色不能分配给子帐号')
  const stores = await prisma.ebayStore.findMany({ where: { id: { in: storeIds }, orgId } })
  if (stores.length !== new Set(storeIds).size) throw httpError(400, 'STORE_NOT_FOUND', '存在不属于本组织的店铺')
}

async function findOrgMember(orgId: string, memberId: string) {
  const member = await prisma.user.findFirst({ where: { id: memberId, orgId }, include: memberInclude })
  if (!member) throw httpError(404, 'MEMBER_NOT_FOUND', '成员不存在')
  if (member.isOwner) throw httpError(400, 'CANNOT_MODIFY_OWNER', '不能对主帐号执行该操作')
  return member
}

export async function memberRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 成员列表
  app.get('/', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const users = await prisma.user.findMany({
      where: { orgId: request.currentUser.orgId },
      include: memberInclude,
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }]
    })
    return users.map(serializeMember)
  })

  // 创建子帐号（roleIds 与 permissions 二选一）
  app.post('/', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const body = createMemberSchema.parse(request.body)
    if (body.roleIds.length === 0 && body.permissions.length === 0) {
      throw httpError(400, 'NO_ROLE', '请为子帐号选择角色或权限')
    }
    assertPasswordStrength(body.password)
    const orgId = request.currentUser.orgId
    const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })
    if (existing) throw httpError(409, 'EMAIL_TAKEN', '该手机号已被使用')
    await validateAssignments(orgId, body.roleIds, body.storeIds)

    // 若传入 permissions，自动创建自定义角色
    let effectiveRoleIds = body.roleIds
    if (body.permissions.length > 0) {
      const validPerms = body.permissions.filter(code => PERMISSION_CODE_SET.has(code))
      if (validPerms.length === 0) throw httpError(400, 'INVALID_PERMISSION', '无有效权限点')
      const customRole = await prisma.role.create({
        data: {
          orgId,
          name: `自定义-${body.name}`,
          isSystem: false,
          permissions: { create: validPerms.map(code => ({ code })) }
        }
      })
      effectiveRoleIds = [customRole.id]
    }

    const member = await prisma.user.create({
      data: {
        orgId,
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        mustChangePassword: true,
        roles: { create: effectiveRoleIds.map(roleId => ({ roleId })) },
        storeGrants: { create: body.storeIds.map(storeId => ({ storeId })) }
      },
      include: memberInclude
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.create', targetType: 'user', targetId: member.id,
      detail: { email: member.email, name: member.name, roleIds: effectiveRoleIds, permissions: body.permissions, storeIds: body.storeIds }, ip: request.ip
    })
    return serializeMember(member)
  })

  // 编辑成员（姓名/角色/状态）
  app.patch('/:id', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = updateMemberSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)
    if (body.status === 'DISABLED' && member.id === request.currentUser.id) {
      throw httpError(400, 'CANNOT_DISABLE_SELF', '不能禁用自己的账号')
    }
    if (body.roleIds) await validateAssignments(orgId, body.roleIds, [])

    await prisma.$transaction(async tx => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: member.id } })
        await tx.userRole.createMany({ data: body.roleIds.map(roleId => ({ userId: member.id, roleId })) })
      }
      await tx.user.update({
        where: { id: member.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.status ? { status: body.status } : {})
        }
      })
      if (body.status === 'DISABLED') {
        await tx.authToken.updateMany({ where: { userId: member.id, revokedAt: null }, data: { revokedAt: new Date() } })
      }
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.update', targetType: 'user', targetId: member.id,
      detail: body, ip: request.ip
    })
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: member.id }, include: memberInclude })
    return serializeMember(updated)
  })

  // 分配店铺（全量替换）
  app.put('/:id/store-grants', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = storeGrantsSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)
    await validateAssignments(orgId, [], body.storeIds)

    await prisma.$transaction([
      prisma.userStoreGrant.deleteMany({ where: { userId: member.id } }),
      prisma.userStoreGrant.createMany({ data: body.storeIds.map(storeId => ({ userId: member.id, storeId })) })
    ])
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'grant.update', targetType: 'user', targetId: member.id,
      detail: { storeIds: body.storeIds }, ip: request.ip
    })
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: member.id }, include: memberInclude })
    return serializeMember(updated)
  })

  // 重置子帐号密码
  app.post('/:id/reset-password', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = resetPasswordSchema.parse(request.body)
    assertPasswordStrength(body.password)
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)

    await prisma.user.update({
      where: { id: member.id },
      data: { passwordHash: await hashPassword(body.password), mustChangePassword: true }
    })
    await prisma.authToken.updateMany({ where: { userId: member.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.reset-password', targetType: 'user', targetId: member.id, ip: request.ip
    })
    return { ok: true, message: '密码已重置，该成员下次登录需修改密码' }
  })

  // 修改成员使用权限（创建/更新其专属自定义角色，角色绑定随之收敛）
  app.put('/:id/permissions', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const { permissions } = request.body as { permissions?: unknown }
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)

    const requested = Array.isArray(permissions) ? permissions.filter((code): code is string => typeof code === 'string') : []
    const validPerms = requested.filter(code => PERMISSION_CODE_SET.has(code))
    if (validPerms.length === 0) throw httpError(400, 'PERMISSION_EMPTY', '请至少为成员勾选一个使用权限')

    // 找到成员当前绑定的非系统角色（专属自定义角色），有则更新，无则新建
    const customRole = member.roles.map(r => r.role).find(role => !role.isSystem)
    let roleId: string
    if (customRole) {
      roleId = customRole.id
      await prisma.rolePermission.deleteMany({ where: { roleId } })
      await prisma.rolePermission.createMany({ data: validPerms.map(code => ({ roleId, code })) })
      await prisma.role.update({ where: { id: roleId }, data: { name: `自定义-${member.name}` } })
    } else {
      const role = await prisma.role.create({
        data: {
          orgId,
          name: `自定义-${member.name}`,
          isSystem: false,
          permissions: { create: validPerms.map(code => ({ code })) }
        }
      })
      roleId = role.id
    }
    // 角色绑定收敛为专属自定义角色（解绑预置角色，权限以自定义角色为准）
    await prisma.userRole.deleteMany({ where: { userId: member.id, roleId: { not: roleId } } })
    if (!member.roles.some(r => r.role.id === roleId)) {
      await prisma.userRole.create({ data: { userId: member.id, roleId } })
    }

    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.update-permissions', targetType: 'user', targetId: member.id,
      detail: { email: member.email, permissions: validPerms }, ip: request.ip
    })
    return { ok: true, permissions: validPerms }
  })

  // 删除子帐号（物理删除：角色绑定/店铺授权/令牌级联清除，审计与用量日志保留并置空 userId）
  app.delete('/:id', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)
    if (member.id === request.currentUser.id) throw httpError(400, 'CANNOT_DELETE_SELF', '不能删除自己的账号')

    const customRoleIds = member.roles.map(r => r.role).filter(role => !role.isSystem).map(role => role.id)
    await prisma.user.delete({ where: { id: member.id } })
    // 清理其专属自定义角色（权限点随 Cascade 清除；若被其他成员复用则保留）
    for (const roleId of customRoleIds) {
      const remaining = await prisma.userRole.count({ where: { roleId } })
      if (remaining === 0) await prisma.role.delete({ where: { id: roleId } })
    }

    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.delete', targetType: 'user', targetId: member.id,
      detail: { email: member.email, name: member.name }, ip: request.ip
    })
    return { ok: true }
  })

  // 待审核注册列表
  app.get('/pending', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const users = await prisma.user.findMany({
      where: { orgId: request.currentUser.orgId, status: 'PENDING' },
      include: memberInclude,
      orderBy: { createdAt: 'asc' }
    })
    return users.map(serializeMember)
  })

  // 审核通过：勾选使用权限，自动创建自定义角色并激活
  app.post('/:id/approve', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = approveSchema.parse(request.body)
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)
    if (member.status !== 'PENDING') throw httpError(400, 'NOT_PENDING', '该成员不在待审核状态')
    const validPerms = body.permissions.filter(code => PERMISSION_CODE_SET.has(code))
    if (validPerms.length === 0) throw httpError(400, 'INVALID_PERMISSION', '无有效权限点')

    await prisma.$transaction(async tx => {
      const customRole = await tx.role.create({
        data: {
          orgId,
          name: `自定义-${member.name}`,
          isSystem: false,
          permissions: { create: validPerms.map(code => ({ code })) }
        }
      })
      await tx.userRole.deleteMany({ where: { userId: member.id } })
      await tx.userRole.create({ data: { userId: member.id, roleId: customRole.id } })
      await tx.user.update({ where: { id: member.id }, data: { status: 'ACTIVE' } })
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.approve', targetType: 'user', targetId: member.id,
      detail: { email: member.email, permissions: validPerms }, ip: request.ip
    })
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: member.id }, include: memberInclude })
    return serializeMember(updated)
  })

  // 审核拒绝
  app.post('/:id/reject', { preHandler: [app.requirePermission('member.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const orgId = request.currentUser.orgId
    const member = await findOrgMember(orgId, id)
    if (member.status !== 'PENDING') throw httpError(400, 'NOT_PENDING', '该成员不在待审核状态')

    await prisma.user.update({ where: { id: member.id }, data: { status: 'REJECTED' } })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'member.reject', targetType: 'user', targetId: member.id,
      detail: { email: member.email }, ip: request.ip
    })
    return { ok: true }
  })
}
