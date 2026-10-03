/**
 * ERP 采集加工域角色迁移脚本（幂等可重跑）：
 * 逻辑已抽到 src/modules/auth/preset-roles.ts 的 syncPresetRoles()，与 server 启动路径共用。
 * 为现存组织补建 COLLECTOR、补齐新权限码，并回收预置已删除的码（如 COLLECTOR 的 erp.warehouse.edit）。
 * 运行：先启动 pnpm db:dev（或生产 RDS 配置好 .env），再执行 npm run migrate:erp-roles
 */
import { prisma } from '../src/lib/prisma.js'
import { syncPresetRoles } from '../src/modules/auth/preset-roles.js'

async function main(): Promise<void> {
  const result = await syncPresetRoles()
  console.log(`[migrate-erp-roles] orgs=${result.orgs} createdRoles=${result.createdRoles} grantedCodes=${result.grantedCodes} revokedCodes=${result.revokedCodes}`)
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
