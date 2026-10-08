import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let SqliteDatabase: typeof import('node:sqlite').DatabaseSync
let db: AppDatabaseType

function countRows(table: string, column: string, value: string): number {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as { count: number }
  database.close()
  return Number(row.count)
}

function warehouseSelectionId(warehouseId: string): string | null {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT selection_id FROM supply_warehouse_products WHERE id = ?`).get(warehouseId) as { selection_id: string | null }
  database.close()
  return row.selection_id
}

function eliminatedStatus(id: string): string {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT status FROM eliminated_products WHERE id = ?`).get(id) as { status: string }
  database.close()
  return row.status
}

function candidateDeletedAt(url: string): string | null {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT deleted_at FROM supply_candidates WHERE url = ?`).get(url) as { deleted_at: string | null }
  database.close()
  return row.deleted_at
}

beforeAll(async () => {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-reenable-'))
  const { DatabaseSync } = await import('node:sqlite')
  SqliteDatabase = DatabaseSync
  const { AppDatabase } = await import('../AppDatabase.js')
  db = new AppDatabase()
  const raw = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
  raw.exec(`
    INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-re', '{}', 'IDLE', '2026-10-08T00:00:00.000Z');
    INSERT INTO selection_records (id, task_id, ozon_url, decision, reason, payload, updated_at)
      VALUES ('sel-re-1', 'task-re', 'https://www.gigab2b.com/p/1', 'REJECTED', '淘汰', '{"platformCode":"GIGACLOUD","productId":"1"}', '2026-10-08T00:00:00.000Z');
    INSERT INTO selection_records (id, task_id, ozon_url, decision, reason, payload, updated_at)
      VALUES ('sel-re-2', 'task-re', 'https://www.gigab2b.com/p/2', 'REJECTED', '淘汰', '{"platformCode":"GIGACLOUD","productId":"2"}', '2026-10-08T00:00:00.000Z');
    INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, delisted_reason, delisted_at, region, created_at, updated_at)
      VALUES ('wh-re-2', 'GIGACLOUD', 'sel-re-2', 'https://www.gigab2b.com/p/2', '2', '守卫.fixture', '', '$1', 's', '家具', '卧室家具', '床架及底座', 'ACTIVE', '', NULL, '', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
    INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at)
      VALUES ('task-re', 'https://www.gigab2b.com/p/3', '{"platformCode":"GIGACLOUD","productId":"3","title":"候选.fixture"}', 0, 0, 0, '2026-10-08T00:00:00.000Z');
    INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
      VALUES ('elim-1', 'GIGACLOUD:1', 'GIGACLOUD', '1', 'https://www.gigab2b.com/p/1', '优选淘汰.fixture', '', '$1', 'SELECTION', 'sel-re-1', '淘汰', 'op', 'ACTIVE', '2026-10-08T00:00:00.000Z', NULL);
    INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
      VALUES ('elim-2', 'GIGACLOUD:2', 'GIGACLOUD', '2', 'https://www.gigab2b.com/p/2', '守卫.fixture', '', '$1', 'SELECTION', 'sel-re-2', '淘汰', 'op', 'ACTIVE', '2026-10-08T00:00:00.000Z', NULL);
    INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
      VALUES ('elim-3', 'GIGACLOUD:3', 'GIGACLOUD', '3', 'https://www.gigab2b.com/p/3', '候选淘汰.fixture', '', '$1', 'CANDIDATE', 'GIGACLOUD:https://www.gigab2b.com/p/3', '淘汰', 'op', 'ACTIVE', '2026-10-08T00:00:00.000Z', NULL);
    INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
      VALUES ('elim-4', 'GIGACLOUD:4', 'GIGACLOUD', '4', 'https://www.gigab2b.com/p/4', '丢失候选.fixture', 'https://img/4.jpg', '$4', 'CANDIDATE', 'GIGACLOUD:https://www.gigab2b.com/p/4', '淘汰', 'op', 'ACTIVE', '2026-10-08T00:00:00.000Z', NULL);
  `)
  raw.close()
})

describe('重新启用：优选淘汰打回采集候选', () => {
  it('SELECTION 源重新启用后选品记录删除（候选重新可见）且淘汰置 REENABLED', () => {
    db.reenableEliminated('elim-1')
    expect(eliminatedStatus('elim-1')).toBe('REENABLED')
    expect(countRows('selection_records', 'id', 'sel-re-1')).toBe(0)
  })

  it('SELECTION 源存在货盘仓副本时仍可打回：选品删除、仓副本保留并自动解绑', () => {
    db.reenableEliminated('elim-2')
    expect(eliminatedStatus('elim-2')).toBe('REENABLED')
    expect(countRows('selection_records', 'id', 'sel-re-2')).toBe(0)
    expect(warehouseSelectionId('wh-re-2')).toBeNull()
  })

  it('CANDIDATE 源保持反删候选行为', () => {
    db.reenableEliminated('elim-3')
    expect(eliminatedStatus('elim-3')).toBe('REENABLED')
    expect(candidateDeletedAt('https://www.gigab2b.com/p/3')).toBeNull()
  })

  it('CANDIDATE 源候选行已被后续采集覆盖丢失时按淘汰快照重建', () => {
    db.reenableEliminated('elim-4')
    expect(eliminatedStatus('elim-4')).toBe('REENABLED')
    expect(candidateDeletedAt('https://www.gigab2b.com/p/4')).toBeNull()
    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    const row = database.prepare(`SELECT payload FROM supply_candidates WHERE url = ?`).get('https://www.gigab2b.com/p/4') as { payload: string }
    database.close()
    expect(JSON.parse(row.payload).title).toBe('丢失候选.fixture')
    const workspace = db.getCandidateWorkspace()
    expect(workspace.supplyProducts.map(item => item.url)).toContain('https://www.gigab2b.com/p/4')
    expect(workspace.records.map(item => item.candidateKey)).toContain('GIGACLOUD:https://www.gigab2b.com/p/4')
  })
})

describe('启动迁移：历史 REENABLED 且候选行丢失的记录补建', () => {
  it('构造 AppDatabase 时自动补建候选与溯源', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-reenable-mig-'))
    const raw = new SqliteDatabase(path.join(dir, 'sourcing-data.sqlite'))
    raw.exec(`
      CREATE TABLE IF NOT EXISTS selection_tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS eliminated_products (
        id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, platform_code TEXT NOT NULL, product_id TEXT,
        source_url TEXT NOT NULL, title TEXT, image_url TEXT, price_text TEXT, origin TEXT NOT NULL,
        origin_record_id TEXT, reason TEXT, operator TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
        eliminated_at TEXT NOT NULL, reenabled_at TEXT
      );
      INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-mig', '{}', 'IDLE', '2026-10-08T00:00:00.000Z');
      INSERT INTO eliminated_products (id, identity_key, platform_code, product_id, source_url, title, image_url, price_text, origin, origin_record_id, reason, operator, status, eliminated_at, reenabled_at)
        VALUES ('elim-mig', 'GIGACLOUD:7', 'GIGACLOUD', '7', 'https://www.gigab2b.com/p/7', '历史丢失.fixture', '', '$7', 'CANDIDATE', 'GIGACLOUD:https://www.gigab2b.com/p/7', '淘汰', 'op', 'REENABLED', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
    `)
    raw.close()
    const previousDir = ctx.dir
    ctx.dir = dir
    try {
      const { AppDatabase } = await import('../AppDatabase.js')
      const migrated = new AppDatabase()
      const workspace = migrated.getCandidateWorkspace()
      expect(workspace.supplyProducts.map(item => item.url)).toContain('https://www.gigab2b.com/p/7')
      expect(workspace.records.map(item => item.candidateKey)).toContain('GIGACLOUD:https://www.gigab2b.com/p/7')
    } finally {
      ctx.dir = previousDir
    }
  })
})
