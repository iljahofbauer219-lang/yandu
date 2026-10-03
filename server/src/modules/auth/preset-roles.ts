/**
 * 预置角色幂等同步（P1-7）：为所有存量组织补齐 PRESET_ROLES 与新权限码。
 *
 * 背景：PRESET_ROLES 只在首个组织 bootstrap 注册时种入（auth/routes.ts），
 * 之后新增的角色（COLLECTOR）或新增/回收的权限码，存量组织永远拿不到。
 * 本模块把「幂等补齐」抽成可复用函数，供两条路径共用：
 *   1. server 启动路径（index.ts 追加一行调用）；
 *   2. scripts/migrate-erp-roles.ts（部署时手动跑，npm run migrate:erp-roles）。
 *
 * 同步语义（系统角色在 roles API 中锁定不可改，预置清单即权威）：
 *   - 角色缺失 → 按预置创建（isSystem=true）；
 *   - 权限码缺失 → 补齐；
 *   - 权限码多余（预置已回收，如 COLLECTOR 的 erp.warehouse.edit）→ 删除，保证存量与预置一致。
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../lib/prisma.js'
import { PRESET_ROLES } from '../rbac/permissions.js'

/** 参与同步的预置角色（PUBLISHER/VIEWER 无 ERP 增量，保持 migrate-erp-roles 原口径） */
const SYNC_KEYS = new Set(['OWNER', 'OPERATOR', 'COLLECTOR'])

export interface PresetRoleSyncResult {
  orgs: number
  createdRoles: number
  grantedCodes: number
  revokedCodes: number
}

/** 幂等同步预置角色与权限码；可重跑，重复执行零变更 */
export async function syncPresetRoles(prisma: PrismaClient = defaultPrisma): Promise<PresetRoleSyncResult> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let createdRoles = 0
  let grantedCodes = 0
  let revokedCodes = 0

  for (const org of orgs) {
    for (const preset of PRESET_ROLES) {
      if (!SYNC_KEYS.has(preset.key)) continue
      const presetCodes = new Set<string>(preset.permissions)
      const role = await prisma.role.findUnique({
        where: { orgId_key: { orgId: org.id, key: preset.key } }
      })
      if (!role) {
        await prisma.$transaction(async tx => {
          const created = await tx.role.create({
            data: { orgId: org.id, key: preset.key, name: preset.name, isSystem: true }
          })
          for (const code of preset.permissions) {
            await tx.rolePermission.create({ data: { roleId: created.id, code } })
          }
        })
        createdRoles += 1
        grantedCodes += preset.permissions.length
        continue
      }
      const existing = await prisma.rolePermission.findMany({
        where: { roleId: role.id },
        select: { code: true }
      })
      const existingCodes = new Set(existing.map(row => row.code))
      const missing = preset.permissions.filter(code => !existingCodes.has(code))
      for (const code of missing) {
        await prisma.rolePermission.create({ data: { roleId: role.id, code } })
      }
      grantedCodes += missing.length
      // 预置已回收的码同步删除（系统角色不可经 API 自定义，多余码只可能是旧版预置残留）
      const stale = existing.filter(row => !presetCodes.has(row.code)).map(row => row.code)
      if (stale.length > 0) {
        await prisma.rolePermission.deleteMany({ where: { roleId: role.id, code: { in: stale } } })
        revokedCodes += stale.length
      }
    }
  }

  return { orgs: orgs.length, createdRoles, grantedCodes, revokedCodes }
}
