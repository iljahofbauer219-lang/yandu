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

function seedPalletItem(warehouseProductId: string, title: string): void {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  database.prepare(`INSERT OR IGNORE INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-1', '{}', 'DONE', ?)`).run(NOW)
  database.prepare(`INSERT OR IGNORE INTO selection_records (id, task_id, ozon_url, decision, payload, updated_at) VALUES ('sel-1', 'task-1', '', 'APPROVED', '{}', ?)`).run(NOW)
  database.prepare(`INSERT OR IGNORE INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
    VALUES (?, 'GIGACLOUD', 'sel-1', ?, 'SKU-1', ?, '', '$10', '', '家具', '卧室家具', '床架', 'ACTIVE', '{}', ?, ?)`)
    .run(warehouseProductId, `https://example.test/${warehouseProductId}`, title, NOW, NOW)
  database.prepare(`INSERT OR IGNORE INTO pallet_warehouse_items (id, warehouse_product_id, warehouse_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, stored_at)
    VALUES (?, ?, 'GIGACLOUD', 'SKU-1', ?, '', '$10', '家具', '卧室家具', '床架', ?, ?)`)
    .run(`pallet-${warehouseProductId}`, warehouseProductId, title, `https://example.test/${warehouseProductId}`, NOW)
  database.close()
}

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-mypallet-'))
  const sqlite = await import('node:sqlite')
  SqliteDatabase = sqlite.DatabaseSync
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

describe('我的货盘：个人入选关系独立于总货盘', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('加入后列表回读货盘仓库现行数据，重复加入幂等', async () => {
    db = await freshDatabase()
    seedPalletItem('wh-mine-1', '我的货盘商品一')
    db.addMyPalletItems(['wh-mine-1'])
    db.addMyPalletItems(['wh-mine-1'])
    expect(db.listMyPalletWarehouseIds()).toEqual(['wh-mine-1'])
    const list = db.listMyPalletItems()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('我的货盘商品一')
    expect(db.listPalletItems()).toHaveLength(1)
  })

  it('总货盘不存在的 id 被忽略，不写孤儿关系', async () => {
    db = await freshDatabase()
    seedPalletItem('wh-mine-2', '我的货盘商品二')
    db.addMyPalletItems(['wh-mine-ghost'])
    expect(db.listMyPalletWarehouseIds()).toEqual([])
    expect(db.listMyPalletItems()).toEqual([])
  })

  it('移出只删入选关系，总货盘不受影响', async () => {
    db = await freshDatabase()
    seedPalletItem('wh-mine-3', '我的货盘商品三')
    db.addMyPalletItems(['wh-mine-3'])
    db.removeMyPalletItems(['wh-mine-3'])
    expect(db.listMyPalletItems()).toEqual([])
    expect(db.listPalletItems().map(item => item.warehouseProductId)).toContain('wh-mine-3')
  })

  it('按加入时间倒序回读', async () => {
    db = await freshDatabase()
    seedPalletItem('wh-mine-4', '先加入')
    seedPalletItem('wh-mine-5', '后加入')
    db.addMyPalletItems(['wh-mine-4'])
    db.addMyPalletItems(['wh-mine-5'])
    expect(db.listMyPalletWarehouseIds()).toEqual(['wh-mine-5', 'wh-mine-4'])
  })

  it('总货盘删除后我的货盘同步消失，不残留内容', async () => {
    db = await freshDatabase()
    seedPalletItem('wh-mine-6', '随总货盘消失')
    db.addMyPalletItems(['wh-mine-6'])
    const palletRow = db.listPalletItems().find(item => item.warehouseProductId === 'wh-mine-6')
    expect(palletRow).toBeDefined()
    db.removePalletItems([palletRow!.id])
    expect(db.listMyPalletItems()).toEqual([])
    expect(db.listMyPalletWarehouseIds()).toEqual(['wh-mine-6'])
  })
})
