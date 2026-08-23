import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { PERMISSION_CODE_SET, PERMISSION_LABELS } from '../rbac/permissions.js'

const saveRoleSchema = z.object({
  name: z.string().trim().min(1, '请填写角色名称').max(30),
  permissions: z.array(z.string()).default([])
})

function assertPermissionCodes(codes: string[]) {
  const invalid = codes.filter(code => !PERMISSION_CODE_SET.has(code))
  if (invalid.length > 0) {
    throw httpError(400, 'UNKNOWN_PERMISSION', `未知权限点: ${invalid.join(', ')}`)
  }
}

function serializeRole(role: {
  id: string; key: string | null; name: string; isSystem: boolean; createdAt: Date
  permissions: { code: string }[]; _count?: { users: number }
}) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    isSystem: role.isSystem,
    permissions: role.permissions.map(permission => permission.code),
    memberCount: role._count?.users ?? 0,
    createdAt: role.createdAt.toISOString()
  }
}

export async function roleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // 权限点目录（供角色编辑器使用）
  app.get('/permissions', async () => {
    return Object.entries(PERMISSION_LABELS).map(([code, label]) => ({ code, label }))
  })

  // 角色列表
  app.get('/', async (request) => {
    const roles = await prisma.role.findMany({
      where: { orgId: request.currentUser.orgId },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }]
    })
    return roles.map(serializeRole)
  })

  // 新建自定义角色
  app.post('/', { preHandler: [app.requirePermission('role.manage')] }, async (request) => {
    const body = saveRoleSchema.parse(request.body)
    assertPermissionCodes(body.permissions)
    const orgId = request.currentUser.orgId
    const duplicated = await prisma.role.findFirst({ where: { orgId, name: body.name } })
    if (duplicated) throw httpError(409, 'ROLE_NAME_TAKEN', '角色名称已存在')

    const role = await prisma.role.create({
      data: {
        orgId,
        name: body.name,
        permissions: { create: body.permissions.map(code => ({ code })) }
      },
      include: { permissions: true }
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'role.create', targetType: 'role', targetId: role.id,
      detail: { name: role.name, permissions: body.permissions }, ip: request.ip
    })
    return serializeRole(role)
  })

  // 编辑自定义角色
  app.patch('/:id', { preHandler: [app.requirePermission('role.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = saveRoleSchema.partial().parse(request.body)
    if (body.permissions) assertPermissionCodes(body.permissions)
    const orgId = request.currentUser.orgId
    const role = await prisma.role.findFirst({ where: { id, orgId }, include: { permissions: true } })
    if (!role) throw httpError(404, 'ROLE_NOT_FOUND', '角色不存在')
    if (role.isSystem) throw httpError(400, 'SYSTEM_ROLE_LOCKED', '预置角色不可修改，可新建自定义角色')

    await prisma.$transaction(async tx => {
      if (body.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } })
        await tx.rolePermission.createMany({ data: body.permissions.map(code => ({ roleId: role.id, code })) })
      }
      if (body.name) await tx.role.update({ where: { id: role.id }, data: { name: body.name } })
    })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'role.update', targetType: 'role', targetId: role.id,
      detail: body, ip: request.ip
    })
    const updated = await prisma.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: true } })
    return serializeRole(updated)
  })

  // 删除自定义角色
  app.delete('/:id', { preHandler: [app.requirePermission('role.manage')] }, async (request) => {
    const { id } = request.params as { id: string }
    const orgId = request.currentUser.orgId
    const role = await prisma.role.findFirst({
      where: { id, orgId },
      include: { _count: { select: { users: true } } }
    })
    if (!role) throw httpError(404, 'ROLE_NOT_FOUND', '角色不存在')
    if (role.isSystem) throw httpError(400, 'SYSTEM_ROLE_LOCKED', '预置角色不可删除')
    if (role._count.users > 0) throw httpError(400, 'ROLE_IN_USE', '仍有成员使用该角色，请先调整成员角色')

    await prisma.role.delete({ where: { id: role.id } })
    await writeAudit(prisma, {
      orgId, userId: request.currentUser.id, action: 'role.delete', targetType: 'role', targetId: role.id,
      detail: { name: role.name }, ip: request.ip
    })
    return { ok: true }
  })
}
