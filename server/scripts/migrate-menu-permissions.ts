/**
 * 使用权限两级化迁移脚本（幂等可重跑）：
 * 1. 角色权限旧码 → 新两级码映射（module.* → menu.*）
 * 2. 现存组织系统预置角色（OWNER/OPERATOR/PUBLISHER/VIEWER）权限同步为新默认
 * 运行：先启动 pnpm db:dev（或生产 RDS 配置好 .env），再执行 pnpm migrate:menu-perms
 */
import { prisma } from '../src/lib/prisma.js'
import { PRESET_ROLES } from '../src/modules/rbac/permissions.js'

const CROSSBORDER_ALL = ['menu.crossborder', 'menu.crossborder.login', 'menu.crossborder.title', 'menu.crossborder.desc', 'menu.crossborder.image']

/** 旧模块码 → 新两级码映射 */
const OLD_TO_NEW: Record<string, string[]> = {
  'module.ebay': CROSSBORDER_ALL,
  'module.ai_crossborder': CROSSBORDER_ALL,
  'module.compliance': ['menu.planet', 'menu.planet.compliance'],
  'module.legacy': ['menu.planet', 'menu.planet.ops', 'menu.planet.compliance'],
  'module.admin': ['menu.hq', 'menu.hq.admin']
}

async function migrateRoleOldCodes(): Promise<number> {
  const oldRows = await prisma.rolePermission.findMany({
    where: { code: { in: Object.keys(OLD_TO_NEW) } },
    select: { roleId: true, code: true }
  })
  if (oldRows.length === 0) return 0

  const byRole = new Map<string, Set<string>>()
  for (const row of oldRows) {
    const target = OLD_TO_NEW[row.code] ?? []
    const set = byRole.get(row.roleId) ?? new Set<string>()
    for (const code of target) set.add(code)
    byRole.set(row.roleId, set)
  }

  let migratedRoles = 0
  for (const [roleId, newCodes] of byRole) {
    await prisma.$transaction(async tx => {
      const existing = await tx.rolePermission.findMany({ where: { roleId }, select: { code: true } })
      const existingCodes = new Set(existing.map(row => row.code))
      await tx.rolePermission.deleteMany({ where: { roleId, code: { in: Object.keys(OLD_TO_NEW) } } })
      const toCreate = [...newCodes].filter(code => !existingCodes.has(code))
      if (toCreate.length > 0) {
        await tx.rolePermission.createMany({ data: toCreate.map(code => ({ roleId, code })) })
      }
    })
    migratedRoles += 1
  }
  return migratedRoles
}

async function syncPresetRoles(): Promise<number> {
  const presetByKey = new Map(PRESET_ROLES.map(preset => [preset.key, preset]))
  const systemRoles = await prisma.role.findMany({
    where: { isSystem: true, key: { in: [...presetByKey.keys()] } },
    select: { id: true, key: true }
  })
  let synced = 0
  for (const role of systemRoles) {
    const preset = presetByKey.get(role.key as (typeof PRESET_ROLES)[number]['key'])
    if (!preset) continue
    await prisma.$transaction(async tx => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } })
      await tx.rolePermission.createMany({ data: preset.permissions.map(code => ({ roleId: role.id, code })) })
    })
    synced += 1
  }
  return synced
}

const migratedRoles = await migrateRoleOldCodes()
const syncedPresets = await syncPresetRoles()
console.log(`[migrate-menu-permissions] 旧码迁移角色数=${migratedRoles}，预置角色同步数=${syncedPresets}`)
await prisma.$disconnect()
