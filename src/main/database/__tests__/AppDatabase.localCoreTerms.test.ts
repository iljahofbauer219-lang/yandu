import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EbayLocalProductSnapshotInput } from '../../../shared/contracts'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let db: AppDatabaseType

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-local-core-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

const snapshotInput = (): EbayLocalProductSnapshotInput => ({
  listing: {
    id: 'listing-1', storeId: 'store-1', marketplaceId: 'EBAY_US', listingId: 'list-core-1', sku: '',
    title: '2PC Universal Bucket Racing Seats Stitch Red PVC Leather', price: '99.00', currency: 'USD',
    quantity: 1, imageUrl: '', categoryId: '', categoryName: '', status: 'ACTIVE',
    viewUrl: 'https://mock.invalid/itm/1', updatedAt: '2026-10-13T00:00:00.000Z'
  },
  details: { url: 'https://mock.invalid/itm/1', itemSpecifics: [], condition: 'New', imageUrls: [] },
  media: [],
  completeness: 80,
  missingFields: [],
  contentHash: 'hash-core-1',
  capturedAt: '2026-10-13T00:00:00.000Z'
})

describe('本地产品核心商品词落库', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('新建本地产品核心词默认空串，setter 写后可读回', async () => {
    db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'secret')
    const created = db.saveEbayLocalProductSnapshot({ ...snapshotInput(), listing: { ...snapshotInput().listing, storeId: store.id } })
    expect(created.coreTermZh).toBe('')
    expect(created.coreTermEn).toBe('')
    const updated = db.setEbayLocalProductCoreTerms(created.id, '赛车座椅', 'Racing Seat')
    expect(updated.coreTermZh).toBe('赛车座椅')
    expect(updated.coreTermEn).toBe('Racing Seat')
    const reread = db.getEbayLocalProducts().find(item => item.id === created.id)
    expect(reread?.coreTermZh).toBe('赛车座椅')
    expect(reread?.coreTermEn).toBe('Racing Seat')
  })

  it('入库队列商品核心词落仓行，确认入库随带入存放行', async () => {
    db = await freshDatabase()
    const now = '2026-10-13T00:00:00.000Z'
    const raw = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
    raw.prepare(`INSERT INTO selection_tasks (id,payload,stage,created_at) VALUES ('task-1','{}','DONE',?)`).run(now)
    raw.prepare(`INSERT INTO selection_records (id,task_id,ozon_url,decision,payload,updated_at) VALUES ('sel-1','task-1','','PENDING','{}',?)`).run(now)
    raw.prepare(`INSERT INTO supply_warehouse_products (id,warehouse_code,selection_id,source_url,product_id,title,image_url,price_text,supplier_name,category,subcategory,tertiary_category,status,payload,created_at,updated_at) VALUES ('wh-x','GIGACLOUD','sel-1','https://example.test/x','SKU-X','Jeep Hood Bonnet Cover','','$10','','汽配','','','ACTIVE','{}',?,?)`).run(now, now)
    const snapshot = JSON.stringify({ platformCode: 'GIGACLOUD', warehouseCode: 'GIGACLOUD', itemCode: 'SKU-X', title: 'Jeep Hood Bonnet Cover', imageUrl: '', priceText: '$10', category: '汽配', subcategory: '', tertiaryCategory: '', sourceUrl: 'https://example.test/x', tags: [], collectedAt: now })
    raw.prepare(`INSERT INTO inbound_processing_items (id,origin,source_id,selection_id,warehouse_product_id,status,snapshot_json,created_at,updated_at) VALUES ('inb-x','WAREHOUSE','src-x','','wh-x','PENDING',?,?,?)`).run(snapshot, now, now)
    raw.close()
    db.setCoreTerms('wh-x', '机盖', 'Hood Cover')
    expect(db.getCoreTermsContext('wh-x')?.store).toBe('warehouse')
    db.confirmInbound('inb-x')
    const pallet = db.listPalletItems().find(item => item.warehouseProductId === 'wh-x')
    expect(pallet?.coreTermZh).toBe('机盖')
    expect(pallet?.coreTermEn).toBe('Hood Cover')
  })
})
