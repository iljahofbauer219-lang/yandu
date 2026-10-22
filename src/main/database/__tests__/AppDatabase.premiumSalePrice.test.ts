import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EbayListing, EbayOptimizationDraftInput } from '../../../shared/contracts'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let db: AppDatabaseType

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-premium-price-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

const listing = (): EbayListing => ({
  id: 'listing-1', storeId: '', marketplaceId: 'EBAY_US', listingId: 'PALLET-price-1', sku: '',
  title: '2PC Universal Bucket Racing Seats Stitch Red PVC Leather', price: '235.00', currency: 'USD',
  quantity: 1, imageUrl: '', categoryId: '', categoryName: 'Automotive Parts', status: 'ACTIVE',
  viewUrl: 'https://mock.invalid/itm/1', updatedAt: '2026-10-22T00:00:00.000Z'
})

const draftInput = (storeId: string, salePrice?: string): EbayOptimizationDraftInput => ({
  storeId,
  listingId: 'PALLET-price-1',
  listing: listing(),
  selectedTitle: '2PC Universal Bucket Racing Seats PVC Leather Reclinable Slider Red Stitch',
  titleVariants: [],
  itemSpecifics: [],
  description: 'Front bucket seats with reclining slider.',
  imageUrl: 'https://mock.invalid/seat.jpg',
  scoreBefore: 0,
  scoreAfter: 0,
  salePrice,
  saleCurrency: salePrice ? 'USD' : undefined
})

describe('优品仓库草稿记录核算售价', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('采用建议销售价后，核算售价与币种随草稿落库且不覆盖线上快照价', async () => {
    db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    const saved = db.saveEbayOptimizationDraft(draftInput(store.id, '461.42'))
    expect(saved.salePrice).toBe('461.42')
    expect(saved.saleCurrency).toBe('USD')
    const [draft] = db.getEbayOptimizationDrafts(store.id)
    expect(draft.salePrice).toBe('461.42')
    expect(draft.saleCurrency).toBe('USD')
    expect(draft.listing.price).toBe('235.00')
  })

  it('旧草稿没有售价字段时按缺省读取，重新保存会覆盖同一条记录', async () => {
    db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    const legacy = db.saveEbayOptimizationDraft(draftInput(store.id))
    expect(legacy.salePrice).toBeUndefined()
    expect(db.getEbayOptimizationDrafts(store.id)[0].salePrice).toBeUndefined()
    db.saveEbayOptimizationDraft(draftInput(store.id, '520.00'))
    const drafts = db.getEbayOptimizationDrafts(store.id)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].id).toBe(legacy.id)
    expect(drafts[0].salePrice).toBe('520.00')
  })
})
