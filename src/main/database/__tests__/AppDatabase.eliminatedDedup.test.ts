import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let SqliteDatabase: typeof import('node:sqlite').DatabaseSync
let db: AppDatabaseType

type EliminateInput = Parameters<AppDatabaseType['eliminateProduct']>[0]

function rowsForIdentity(productId: string) {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const rows = database.prepare(`SELECT id, status, reason, eliminated_at, reenabled_at FROM eliminated_products WHERE product_id = ? ORDER BY eliminated_at`).all(productId) as Array<Record<string, unknown>>
  database.close()
  return rows
}

beforeAll(async () => {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-elim-dedup-'))
  const { DatabaseSync } = await import('node:sqlite')
  SqliteDatabase = DatabaseSync
  const { AppDatabase } = await import('../AppDatabase.js')
  db = new AppDatabase()
})

describe('淘汰记录同身份去重', () => {
  it('同身份重复淘汰仅一行且刷新为最新一次', () => {
    const base: EliminateInput = { origin: 'CANDIDATE', platformCode: 'GIGACLOUD', productId: '500001', url: 'https://www.gigab2b.com/index.php?route=product/product&product_id=500001', title: '去重.fixture', priceText: '$5', operator: 'op' }
    db.eliminateProduct({ ...base, reason: '第一次' })
    db.eliminateProduct({ ...base, reason: '第二次' })
    const rows = rowsForIdentity('500001')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ACTIVE')
    expect(rows[0].reason).toBe('第二次')
  })

  it('重新启用后再淘汰仍仅一行且清除重新启用时间', () => {
    const base: EliminateInput = { origin: 'CANDIDATE', platformCode: 'GIGACLOUD', productId: '500002', url: 'https://www.gigab2b.com/index.php?route=product/product&product_id=500002', title: '循环.fixture', priceText: '$6', operator: 'op' }
    const first = db.eliminateProduct({ ...base, reason: '首轮' })
    db.reenableEliminated(first.id)
    db.eliminateProduct({ ...base, reason: '二轮' })
    const rows = rowsForIdentity('500002')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ACTIVE')
    expect(rows[0].reenabled_at).toBeNull()
  })
})

describe('启动合并迁移：历史重复行保留最新', () => {
  it('同身份多行合并为最新一行', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-elim-merge-'))
    const raw = new SqliteDatabase(path.join(dir, 'sourcing-data.sqlite'))
    raw.exec(`
      CREATE TABLE IF NOT EXISTS eliminated_products (
        id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, platform_code TEXT NOT NULL, product_id TEXT,
        source_url TEXT NOT NULL, title TEXT, image_url TEXT, price_text TEXT, origin TEXT NOT NULL,
        origin_record_id TEXT, reason TEXT, operator TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
        eliminated_at TEXT NOT NULL, reenabled_at TEXT
      );
      INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
        VALUES ('old-1', 'GIGACLOUD:600001', 'GIGACLOUD', '600001', 'https://www.gigab2b.com/p/600001', '合并.fixture', '', '$1', 'CANDIDATE', '', '旧', 'op', 'REENABLED', '2026-10-08T00:00:00.000Z', '2026-10-08T01:00:00.000Z');
      INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
        VALUES ('new-1', 'GIGACLOUD:600001', 'GIGACLOUD', '600001', 'https://www.gigab2b.com/p/600001', '合并.fixture', '', '$1', 'CANDIDATE', '', '新', 'op', 'ACTIVE', '2026-10-08T02:00:00.000Z', NULL);
    `)
    raw.close()
    const previousDir = ctx.dir
    ctx.dir = dir
    try {
      const { AppDatabase } = await import('../AppDatabase.js')
      const migrated = new AppDatabase()
      const rows = migrated.listEliminatedProducts().filter(item => item.productId === '600001')
      expect(rows).toHaveLength(1)
      expect(rows[0].reason).toBe('新')
    } finally {
      ctx.dir = previousDir
    }
  })
})
