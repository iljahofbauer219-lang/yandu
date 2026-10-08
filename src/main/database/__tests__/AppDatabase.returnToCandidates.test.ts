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

beforeAll(async () => {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-return-candidates-'))
  const { DatabaseSync } = await import('node:sqlite')
  SqliteDatabase = DatabaseSync
  const { AppDatabase } = await import('../AppDatabase.js')
  db = new AppDatabase()
  const raw = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
  raw.exec(`
    INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-ret', '{}', 'IDLE', '2026-10-08T00:00:00.000Z');
    INSERT INTO selection_records (id, task_id, ozon_url, decision, reason, payload, updated_at)
      VALUES ('sel-ret-1', 'task-ret', 'https://www.gigab2b.com/index.php?route=product/product&product_id=1', 'PENDING', NULL, '{"platformCode":"GIGACLOUD","productId":"1"}', '2026-10-08T00:00:00.000Z');
    INSERT INTO selection_records (id, task_id, ozon_url, decision, reason, payload, updated_at)
      VALUES ('sel-ret-2', 'task-ret', 'https://www.gigab2b.com/index.php?route=product/product&product_id=2', 'PENDING', NULL, '{"platformCode":"GIGACLOUD","productId":"2"}', '2026-10-08T00:00:00.000Z');
    INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, delisted_reason, delisted_at, region, created_at, updated_at)
      VALUES ('wh-ret-1', 'GIGACLOUD', 'sel-ret-1', 'https://www.gigab2b.com/index.php?route=product/product&product_id=1', '1', '退回候选.fixture', '', '$1', 's', '家具', '卧室家具', '床架及底座', 'ACTIVE', '', NULL, '', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
  `)
  raw.close()
})

describe('返回AI候选：守卫语义与错误可感知', () => {
  it('存在货盘仓副本时抛中文全文守卫错误且数据不变', () => {
    expect(() => db.returnSelectionToCandidates('sel-ret-1')).toThrow('货盘仓库')
    expect(countRows('selection_records', 'id', 'sel-ret-1')).toBe(1)
    expect(countRows('supply_warehouse_products', 'selection_id', 'sel-ret-1')).toBe(1)
  })

  it('无货盘仓副本时正常退回候选', () => {
    expect(() => db.returnSelectionToCandidates('sel-ret-2')).not.toThrow()
    expect(countRows('selection_records', 'id', 'sel-ret-2')).toBe(0)
  })

  it('未知 id 抛中文全文错误', () => {
    expect(() => db.returnSelectionToCandidates('sel-missing')).toThrow('选品记录不存在')
  })
})
