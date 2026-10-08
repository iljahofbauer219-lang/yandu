import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let SqliteDatabase: typeof import('node:sqlite').DatabaseSync

function readWarehouseState(id: string) {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT status, delisted_reason, delisted_at FROM supply_warehouse_products WHERE id = ?`).get(id) as {
    status: string
    delisted_reason: string
    delisted_at: string | null
  }
  database.close()
  return row
}

function countStoredPallets(warehouseProductId: string): number {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT COUNT(*) AS count FROM pallet_warehouse_items WHERE warehouse_product_id = ?`).get(warehouseProductId) as { count: number }
  database.close()
  return row.count
}

function readPalletState(warehouseProductId: string) {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT title, price_text, category, subcategory, tertiary_category FROM pallet_warehouse_items WHERE warehouse_product_id = ?`).get(warehouseProductId)
  database.close()
  return row
}

function readInboundWarehouseProductId(id: string): string | null {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  const row = database.prepare(`SELECT warehouse_product_id FROM inbound_processing_items WHERE id = ?`).get(id) as {
    warehouse_product_id: string | null
  }
  database.close()
  return row.warehouse_product_id
}

function insertLegacyPallet(id: string, warehouseProductId: string): void {
  const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
  database.prepare(`INSERT INTO pallet_warehouse_items (id, warehouse_product_id, warehouse_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, stored_at)
    VALUES (?, ?, 'GIGACLOUD', ?, ?, '', '$10', '家具', '卧室家具', '床架', ?, '2026-09-01T00:00:00.000Z')`)
    .run(id, warehouseProductId, id, `老货盘 ${id}`, `https://legacy/${id}`)
  database.close()
}

async function seedLegacyInboundTable() {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-inbound-gate-'))
  const { DatabaseSync } = await import('node:sqlite')
  SqliteDatabase = DatabaseSync
  const db = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
  db.exec(`
    CREATE TABLE supply_warehouse_products (
      id TEXT PRIMARY KEY,
      warehouse_code TEXT NOT NULL,
      selection_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      product_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      price_text TEXT NOT NULL DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '未分类',
      subcategory TEXT NOT NULL DEFAULT '待人工分类',
      tertiary_category TEXT NOT NULL DEFAULT '待细分',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(warehouse_code, source_url)
    );
    CREATE TABLE inbound_processing_items (
      id TEXT PRIMARY KEY,
      erp_product_id TEXT NOT NULL UNIQUE,
      platform_code TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      price_text TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      tertiary_category TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      collected_at TEXT NOT NULL DEFAULT '',
      title_edit TEXT NOT NULL DEFAULT '',
      price_edit TEXT NOT NULL DEFAULT '',
      category_edit TEXT NOT NULL DEFAULT '',
      subcategory_edit TEXT NOT NULL DEFAULT '',
      tertiary_edit TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      review_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO inbound_processing_items (id, erp_product_id, platform_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, collected_at, title_edit, tags, review_status, created_at, updated_at)
    VALUES ('legacy-1', 'erp-1', 'GIGACLOUD', 'C1', '老标题', '', '10', '家具', '', '', 'https://x/1', '2026-09-01T00:00:00.000Z', '改后标题', '["重点"]', 'CONFIRMED', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
  `)
  db.close()
}

function seedInvalidLegacyInboundTable(directory: string): void {
  const db = new SqliteDatabase(path.join(directory, 'sourcing-data.sqlite'))
  db.exec(`
    CREATE TABLE inbound_processing_items (
      id TEXT PRIMARY KEY,
      erp_product_id TEXT NOT NULL UNIQUE,
      platform_code TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      price_text TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      tertiary_category TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      collected_at TEXT NOT NULL DEFAULT '',
      title_edit TEXT NOT NULL DEFAULT '',
      price_edit TEXT NOT NULL DEFAULT '',
      category_edit TEXT NOT NULL DEFAULT '',
      subcategory_edit TEXT NOT NULL DEFAULT '',
      tertiary_edit TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      review_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO inbound_processing_items (id, erp_product_id, tags, created_at, updated_at)
    VALUES ('invalid-legacy-1', 'invalid-erp-1', 'not-json', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
  `)
  db.close()
}

