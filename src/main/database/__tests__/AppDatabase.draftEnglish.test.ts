import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EbayContentOptimizationRecordInput, EbayListing, EbayOptimizationDraftInput } from '../../../shared/contracts'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let db: AppDatabaseType

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-draft-english-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

const listing = (): EbayListing => ({
  id: 'listing-1', storeId: '', marketplaceId: 'EBAY_US', listingId: 'PALLET-en-1', sku: '',
  title: '2PC Universal Bucket Racing Seats Stitch Red PVC Leather', price: '235.00', currency: 'USD',
  quantity: 1, imageUrl: '', categoryId: '', categoryName: 'Automotive Parts', status: 'ACTIVE',
  viewUrl: 'https://mock.invalid/itm/1', updatedAt: '2026-10-22T00:00:00.000Z'
})

const CHINESE_SPEC_BLOCK = 'DETAILED SPECIFICATIONS\n- Item Code: W1739S00002\n- 产品类型: Combo Item\n- 产地: China\n- 组装长度 (英寸): 18.10\n- 产品重量 (磅): 61.00\n\nVERIFIED FEATURES\n- High Quality'

const draftInput = (storeId: string): EbayOptimizationDraftInput => ({
  storeId,
  listingId: 'PALLET-en-1',
  listing: listing(),
  selectedTitle: '2PC Universal Bucket Racing Seats PVC Leather Reclinable Slider Red Stitch',
  titleVariants: [],
  itemSpecifics: [],
  description: CHINESE_SPEC_BLOCK,
  imageUrl: 'https://mock.invalid/seat.jpg',
  scoreBefore: 0,
  scoreAfter: 0
})

const recordInput = (storeId: string): EbayContentOptimizationRecordInput => ({
  storeId,
  listingId: 'PALLET-en-1',
  selectedTitle: '2PC Universal Bucket Racing Seats PVC Leather Reclinable Slider Red Stitch',
  result: {
    sections: [
      { id: 'SPECIFICATIONS', title: 'Detailed Specifications', content: CHINESE_SPEC_BLOCK },
      { id: 'SUMMARY', title: 'Product Overview', content: '2PC Universal Bucket Racing Seats.' }
    ],
    sourceFacts: [
      { id: 'F001', kind: 'SPECIFICATION', text: '产品类型: Combo Item', source: 'ITEM_SPECIFIC', sourceLabel: 'eBay 属性：产品类型' },
      { id: 'F002', kind: 'FEATURE', text: 'High Quality', source: 'SOURCE_DESCRIPTION', sourceLabel: '服务器产品页原始详情' }
    ],
    benefits: [],
    scenarios: [],
    validation: { sourceFactCount: 2, coveredFactCount: 2, factCoverage: 100, numericFactCount: 2, missingNumericFacts: [], unsupportedClaimCount: 0, passed: true, warnings: [] },
    englishDescription: CHINESE_SPEC_BLOCK,
    chineseReference: '',
    translation: { model: 'qwen-mt-flash', translatedAt: '', segments: [] },
    storyboard: [],
    model: 'deepseek-v4-flash'
  }
})

describe('旧草稿与内容记录读取时中文规格键规范化', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('优品草稿读取时中文键英译或丢弃，英文行原样保留', async () => {
    db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    db.saveEbayOptimizationDraft(draftInput(store.id))
    const [draft] = db.getEbayOptimizationDrafts(store.id)
    expect(draft.description).toContain('- Product Type: Combo Item')
    expect(draft.description).toContain('- Assembled Length (in): 18.10')
    expect(draft.description).toContain('- Item Code: W1739S00002')
    expect(draft.description).toContain('- High Quality')
    expect(draft.description).not.toMatch(/[一-鿿]/)
  })

  it('内容记录的区块、最终详情与事实文本读取时一并规范化', async () => {
    db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    db.saveEbayContentOptimizationRecord(recordInput(store.id))
    const record = db.getEbayContentOptimizationRecord(store.id, 'PALLET-en-1')
    expect(record?.result.sections[0].content).toContain('- Product Type: Combo Item')
    expect(record?.result.sections[0].content).not.toMatch(/[一-鿿]/)
    expect(record?.result.sections[1].content).toBe('2PC Universal Bucket Racing Seats.')
    expect(record?.result.englishDescription).not.toMatch(/[一-鿿]/)
    expect(record?.result.sourceFacts[0].text).toBe('Product Type: Combo Item')
    expect(record?.result.sourceFacts[1].text).toBe('High Quality')
  })
})
