import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

async function seedLegacyInboundTable() {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-inbound-gate-'))
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
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
    INSERT INTO inbound_processing_items (id, erp_product_id, platform_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, collected_at, title_edit, tags, review_status, created_at, updated_at)
    VALUES ('legacy-1', 'erp-1', 'GIGACLOUD', 'C1', '老标题', '', '10', '家具', '', '', 'https://x/1', '2026-09-01T00:00:00.000Z', '改后标题', '["重点"]', 'CONFIRMED', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
  `)
  db.close()
}

let AppDatabase: typeof AppDatabaseType

describe('入库闸口队列迁移', () => {
  beforeAll(async () => {
    await seedLegacyInboundTable()
    AppDatabase = (await import('../AppDatabase')).AppDatabase
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

  it('选品审批通过不再直写正式入库，而是落 PENDING 选品快照', () => {
    seedSelection('sel-1', 'PENDING')
    db.updateSelectionDecision('sel-1', 'APPROVED')
    expect(db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-1')).toHaveLength(0)
    const queue = db.listInbound().filter(item => item.sourceId === 'sel-1')
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ origin: 'SELECTION', sourceId: 'sel-1', selectionId: 'sel-1', status: 'PENDING' })
    expect(queue[0].snapshot.title).toBe('闸口床 sel-1')
    expect(queue[0].snapshot.warehouseCode).toBe('GIGACLOUD')
  })

  it('确认入库双写正式入库与货盘存放，队列置 CONFIRMED', () => {
    seedSelection('sel-2', 'PENDING')
    db.updateSelectionDecision('sel-2', 'APPROVED')
    const queueId = db.listInbound().find(item => item.sourceId === 'sel-2')!.id
    db.confirmInbound(queueId)
    const warehouse = db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-2')
    expect(warehouse).toHaveLength(1)
    expect(warehouse[0]).toMatchObject({ warehouseCode: 'GIGACLOUD', status: 'ACTIVE', selectionId: 'sel-2' })
    const pallet = db.listPalletItems().filter(item => item.warehouseProductId === warehouse[0].id)
    expect(pallet).toHaveLength(1)
    expect(db.listInbound().find(item => item.sourceId === 'sel-2')!.status).toBe('CONFIRMED')
    expect(db.listInbound().find(item => item.sourceId === 'sel-2')!.confirmedAt).not.toBeNull()
  })

  it('已确认快照冻结：reedit 抛错', () => {
    seedSelection('sel-3', 'PENDING')
    db.updateSelectionDecision('sel-3', 'APPROVED')
    const item = db.listInbound().find(entry => entry.sourceId === 'sel-3')!
    db.confirmInbound(item.id)
    expect(() => db.reeditInbound(item.id, { ...item.snapshot, title: '改' })).toThrow('已确认商品请从正式入库退回后再修改')
  })

  it('退回入库处理：正式入库归档、货盘删除、队列回 PENDING', () => {
    seedSelection('sel-4', 'PENDING')
    db.updateSelectionDecision('sel-4', 'APPROVED')
    db.confirmInbound(db.listInbound().find(entry => entry.sourceId === 'sel-4')!.id)
    const warehouseId = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-4')!.id
    db.returnToInbound(warehouseId)
    expect(db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-4')).toHaveLength(0)
    expect(db.listPalletItems().filter(item => item.warehouseProductId === warehouseId)).toHaveLength(0)
    const back = db.listInbound().find(entry => entry.sourceId === 'sel-4')!
    expect(back).toMatchObject({ origin: 'SELECTION', sourceId: 'sel-4', status: 'PENDING' })
    expect(back.confirmedAt).toBeNull()
  })

  it('驳回不写任何库，重新编辑回 PENDING', () => {
    seedSelection('sel-5', 'PENDING')
    db.updateSelectionDecision('sel-5', 'APPROVED')
    const item = db.listInbound().find(entry => entry.sourceId === 'sel-5')!
    db.rejectInbound(item.id)
    expect(db.getSupplyWarehouseProducts().filter(entry => entry.selectionId === 'sel-5')).toHaveLength(0)
    expect(db.listInbound().find(entry => entry.sourceId === 'sel-5')!.status).toBe('REJECTED')
    db.reeditInbound(item.id, { ...item.snapshot, title: '复活' })
    const revived = db.listInbound().find(entry => entry.sourceId === 'sel-5')!
    expect(revived.status).toBe('PENDING')
    expect(revived.snapshot.title).toBe('复活')
  })

  it('启动回填跳过已有正式入库记录的 APPROVED 选品（存量豁免）', () => {
    seedSelection('sel-6', 'APPROVED')
    db.importWarehouseForTest('wh-6', 'sel-6')
    const reopened = new AppDatabase()
    expect(reopened.listInbound().filter(entry => entry.sourceId === 'sel-6')).toHaveLength(0)
  })
})
