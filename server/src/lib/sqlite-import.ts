import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { PrismaClient } from '@prisma/client'

/**
 * SQLite → PG 业务数据导入器。
 *
 * 策略：
 * - 目标表 = PG public schema 全表 − 账号权限域表（组织/用户/角色/令牌/审计/用量）− _prisma_migrations
 * - 仅导入 SQLite 中实际存在的表；两库列名取交集，PG 侧额外补 org_id
 * - 列类型按 PG information_schema  coerce：jsonb 校验 JSON、boolean 0/1→bool、timestamp 透传 ISO、数值空串→NULL
 * - 按外键依赖拓扑序导入；INSERT ... ON CONFLICT DO NOTHING（幂等，可重复执行）
 * - 店铺/任务等 id 原样保留，全部业务外键随之保持有效
 */

export interface SqliteImportOptions {
  sqlitePath: string
  orgId: string
  dryRun?: boolean
  prisma: PrismaClient
}

export interface TableImportStat {
  table: string
  sqliteRows: number
  inserted: number
  skipped: number
  note?: string
}

const ACCOUNT_TABLES = new Set([
  'organizations', 'users', 'roles', 'role_permissions', 'user_roles',
  'user_store_grants', 'auth_tokens', 'audit_logs', 'ai_usage_logs', '_prisma_migrations'
])

const NUMERIC_TYPES = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'])

interface PgColumn {
  name: string
  dataType: string
  nullable: boolean
  hasDefault: boolean
}

function fallbackFor(dataType: string): unknown {
  if (dataType === 'boolean') return false
  if (dataType === 'jsonb') return '{}'
  if (dataType.startsWith('timestamp')) return new Date().toISOString()
  if (NUMERIC_TYPES.has(dataType)) return 0
  return ''
}

function coerceValue(value: unknown, column: PgColumn): unknown {
  if (value === null || value === undefined) return column.nullable ? null : fallbackFor(column.dataType)
  if (column.dataType === 'boolean') {
    return value === true || value === 1 || value === '1' || value === 'true'
  }
  if (column.dataType === 'jsonb') {
    const text = typeof value === 'string' ? value.trim() : JSON.stringify(value)
    if (!text) return column.nullable ? null : fallbackFor(column.dataType)
    JSON.parse(text) // 校验 JSON 合法性，不合法直接抛错并指明表/列
    return text
  }
  if (column.dataType.startsWith('timestamp')) {
    const text = String(value).trim()
    return text || (column.nullable ? null : new Date().toISOString())
  }
  if (NUMERIC_TYPES.has(column.dataType)) {
    if (value === '' || Number.isNaN(Number(value))) return column.nullable ? null : 0
    return Number(value)
  }
  return value
}

function placeholder(index: number, dataType: string): string {
  if (dataType === 'jsonb') return `$${index}::jsonb`
  if (dataType === 'boolean') return `$${index}::boolean`
  if (dataType === 'timestamp with time zone') return `$${index}::timestamptz`
  if (dataType === 'timestamp without time zone') return `$${index}::timestamp`
  return `$${index}`
}

