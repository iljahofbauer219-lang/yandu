import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let SqliteDatabase: typeof import('node:sqlite').DatabaseSync
let db: AppDatabaseType

const NOW = '2026-10-11T00:00:00.000Z'

function seedBase(): void {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  database.prepare(`INSERT OR IGNORE INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-1', '{}', 'DONE', ?)`).run(NOW)
  database.prepare(`INSERT OR IGNORE INTO selection_records (id, task_id, ozon_url, decision, payload, updated_at) VALUES ('sel-1', 'task-1', '', 'APPROVED', '{}', ?)`).run(NOW)
  database.close()
}

function seedWarehouse(id: string, withPallet: boolean): void {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
    VALUES (?, 'GIGACLOUD', 'sel-1', ?, ?, ?, '', '$10', '', '家具', '卧室家具', '床架', 'ACTIVE', '{}', ?, ?)`)
    .run(id, `https://example.test/${id}`, `SKU-${id}`, `下架卡商品 ${id}`, NOW, NOW)
  if (withPallet) {
    database.prepare(`INSERT INTO pallet_warehouse_items (id, warehouse_product_id, warehouse_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, stored_at)
      VALUES (?, ?, 'GIGACLOUD', ?, ?, '', '$10', '家具', '卧室家具', '床架', ?, ?)`)
      .run(`pallet-${id}`, id, `SKU-${id}`, `下架卡商品 ${id}`, `https://example.test/${id}`, NOW)
  }
  database.close()
}

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-delisted-'))
  const sqlite = await import('node:sqlite')
  SqliteDatabase = sqlite.DatabaseSync
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

describe('下架卡数据：DELISTED 仓行合并 pallet 同源事实', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('有 pallet 同源行时回读 Item Code/价格等事实并带下架追溯', async () => {
    db = await freshDatabase()
    seedBase()
    seedWarehouse('wh-dl-1', true)
    db.delistWarehouseProduct('wh-dl-1', '其它原因')
    const list = db.listDelistedPalletItems()
    expect(list).toHaveLength(1)
    expect(list[0].itemCode).toBe('SKU-wh-dl-1')
    expect(list[0].priceText).toBe('$10')
    expect(list[0].category).toBe('家具')
    expect(list[0].delistedReason).toBe('其它原因')
    expect(list[0].delistedAt).toBeTruthy()
    expect(db.listPalletItems().some(item => item.warehouseProductId === 'wh-dl-1')).toBe(false)
  })

  it('无 pallet 同源行时按仓行合成，追溯不丢', async () => {
    db = await freshDatabase()
    seedBase()
    seedWarehouse('wh-dl-2', false)
    db.delistWarehouseProduct('wh-dl-2', '供应商停售')
    const row = db.listDelistedPalletItems().find(item => item.warehouseProductId === 'wh-dl-2')
    expect(row).toBeDefined()
    expect(row?.id).toBe('delisted-wh-dl-2')
    expect(row?.itemCode).toBe('SKU-wh-dl-2')
    expect(row?.title).toBe('下架卡商品 wh-dl-2')
    expect(row?.delistedReason).toBe('供应商停售')
  })

  it('ACTIVE 商品不进下架卡列表', async () => {
    db = await freshDatabase()
    seedBase()
    seedWarehouse('wh-dl-3', true)
    expect(db.listDelistedPalletItems()).toHaveLength(0)
  })
})