function seedSnapshotV2WithoutWarehouseProductId(directory: string): void {
  const db = new SqliteDatabase(path.join(directory, 'sourcing-data.sqlite'))
  db.exec(`
    CREATE TABLE supply_warehouse_products (
      id TEXT PRIMARY KEY,
      warehouse_code TEXT NOT NULL,
      selection_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      product_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      price_text TEXT NOT NULL DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '未分类',
      subcategory TEXT NOT NULL DEFAULT '待人工分类',
      tertiary_category TEXT NOT NULL DEFAULT '待细分',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(warehouse_code, source_url)
    );
    INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, title, created_at, updated_at) VALUES
      ('wh-source-id', '1688', '', 'https://warehouse/source-id', '按 id 回填', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      ('wh-selection-exact', 'GIGACLOUD', 'sel-shared', 'https://warehouse/exact', '按选品快照回填', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      ('wh-selection-other', '1688', 'sel-shared', 'https://warehouse/other', '歧义候选', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    CREATE TABLE inbound_processing_items (
      id TEXT PRIMARY KEY,
      origin TEXT NOT NULL,
      source_id TEXT NOT NULL,
      selection_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    INSERT INTO inbound_processing_items (id, origin, source_id, selection_id, snapshot_json, created_at, updated_at) VALUES
      ('queue-source-id', 'ERP', 'wh-source-id', '', '{"warehouseCode":"GIGACLOUD","sourceUrl":"https://changed/source-id"}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      ('queue-selection-exact', 'SELECTION', 'sel-shared', 'sel-shared', '{"warehouseCode":"GIGACLOUD","sourceUrl":"https://warehouse/exact"}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      ('queue-selection-ambiguous', 'SELECTION', 'legacy-ambiguous', 'sel-shared', '{"warehouseCode":"GIGACLOUD","sourceUrl":"https://changed/ambiguous"}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
  `)
  db.close()
}

let AppDatabase: typeof AppDatabaseType

