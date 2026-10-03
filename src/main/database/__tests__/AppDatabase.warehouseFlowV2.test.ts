import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let SqliteDatabase: typeof import('node:sqlite').DatabaseSync
let db: AppDatabaseType

const NOW = '2026-10-02T00:00:00.000Z'

function seedProduct(id: string, status: string): void {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  database.prepare(`INSERT OR IGNORE INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-1', '{}', 'DONE', ?)`).run(NOW)
  database.prepare(`INSERT OR IGNORE INTO selection_records (id, task_id, ozon_url, decision, payload, updated_at) VALUES ('sel-1', 'task-1', '', 'APPROVED', '{}', ?)`).run(NOW)
  database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
    VALUES (?, 'GIGACLOUD', 'sel-1', ?, 'SKU-1', '流程V2商品', '', '$10', '', '家具', '卧室家具', '床架', ?, '{}', ?, ?)`)
    .run(id, `https://example.test/${id}`, status, NOW, NOW)
  database.close()
}

function seedDownload(id: string): void {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  database.prepare(`INSERT INTO supply_product_downloads (warehouse_product_id, directory, image_count, failed_count, detail_path, status, error, downloaded_at) VALUES (?, '', 3, 0, '', 'DOWNLOADED', '', ?)`)
    .run(id, NOW)
  database.close()
}

function countDownloads(id: string): number {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT COUNT(*) AS count FROM supply_product_downloads WHERE warehouse_product_id = ?`).get(id) as { count: number }
  database.close()
  return row.count
}

function countInboundFor(warehouseProductId: string): number {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT COUNT(*) AS count FROM inbound_processing_items WHERE warehouse_product_id = ?`).get(warehouseProductId) as { count: number }
  database.close()
  return row.count
}

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-whflow-v2-'))
  const sqlite = await import('node:sqlite')
  SqliteDatabase = sqlite.DatabaseSync
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

describe('正式入库流程V2：本仓入库不抄送、地区标识、抄送与永久删除', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('本仓入库仅推进到正式入库，不再写入货盘仓库入库队列', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-1', 'PENDING_REVIEW')
    db.confirmWarehouseReview('wh-v2-1')
    expect(db.getSupplyWarehouseProducts().find(item => item.id === 'wh-v2-1')?.status).toBe('ACTIVE')
    expect(countInboundFor('wh-v2-1')).toBe(0)
  })

  it('地区标识持久化，抄送货盘写入带地区的入库队列行', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-2', 'ACTIVE')
    db.setSupplyRegion('wh-v2-2', '美国货盘')
    expect(db.getSupplyWarehouseProducts().find(item => item.id === 'wh-v2-2')?.region).toBe('美国货盘')
    db.copyWarehouseToPallet('wh-v2-2')
    const rows = db.listInbound().filter(item => item.warehouseProductId === 'wh-v2-2')
    expect(rows).toHaveLength(1)
    expect(rows[0].origin).toBe('WAREHOUSE')
    expect(rows[0].region).toBe('美国货盘')
    expect(rows[0].status).toBe('PENDING')
  })

  it('已下架商品仍可重新下载图文（更新产品）', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-3', 'DELISTED')
    expect(db.getDownloadableSupplyWarehouseProductById('wh-v2-3')?.id).toBe('wh-v2-3')
  })

  it('删除产品永久移除商品与下载档案', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-4', 'DELISTED')
    seedDownload('wh-v2-4')
    db.deleteSupplyProduct('wh-v2-4')
    expect(db.listDelistedWarehouseProducts().filter(item => item.id === 'wh-v2-4')).toHaveLength(0)
    expect(countDownloads('wh-v2-4')).toBe(0)
  })

  it('重新上架仅返回正式入库，不写入库队列', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-5', 'DELISTED')
    db.restoreWarehouseProduct('wh-v2-5')
    expect(db.getSupplyWarehouseProducts().find(item => item.id === 'wh-v2-5')?.status).toBe('ACTIVE')
    expect(countInboundFor('wh-v2-5')).toBe(0)
  })

  it('打回优选：归档离开正式入库、不写队列、货盘存放保留', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-6', 'ACTIVE')
    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    database.prepare(`INSERT INTO pallet_warehouse_items (id, warehouse_product_id, warehouse_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, stored_at)
      VALUES ('pallet-v2-6', 'wh-v2-6', 'GIGACLOUD', 'SKU-1', '流程V2商品', '', '$10', '家具', '卧室家具', '床架', 'https://example.test/wh-v2-6', ?)`).run(NOW)
    database.close()
    db.returnToPreferred('wh-v2-6')
    expect(db.getSupplyWarehouseProducts().filter(item => item.id === 'wh-v2-6')).toHaveLength(0)
    const raw = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    const row = raw.prepare(`SELECT status FROM supply_warehouse_products WHERE id = 'wh-v2-6'`).get() as { status: string }
    const palletCount = (raw.prepare(`SELECT COUNT(*) AS count FROM pallet_warehouse_items WHERE warehouse_product_id = 'wh-v2-6'`).get() as { count: number }).count
    raw.close()
    expect(row.status).toBe('ARCHIVED')
    expect(palletCount).toBe(1)
    expect(countInboundFor('wh-v2-6')).toBe(0)
  })
})
