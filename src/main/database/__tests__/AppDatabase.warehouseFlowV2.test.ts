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

/** 复用同一数据目录重开一次，用于验证构造期补修逻辑 */
async function reopenDatabase(): Promise<AppDatabaseType> {
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

describe('正式入库流程V2：本仓入库不抄送、地区标识、抄送与永久删除', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('审批通过直入正式入库 ACTIVE，不写入库队列', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-1', 'ARCHIVED')
    const raw = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    raw.prepare(`UPDATE selection_records SET payload = ? WHERE id = 'sel-1'`).run(JSON.stringify({ id: 'sel-1', taskId: 'task-1', sourceArea: 'SUPPLY', platformCode: 'GIGACLOUD', sourceUrl: 'https://example.test/wh-v2-1', productId: 'SKU-1', title: '流程V2商品', imageUrl: '', priceText: '$10', category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架' }))
    raw.close()
    db.updateSelectionDecision('sel-1', 'APPROVED')
    expect(db.getSupplyWarehouseProducts().find(item => item.id === 'wh-v2-1')?.status).toBe('ACTIVE')
    expect(countInboundFor('wh-v2-1')).toBe(0)
  })

  it('地区标识持久化，抄送货盘写入带地区的入库队列行', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-2', 'ACTIVE')
    db.setSupplyRegion('wh-v2-2', '美国货盘')
    expect(db.getSupplyWarehouseProducts().find(item => item.id === 'wh-v2-2')?.region).toBe('美国货盘')
    seedDownload('wh-v2-2')
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

  it('打回优选：回联选品记录转为待复核，优选列表重新可见', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-7', 'ACTIVE')
    expect(db.getSelectionCatalog().find(item => item.id === 'sel-1')?.decision).toBe('APPROVED')
    db.returnToPreferred('wh-v2-7')
    const item = db.getSelectionCatalog().find(candidate => candidate.id === 'sel-1')
    expect(item?.decision).toBe('PENDING')
    expect(item?.reason).toBe('自正式入库打回优选，待重新审核')
    const raw = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    const payload = JSON.parse(String((raw.prepare(`SELECT payload FROM selection_records WHERE id = 'sel-1'`).get() as { payload: string }).payload)) as { decision: string }
    raw.close()
    expect(payload.decision).toBe('PENDING')
  })

  it('打回优选：无回联选品记录时按仓库行合成待复核记录，商品不消失', async () => {
    db = await freshDatabase()
    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    // 生产库不开启外键约束（AppDatabase 未设 PRAGMA foreign_keys），历史行可能带空/悬空 selection_id
    database.prepare(`PRAGMA foreign_keys = OFF`).run()
    database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
      VALUES ('wh-v2-8', 'GIGACLOUD', '', 'https://example.test/wh-v2-8', 'SKU-899297', '直连入库商品', '', '$10', '', '家具', '卧室家具', '床架', 'ACTIVE', '{}', ?, ?)`).run(NOW, NOW)
    database.close()
    db.returnToPreferred('wh-v2-8')
    const item = db.getSelectionCatalog().find(candidate => candidate.sourceUrl === 'https://example.test/wh-v2-8')
    expect(item?.decision).toBe('PENDING')
    expect(item?.sourceArea).toBe('SUPPLY')
    expect(item?.platformCode).toBe('GIGACLOUD')
    expect(item?.productId).toBe('SKU-899297')
    expect(item?.title).toBe('直连入库商品')
    expect(item?.category).toBe('家具')
    expect(item?.tertiaryCategory).toBe('床架')
    const raw = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    const linked = (raw.prepare(`SELECT selection_id FROM supply_warehouse_products WHERE id = 'wh-v2-8'`).get() as { selection_id: string }).selection_id
    raw.close()
    expect(linked).toBe(item?.id)
  })

  it('打回优选后重新通过决策，归档仓库行复活为待复核', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-9', 'ACTIVE')
    db.returnToPreferred('wh-v2-9')
    expect(db.getSupplyWarehouseProducts().filter(item => item.id === 'wh-v2-9')).toHaveLength(0)
    db.updateSelectionDecision('sel-1', 'APPROVED')
    expect(db.getSupplyWarehouseProducts().find(item => item.id === 'wh-v2-9')?.status).toBe('ACTIVE')
  })

  it('启动补修：旧版打回优选遗留的「归档仓库行+通过态选品」重新出现在优选列表', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-10', 'ACTIVE')
    const legacy = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    legacy.prepare(`UPDATE supply_warehouse_products SET status = 'ARCHIVED' WHERE id = 'wh-v2-10'`).run()
    legacy.close()
    const reopened = await reopenDatabase()
    expect(reopened.getSelectionCatalog().find(item => item.id === 'sel-1')?.decision).toBe('PENDING')
    expect(reopened.getSelectionCatalog().find(item => item.id === 'sel-1')?.sourceUrl).toBe('https://example.test/wh-v2-10')
  })

  it('启动补修跳过抄送货盘留下的归档行，通过态选品不被降级', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-11', 'ACTIVE')
    seedDownload('wh-v2-11')
    db.copyWarehouseToPallet('wh-v2-11')
    const reopened = await reopenDatabase()
    expect(reopened.getSelectionCatalog().find(item => item.id === 'sel-1')?.decision).toBe('APPROVED')
  })

  it('抄送货盘前置：未下载图文拒绝且队列无写入', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-12', 'ACTIVE')
    db.setSupplyRegion('wh-v2-12', '美国货盘')
    expect(() => db.copyWarehouseToPallet('wh-v2-12')).toThrow('请先完成「下载图文」后再抄送货盘')
    expect(db.listInbound().filter(item => item.warehouseProductId === 'wh-v2-12')).toHaveLength(0)
  })

  it('抄送货盘前置：补 DOWNLOADED 记录后抄送成功', async () => {
    db = await freshDatabase()
    seedProduct('wh-v2-13', 'ACTIVE')
    db.setSupplyRegion('wh-v2-13', '美国货盘')
    seedDownload('wh-v2-13')
    db.copyWarehouseToPallet('wh-v2-13')
    expect(db.listInbound().filter(item => item.warehouseProductId === 'wh-v2-13')).toHaveLength(1)
  })
})
