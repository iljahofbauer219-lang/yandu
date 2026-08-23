/**
 * SQLite → PG 业务数据导入 CLI。
 *
 * 用法：
 *   DATABASE_URL=postgresql://... pnpm import:sqlite -- --org <orgId> [--sqlite <path>] [--dry-run]
 *
 * 说明：
 * - --org 必填：目标组织 id（请先通过 /api/auth/register 创建组织与主帐号）
 * - --sqlite 缺省为本机 Electron userData 下的 sourcing-data.sqlite
 * - 幂等：ON CONFLICT DO NOTHING，可重复执行；已存在的行自动跳过
 * - 导入后主帐号天然可见全部店铺；子帐号店铺授权请通过 RBAC 店铺授权接口分配
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '../src/lib/prisma.js'
import { cleanupOrphanRows, formatImportStats, importFromSqlite, setFkTriggers } from '../src/lib/sqlite-import.js'

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--dry-run') args.dryRun = true
    else if (item === '--org') args.org = argv[++index] ?? ''
    else if (item === '--sqlite') args.sqlite = argv[++index] ?? ''
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const orgId = typeof args.org === 'string' ? args.org : ''
const sqlitePath = typeof args.sqlite === 'string'
  ? args.sqlite
  : join(homedir(), 'Library', 'Application Support', 'cross-border-sourcing-desktop', 'sourcing-data.sqlite')

if (!orgId) {
  console.error('缺少必填参数 --org <orgId>（目标组织 id）')
  process.exit(1)
}

console.log(`[import] SQLite: ${sqlitePath}`)
console.log(`[import] 目标组织: ${orgId}${args.dryRun ? '（dry-run，不写入）' : ''}`)

try {
  // SQLite 不强制外键，历史数据可能含孤儿行：导入前临时禁用 FK 触发器，导入后清理孤儿行再恢复
  if (!args.dryRun) await setFkTriggers(prisma, false)
  const stats = await importFromSqlite({ sqlitePath, orgId, dryRun: Boolean(args.dryRun), prisma })
  if (!args.dryRun) {
    const removed = await cleanupOrphanRows(prisma)
    if (removed > 0) console.log(`[import] 已清理 ${removed} 行孤儿数据（引用已删除记录，SQLite 时代遗留）`)
  }
  console.log(formatImportStats(stats))
  console.log('\n[import] 完成。提示：子帐号店铺授权请通过 /api/stores 授权接口另行分配。')
} catch (error) {
  console.error(`[import] 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (!args.dryRun) await setFkTriggers(prisma, true).catch(() => undefined)
  await prisma.$disconnect()
}