export async function importFromSqlite(options: SqliteImportOptions): Promise<TableImportStat[]> {
  const { sqlitePath, orgId, dryRun = false, prisma } = options
  if (!existsSync(sqlitePath)) throw new Error(`SQLite 文件不存在：${sqlitePath}`)
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } })
  if (!org) throw new Error(`目标组织不存在：${orgId}（请先注册/创建组织）`)

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true })
  try {
    const sqliteTables = new Set(
      (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(row => row.name)
    )
    const pgTableRows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
    const targets = pgTableRows
      .map(row => row.table_name)
      .filter(name => !ACCOUNT_TABLES.has(name))
    const missingInSqlite = targets.filter(name => !sqliteTables.has(name))
    const importTables = targets.filter(name => sqliteTables.has(name))

    // 外键依赖拓扑排序（仅目标集合内部，忽略自引用）
    const fkRows = await prisma.$queryRawUnsafe<Array<{ table_name: string; depends_on: string }>>(
      `SELECT tc.table_name AS table_name, ccu.table_name AS depends_on
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
    )
    const targetSet = new Set(importTables)
    const indegree = new Map<string, number>(importTables.map(name => [name, 0]))
    const edges = new Map<string, string[]>()
    for (const fk of fkRows) {
      if (!targetSet.has(fk.table_name) || !targetSet.has(fk.depends_on) || fk.table_name === fk.depends_on) continue
      edges.set(fk.depends_on, [...(edges.get(fk.depends_on) ?? []), fk.table_name])
      indegree.set(fk.table_name, (indegree.get(fk.table_name) ?? 0) + 1)
    }
    const queue = importTables.filter(name => (indegree.get(name) ?? 0) === 0).sort()
    const ordered: string[] = []
    while (queue.length) {
      const current = queue.shift()!
      ordered.push(current)
      for (const next of edges.get(current) ?? []) {
        const remain = (indegree.get(next) ?? 0) - 1
        indegree.set(next, remain)
        if (remain === 0) queue.push(next)
        queue.sort()
      }
    }
    for (const name of importTables) if (!ordered.includes(name)) ordered.push(name) // 环兜底

    // PG 列元数据
    const columnRows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public'`
    )
    const pgColumns = new Map<string, PgColumn[]>()
    for (const row of columnRows) {
      pgColumns.set(row.table_name, [...(pgColumns.get(row.table_name) ?? []), {
        name: row.column_name, dataType: row.data_type, nullable: row.is_nullable === 'YES', hasDefault: row.column_default !== null
      }])
    }

    const stats: TableImportStat[] = []
    for (const table of ordered) {
      const sqliteCols = new Set((sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(col => col.name))
      const pgCols = pgColumns.get(table) ?? []
      const synthesized = pgCols.filter(col =>
        col.name !== 'org_id' && !sqliteCols.has(col.name) && !col.nullable && !col.hasDefault
      )
      // 插入列 = org_id + 交集列 + 必须兜底的缺列（NOT NULL 且无默认值）
      const insertCols = pgCols.filter(col => col.name === 'org_id' || sqliteCols.has(col.name) || synthesized.includes(col))
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>
      const stat: TableImportStat = { table, sqliteRows: rows.length, inserted: 0, skipped: 0 }
      if (synthesized.length) stat.note = `补默认值列：${synthesized.map(col => col.name).join(',')}`
      if (rows.length && !dryRun) {
        const colList = insertCols.map(col => `"${col.name}"`).join(', ')
        const marks = insertCols.map((col, index) => placeholder(index + 1, col.dataType)).join(', ')
        const sql = `INSERT INTO "${table}" (${colList}) VALUES (${marks}) ON CONFLICT DO NOTHING`
        await prisma.$transaction(async tx => {
          for (const row of rows) {
            const values = insertCols.map(col => {
              if (col.name === 'org_id') return orgId
              if (!sqliteCols.has(col.name)) return fallbackFor(col.dataType)
              try {
                return coerceValue(row[col.name], col)
              } catch (error) {
                throw new Error(`表 ${table} 列 ${col.name} 数据转换失败：${error instanceof Error ? error.message : String(error)}`)
              }
            })
            stat.inserted += await tx.$executeRawUnsafe(sql, ...values)
          }
        })
      }
      stat.skipped = rows.length - stat.inserted
      if (dryRun) stat.note = [stat.note, 'dry-run'].filter(Boolean).join('；')
      stats.push(stat)
    }
    for (const name of missingInSqlite.sort()) {
      stats.push({ table: name, sqliteRows: 0, inserted: 0, skipped: 0, note: 'SQLite 无此表，跳过' })
    }
    return stats
  } finally {
    sqlite.close()
  }
}

// ---------------------------------------------------------------- 外键临时开关与孤儿行清理
// SQLite 不强制外键约束，历史数据可能含引用已删记录的孤儿行；
// 导入前临时禁用 FK 触发器，导入后统一清理孤儿行再恢复

async function listPublicTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  )
  return rows.map(row => row.table_name)
}

/** 启用/禁用 public 全部表的触发器（FK 约束以触发器实现），需表所有者权限 */
export async function setFkTriggers(prisma: PrismaClient, enable: boolean): Promise<void> {
  const tables = await listPublicTables(prisma)
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ${enable ? 'ENABLE' : 'DISABLE'} TRIGGER ALL`)
  }
}

interface FkRelation {
  child: string
  child_cols: string[]
  parent: string
  parent_cols: string[]
}

/**
 * 清理孤儿行：删除外键指向不存在父行的子行。
 * 多轮循环直至清零（子表的孤儿行可能级联使其自身成为孤儿）。
 * 返回删除总行数
 */
export async function cleanupOrphanRows(prisma: PrismaClient): Promise<number> {
  const fks = await prisma.$queryRawUnsafe<FkRelation[]>(
    `SELECT con.conrelid::regclass::text AS child,
            ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(num, ord)
                  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num ORDER BY k.ord) AS child_cols,
            con.confrelid::regclass::text AS parent,
            ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(num, ord)
                  JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num ORDER BY k.ord) AS parent_cols
     FROM pg_constraint con
     WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace`
  )
  let totalRemoved = 0
  for (let pass = 0; pass < 10; pass += 1) {
    let removedThisPass = 0
    for (const fk of fks) {
      if (fk.child === fk.parent || fk.child_cols.length !== fk.parent_cols.length) continue
      const notNull = fk.child_cols.map(col => `"${col}" IS NOT NULL`).join(' AND ')
      const join = fk.child_cols.map((col, index) => `parent."${fk.parent_cols[index]}" = child."${col}"`).join(' AND ')
      removedThisPass += await prisma.$executeRawUnsafe(
        `DELETE FROM "${fk.child}" child WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM "${fk.parent}" parent WHERE ${join})`
      )
    }
    if (removedThisPass === 0) break
    totalRemoved += removedThisPass
  }
  return totalRemoved
}

export function formatImportStats(stats: TableImportStat[]): string {
  const lines = stats.map(stat => {
    const base = `${stat.table.padEnd(38)} 行=${String(stat.sqliteRows).padStart(5)} 导入=${String(stat.inserted).padStart(5)} 跳过=${String(stat.skipped).padStart(5)}`
    return stat.note ? `${base}  ${stat.note}` : base
  })
  const totalRows = stats.reduce((sum, stat) => sum + stat.sqliteRows, 0)
  const totalInserted = stats.reduce((sum, stat) => sum + stat.inserted, 0)
  return [...lines, '-'.repeat(70), `合计 行=${totalRows} 导入=${totalInserted} 跳过=${totalRows - totalInserted}`].join('\n')
}