describe('入库闸口与正式仓老库迁移', () => {
  beforeAll(async () => {
    await seedLegacyInboundTable()
    AppDatabase = (await import('../AppDatabase.js')).AppDatabase
  })

  it('老表平铺行搬运为 origin=ERP 快照行，编辑值覆盖原始值', () => {
    const db = new AppDatabase()
    const rows = db.listInbound()
    expect(rows).toHaveLength(1)
    expect(rows[0].origin).toBe('ERP')
    expect(rows[0].sourceId).toBe('erp-1')
    expect(rows[0].status).toBe('CONFIRMED')
    expect(rows[0].snapshot.title).toBe('改后标题')
    expect(rows[0].snapshot.warehouseCode).toBe('GIGACLOUD')
    expect(rows[0].snapshot.tags).toEqual(['重点'])
    expect(rows[0].confirmedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(readInboundWarehouseProductId(rows[0].id)).toBeNull()
  })

  it('v1 重建复制失败时回滚临时表并保留原表', () => {
    const originalDirectory = ctx.dir
    const failureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-inbound-migration-failure-'))
    let inspectionDatabase: import('node:sqlite').DatabaseSync | undefined
    seedInvalidLegacyInboundTable(failureDirectory)
    ctx.dir = failureDirectory

    try {
      expect(() => new AppDatabase()).toThrow()
      inspectionDatabase = new SqliteDatabase(path.join(failureDirectory, 'sourcing-data.sqlite'))
      const columns = inspectionDatabase.prepare(`PRAGMA table_info(inbound_processing_items)`).all() as Array<{ name: string }>
      expect(columns.map(column => column.name)).not.toContain('snapshot_json')
      const temporaryTable = inspectionDatabase.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inbound_processing_items_v2'`).get()
      expect(temporaryTable).toBeUndefined()
    } finally {
      inspectionDatabase?.close()
      ctx.dir = originalDirectory
    }
  })

  it('已有 snapshot_json v2 表启动时补列并仅回填可唯一确认的正式仓关联', () => {
    const originalDirectory = ctx.dir
    const v2Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-inbound-v2-'))
    seedSnapshotV2WithoutWarehouseProductId(v2Directory)
    ctx.dir = v2Directory

    try {
      new AppDatabase()
      const database = new SqliteDatabase(path.join(v2Directory, 'sourcing-data.sqlite'))
      const columns = database.prepare(`PRAGMA table_info(inbound_processing_items)`).all() as Array<{ name: string }>
      expect(columns.map(column => column.name)).toContain('warehouse_product_id')
      const rows = database.prepare(`SELECT id, warehouse_product_id FROM inbound_processing_items ORDER BY id`).all() as Array<{
        id: string
        warehouse_product_id: string | null
      }>
      expect(rows).toEqual([
        { id: 'queue-selection-ambiguous', warehouse_product_id: null },
        { id: 'queue-selection-exact', warehouse_product_id: 'wh-selection-exact' },
        { id: 'queue-source-id', warehouse_product_id: 'wh-source-id' }
      ])
      database.close()
    } finally {
      ctx.dir = originalDirectory
    }
  })
})

describe('入库闸口流转', () => {
  let db: AppDatabaseType
  beforeAll(() => {
    db = new AppDatabase()
  })

  function seedSelection(id: string, decision: string) {
    db.importSelectionForTest({
      id, taskId: 'task-1', sourceArea: 'SUPPLY', sourceUrl: `https://giga/${id}`, productId: 'P1', platformCode: 'GIGACLOUD',
      title: `闸口床 ${id}`, imageUrl: `https://giga/${id}.png`, priceText: '$10', score: 80, category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架',
      decision: decision as 'PENDING', reason: '', recommendation: '', riskFlags: [], updatedAt: '2026-09-25T00:00:00.000Z'
    })
  }

  function approve(id: string) {
    seedSelection(id, 'PENDING')
    db.updateSelectionDecision(id, 'APPROVED')
  }

  function seedDownloadFor(warehouseProductId: string): void {
    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    database.prepare(`INSERT OR IGNORE INTO supply_product_downloads (warehouse_product_id, directory, image_count, failed_count, detail_path, status, error, downloaded_at) VALUES (?, '', 3, 0, '', 'DOWNLOADED', '', '2026-10-08T00:00:00.000Z')`).run(warehouseProductId)
    database.close()
  }

  function queueIdAfterApprove(id: string): string {
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === id)!
    seedDownloadFor(warehouse.id)
    db.copyWarehouseToPallet(warehouse.id)
    return db.listInbound().find(item => item.warehouseProductId === warehouse.id)!.id
  }

  it('选品审批通过直接落正式入库 ACTIVE 行，不进入入库队列', () => {
    approve('sel-1')
    const warehouse = db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-1')
    expect(warehouse).toHaveLength(1)
    expect(warehouse[0]).toMatchObject({ warehouseCode: 'GIGACLOUD', status: 'ACTIVE', selectionId: 'sel-1' })
    expect(db.listInbound().filter(item => item.sourceId === 'sel-1')).toHaveLength(0)
  })

  it('下载资格可取得 ACTIVE 商品', () => {
    approve('sel-download-active')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-download-active')!

    expect(db.getDownloadableSupplyWarehouseProductById(warehouse.id)).toMatchObject({
      id: warehouse.id,
      status: 'ACTIVE'
    })
  })

  it('下载资格开放 DELISTED 商品（下架视图更新产品）', () => {
    approve('sel-download-delisted')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-download-delisted')!
    db.delistWarehouseProduct(warehouse.id, '供应商停售')

    expect(db.getDownloadableSupplyWarehouseProductById(warehouse.id)).toMatchObject({
      id: warehouse.id,
      status: 'DELISTED'
    })
  })

  it('下载资格拒绝 ARCHIVED 商品', () => {
    approve('sel-download-archived')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-download-archived')!
    db.updateSelectionDecision('sel-download-archived', 'PENDING')

    expect(db.getDownloadableSupplyWarehouseProductById(warehouse.id)).toBeUndefined()
  })

  it('审批直入正式入库，不写入库队列与货盘', () => {
    approve('sel-1b')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-1b')!
    expect(warehouse.status).toBe('ACTIVE')
    expect(db.listInbound().filter(item => item.warehouseProductId === warehouse.id)).toHaveLength(0)
    expect(db.listPalletItems().filter(item => item.warehouseProductId === warehouse.id)).toHaveLength(0)
  })

  it('确认入库双写正式入库与货盘存放，队列置 CONFIRMED', () => {
    approve('sel-2')
    const queueId = queueIdAfterApprove('sel-2')
    db.confirmInbound(queueId)
    const warehouse = db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-2')
    expect(warehouse).toHaveLength(1)
    expect(warehouse[0]).toMatchObject({ warehouseCode: 'GIGACLOUD', status: 'ACTIVE', selectionId: 'sel-2' })
    const pallet = db.listPalletItems().filter(item => item.warehouseProductId === warehouse[0].id)
    expect(pallet).toHaveLength(1)
    expect(db.listInbound().find(item => item.id === queueId)!.status).toBe('CONFIRMED')
    expect(db.listInbound().find(item => item.id === queueId)!.confirmedAt).not.toBeNull()
  })

  it('ERP 初次确认后持久关联正式仓，刷新不丢关联且篡改快照也不能绕过下架', () => {
    const sourceId = 'erp-server-product-1'
    const snapshot = {
      platformCode: 'GIGACLOUD', warehouseCode: 'GIGACLOUD' as const, itemCode: 'ERP-1', title: 'ERP 床', imageUrl: '', priceText: '$20',
      category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架', sourceUrl: 'https://erp.example/products/1', tags: [], collectedAt: '2026-09-25T00:00:00.000Z'
    }
    db.erpIntake([{ sourceId, snapshot }])
    const queue = db.listInbound().find(item => item.sourceId === sourceId)!

    db.confirmInbound(queue.id)

    const warehouse = db.getSupplyWarehouseProducts().find(item => item.sourceUrl === snapshot.sourceUrl)!
    expect(readInboundWarehouseProductId(queue.id)).toBe(warehouse.id)

    db.returnToInbound(warehouse.id)
    expect(db.listInbound().find(item => item.id === queue.id)?.status).toBe('PENDING')
    expect(readInboundWarehouseProductId(queue.id)).toBe(warehouse.id)

    db.erpIntake([{ sourceId, snapshot: { ...snapshot, title: 'ERP 刷新标题' } }])
    expect(db.listInbound().find(item => item.id === queue.id)?.snapshot.title).toBe('ERP 刷新标题')
    expect(readInboundWarehouseProductId(queue.id)).toBe(warehouse.id)

    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    database.prepare(`UPDATE supply_warehouse_products SET status = 'ACTIVE' WHERE id = ?`).run(warehouse.id)
    database.close()
    db.delistWarehouseProduct(warehouse.id, 'ERP 停售')
    db.reeditInbound(queue.id, { ...snapshot, warehouseCode: '1688', sourceUrl: 'https://changed.example/erp-1' })

    expect(() => db.confirmInbound(queue.id)).toThrow('已下架商品请先恢复后再确认入库')
    expect(readWarehouseState(warehouse.id).status).toBe('DELISTED')
    expect(countStoredPallets(warehouse.id)).toBe(0)
  })

  it('货盘插入失败时确认入库回滚队列和正式仓修改', () => {
    approve('sel-confirm-rollback')
    const queueId = queueIdAfterApprove('sel-confirm-rollback')
    const queue = db.listInbound().find(item => item.id === queueId)!
    const warehouseBefore = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-confirm-rollback')!
    db.reeditInbound(queueId, { ...queue.snapshot, title: '不应写入正式仓' })
    const database = (db as unknown as { database: { exec(sql: string): void } }).database
    database.exec(`CREATE TEMP TRIGGER fail_pallet_insert
      BEFORE INSERT ON pallet_warehouse_items
      BEGIN SELECT RAISE(ABORT, 'injected pallet failure'); END`)

    try {
      expect(() => db.confirmInbound(queueId)).toThrow('injected pallet failure')
      expect(db.listInbound().find(item => item.id === queueId)?.status).toBe('PENDING')
      expect(db.listPalletItems().some(item => item.warehouseProductId === warehouseBefore.id)).toBe(false)
      expect(db.getSupplyWarehouseProducts().find(item => item.id === warehouseBefore.id)).toEqual(warehouseBefore)
    } finally {
      database.exec('DROP TRIGGER IF EXISTS fail_pallet_insert')
    }
  })

  it('再次抄送货盘会将已有已确认快照 upsert 回 PENDING', () => {
    approve('sel-2b')
    const firstQueueId = queueIdAfterApprove('sel-2b')
    db.confirmInbound(firstQueueId)
    db.updateSelectionDecision('sel-2b', 'PENDING')
    db.updateSelectionDecision('sel-2b', 'APPROVED')
    const warehouseId = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-2b')!.id

    seedDownloadFor(warehouseId)
    db.copyWarehouseToPallet(warehouseId)

    expect(db.listInbound().find(item => item.id === firstQueueId)).toMatchObject({
      status: 'PENDING', confirmedAt: null
    })
  })

  it('已确认快照冻结：reedit 抛错', () => {
    approve('sel-3')
    const queueId = queueIdAfterApprove('sel-3')
    const item = db.listInbound().find(entry => entry.id === queueId)!
    db.confirmInbound(item.id)
    expect(() => db.reeditInbound(item.id, { ...item.snapshot, title: '改' })).toThrow('已确认商品请从正式入库退回后再修改')
  })

  it('退回入库处理：正式入库归档、货盘删除、队列回 PENDING', () => {
    approve('sel-4')
    db.confirmInbound(queueIdAfterApprove('sel-4'))
    const warehouseId = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-4')!.id
    db.returnToInbound(warehouseId)
    expect(db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-4')).toHaveLength(0)
    expect(db.listPalletItems().filter(item => item.warehouseProductId === warehouseId)).toHaveLength(0)
    const back = db.listInbound().find(entry => entry.warehouseProductId === warehouseId)!
    expect(back).toMatchObject({ origin: 'WAREHOUSE', status: 'PENDING' })
    expect(back.confirmedAt).toBeNull()
  })

  it('驳回保留正式仓锚点但不写货盘，重新编辑回 PENDING', () => {
    approve('sel-5')
    const queueId = queueIdAfterApprove('sel-5')
    const item = db.listInbound().find(entry => entry.id === queueId)!
    db.rejectInbound(item.id)
    const warehouse = db.getSupplyWarehouseProducts().find(entry => entry.selectionId === 'sel-5')!
    expect(warehouse.status).toBe('ACTIVE')
    expect(db.listPalletItems().some(entry => entry.warehouseProductId === warehouse.id)).toBe(false)
    expect(db.listInbound().find(entry => entry.id === queueId)!.status).toBe('REJECTED')
    db.reeditInbound(item.id, { ...item.snapshot, title: '复活' })
    const revived = db.listInbound().find(entry => entry.id === queueId)!
    expect(revived.status).toBe('PENDING')
    expect(revived.snapshot.title).toBe('复活')
  })

  it('正式入库商品可下架并记录去空格原因，恢复后统一为 ACTIVE', () => {
    approve('sel-7')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-7')!
    db.delistWarehouseProduct(warehouse.id, '  供应商停售  ')

    expect(db.getSupplyWarehouseProducts().some(item => item.id === warehouse.id)).toBe(false)
    const delisted = db.listDelistedWarehouseProducts().find(item => item.id === warehouse.id)!
    expect(delisted).toMatchObject({ status: 'DELISTED', delistedReason: '供应商停售' })
    expect(delisted.delistedAt).not.toBeNull()

    db.restoreWarehouseProduct(warehouse.id)
    expect(db.listDelistedWarehouseProducts().some(item => item.id === warehouse.id)).toBe(false)
    expect(db.getSupplyWarehouseProducts().find(item => item.id === warehouse.id)).toMatchObject({
      status: 'ACTIVE', delistedReason: '', delistedAt: null
    })
  })

  it('DELISTED 商品变更为非审批决定时保留状态与下架元数据', () => {
    approve('sel-10a')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-10a')!
    db.delistWarehouseProduct(warehouse.id, '永久停售')
    const before = readWarehouseState(warehouse.id)

    db.updateSelectionDecision('sel-10a', 'PENDING')

    expect(readWarehouseState(warehouse.id)).toEqual(before)
  })

  it('DELISTED 商品重新审批仍保留状态与下架元数据', () => {
    approve('sel-10b')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-10b')!
    db.delistWarehouseProduct(warehouse.id, '供应商停售')
    const before = readWarehouseState(warehouse.id)

    db.updateSelectionDecision('sel-10b', 'APPROVED')

    expect(readWarehouseState(warehouse.id)).toEqual(before)
  })

  it('下架后的遗留 PENDING 快照不能确认入库且不写货盘', () => {
    approve('sel-11')
    const queueId = queueIdAfterApprove('sel-11')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-11')!
    db.delistWarehouseProduct(warehouse.id, '停售')
    const before = readWarehouseState(warehouse.id)
    let thrown: unknown

    try {
      db.confirmInbound(queueId)
    } catch (error) {
      thrown = error
    }

    expect(readWarehouseState(warehouse.id)).toEqual(before)
    expect(countStoredPallets(warehouse.id)).toBe(0)
    expect(db.listInbound().find(item => item.id === queueId)?.status).toBe('PENDING')
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('已下架商品请先恢复后再确认入库')
  })

  it('重编可变快照身份后仍按 selectionId 拒绝确认已下架正式仓', () => {
    approve('sel-identity-guard')
    const queueId = queueIdAfterApprove('sel-identity-guard')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-identity-guard')!
    const queue = db.listInbound().find(item => item.id === queueId)!
    db.delistWarehouseProduct(warehouse.id, '停售')
    db.reeditInbound(queueId, {
      ...queue.snapshot,
      warehouseCode: '1688',
      sourceUrl: 'https://changed.example/item'
    })
    const palletCountBefore = db.listPalletItems().length

    expect(() => db.confirmInbound(queueId)).toThrow('已下架商品请先恢复后再确认入库')
    expect(db.listInbound().find(item => item.id === queueId)?.status).toBe('PENDING')
    expect(db.listDelistedWarehouseProducts().filter(item => item.id === warehouse.id)).toHaveLength(1)
    expect(db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-identity-guard')).toHaveLength(0)
    expect(db.listPalletItems()).toHaveLength(palletCountBefore)
    expect(countStoredPallets(warehouse.id)).toBe(0)
  })

  it('历史队列缺少关联键且 selectionId 命中多个正式仓时拒绝任取一行', () => {
    approve('sel-ambiguous-link')
    const queueId = queueIdAfterApprove('sel-ambiguous-link')
    const queue = db.listInbound().find(item => item.id === queueId)!
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-ambiguous-link')!
    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
      SELECT 'wh-ambiguous-second', warehouse_code, selection_id, 'https://other.example/ambiguous', product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, 'ACTIVE', payload, created_at, '2099-01-01T00:00:00.000Z'
      FROM supply_warehouse_products WHERE id = ?`).run(warehouse.id)
    database.prepare(`UPDATE inbound_processing_items SET warehouse_product_id = NULL, origin = 'SELECTION', source_id = 'sel-ambiguous-link' WHERE id = ?`).run(queueId)
    database.close()
    db.reeditInbound(queueId, { ...queue.snapshot, warehouseCode: '1688', sourceUrl: 'https://changed.example/ambiguous' })

    expect(() => db.confirmInbound(queueId)).toThrow('关联到多个正式仓商品')
    expect(db.listInbound().find(item => item.id === queueId)?.status).toBe('PENDING')
    expect(countStoredPallets(warehouse.id)).toBe(0)
    expect(countStoredPallets('wh-ambiguous-second')).toBe(0)
  })

  it('货盘列表保留 ARCHIVED、ACTIVE 与无父记录的老数据', () => {
    approve('sel-12a')
    db.confirmInbound(queueIdAfterApprove('sel-12a'))
    const archived = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-12a')!
    db.updateSelectionDecision('sel-12a', 'PENDING')

    approve('sel-12b')
    const activeRow = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-12b')!
    insertLegacyPallet('legacy-pending-pallet', activeRow.id)
    insertLegacyPallet('legacy-orphan-pallet', 'missing-warehouse-parent')

    const visibleWarehouseIds = db.listPalletItems().map(item => item.warehouseProductId)
    expect(visibleWarehouseIds).toEqual(expect.arrayContaining([
      archived.id,
      activeRow.id,
      'missing-warehouse-parent'
    ]))
  })

  it('非 DELISTED 商品不能执行恢复', () => {
    approve('sel-13')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-13')!

    expect(() => db.restoreWarehouseProduct(warehouse.id)).toThrow('仅已下架商品可恢复')
    expect(db.getSupplyWarehouseProducts().some(item => item.id === warehouse.id)).toBe(true)
  })

  it('已入货盘商品重新上架后直接回正式入库并立即恢复货盘显示', () => {
    approve('sel-8')
    db.confirmInbound(queueIdAfterApprove('sel-8'))
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-8')!
    expect(db.listPalletItems().some(item => item.warehouseProductId === warehouse.id)).toBe(true)

    db.delistWarehouseProduct(warehouse.id, '停售')
    expect(db.getSupplyWarehouseProducts().some(item => item.id === warehouse.id)).toBe(false)
    expect(db.listPalletItems().some(item => item.warehouseProductId === warehouse.id)).toBe(false)

    db.restoreWarehouseProduct(warehouse.id)
    expect(db.getSupplyWarehouseProducts().some(item => item.id === warehouse.id)).toBe(true)
    expect(db.listInbound().filter(item => item.warehouseProductId === warehouse.id && item.status === 'PENDING')).toHaveLength(0)
    expect(db.listPalletItems().some(item => item.warehouseProductId === warehouse.id)).toBe(true)
  })

  it('下架原因去空格后不能为空', () => {
    approve('sel-9')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-9')!
    expect(() => db.delistWarehouseProduct(warehouse.id, '   ')).toThrow('下架原因不能为空')
    expect(db.getSupplyWarehouseProducts().some(item => item.id === warehouse.id)).toBe(true)
  })

  it('启动回填跳过已有正式入库记录的 APPROVED 选品（存量豁免）', () => {
    seedSelection('sel-6', 'APPROVED')
    db.importWarehouseForTest('wh-6', 'sel-6')
    const reopened = new AppDatabase()
    expect(reopened.listInbound().filter(entry => entry.sourceId === 'sel-6')).toHaveLength(0)
    expect(reopened.getSupplyWarehouseProducts().filter(entry => entry.selectionId === 'sel-6')).toHaveLength(1)
  })

  it('启动迁移：遗留待复核行一次性并入正式入库', () => {
    approve('sel-migrate')
    const warehouse = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-migrate')!
    const database = new SqliteDatabase(path.join(ctx.dir, 'sourcing-data.sqlite'))
    database.prepare(`UPDATE supply_warehouse_products SET status = 'PENDING_REVIEW' WHERE id = ?`).run(warehouse.id)
    database.close()
    const reopened = new AppDatabase()
    expect(reopened.getSupplyWarehouseProducts().find(item => item.id === warehouse.id)?.status).toBe('ACTIVE')
  })
})
