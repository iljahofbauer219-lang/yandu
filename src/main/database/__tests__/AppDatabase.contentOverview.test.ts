import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EbayContentOptimizationRecordInput } from '../../../shared/contracts'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

const TITLE = '6" Running Boards Side Steps for 2009-2024 Dodge Ram 1500 2500 3500 Crew Cab'
const SPECS = '- Brand:XINHUIYING\n- Color:Black'
const WIPED_DESCRIPTION = `PRODUCT OVERVIEW\n\n\nDETAILED SPECIFICATIONS\n${SPECS}`

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-content-overview-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

const recordInput = (storeId: string, summaryContent: string): EbayContentOptimizationRecordInput => ({
  storeId,
  listingId: 'PALLET-overview-1',
  selectedTitle: TITLE,
  result: {
    sections: [
      { id: 'SUMMARY', title: 'Product Overview', content: summaryContent },
      { id: 'SPECIFICATIONS', title: 'Detailed Specifications', content: SPECS }
    ],
    sourceFacts: [
      { id: 'F001', kind: 'FEATURE', text: '图文描述', source: 'SOURCE_DESCRIPTION', sourceLabel: '服务器产品页原始详情' },
      { id: 'F002', kind: 'FEATURE', text: 'Heavy Duty Carbon Steel Construction', source: 'SOURCE_DESCRIPTION', sourceLabel: '服务器产品页原始详情' },
      { id: 'F003', kind: 'SPECIFICATION', text: 'Brand: XINHUIYING', source: 'ITEM_SPECIFIC', sourceLabel: 'eBay 属性：Brand' }
    ],
    benefits: [],
    scenarios: [],
    validation: { sourceFactCount: 3, coveredFactCount: 3, factCoverage: 100, numericFactCount: 0, missingNumericFacts: [], unsupportedClaimCount: 0, passed: true, warnings: [] },
    englishDescription: summaryContent ? `PRODUCT OVERVIEW\n${summaryContent}\n\nDETAILED SPECIFICATIONS\n${SPECS}` : WIPED_DESCRIPTION,
    chineseReference: '',
    translation: { model: 'qwen-mt-flash', translatedAt: '', segments: [] },
    storyboard: [],
    model: 'deepseek-v4-flash'
  }
})

describe('内容记录读取时空概览段确定性修复', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('落库 SUMMARY 被中文行清空时按标题+非中文FEATURE重建，最终详情同源重建', async () => {
    const db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    db.saveEbayContentOptimizationRecord(recordInput(store.id, ''))
    const record = db.getEbayContentOptimizationRecord(store.id, 'PALLET-overview-1')
    const summary = record?.result.sections.find(section => section.id === 'SUMMARY')
    expect(summary?.content).toBe(`${TITLE}. Heavy Duty Carbon Steel Construction.`)
    expect(record?.result.englishDescription).toContain(`PRODUCT OVERVIEW\n${TITLE}. Heavy Duty Carbon Steel Construction.`)
    expect(record?.result.sections.find(section => section.id === 'SPECIFICATIONS')?.content).toBe(SPECS)
  })

  it('非空 SUMMARY（含用户手改）不被修复覆盖', async () => {
    const db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    db.saveEbayContentOptimizationRecord(recordInput(store.id, 'Custom overview sentence.'))
    const record = db.getEbayContentOptimizationRecord(store.id, 'PALLET-overview-1')
    expect(record?.result.sections.find(section => section.id === 'SUMMARY')?.content).toBe('Custom overview sentence.')
  })

  it('修复只发生在读取层，落库原文不被改写', async () => {
    const db = await freshDatabase()
    const store = db.createEbayStore('美国主店', 'seller', 'encrypted')
    db.saveEbayContentOptimizationRecord(recordInput(store.id, ''))
    db.getEbayContentOptimizationRecord(store.id, 'PALLET-overview-1')
    const raw = (db as unknown as { database: { prepare(sql: string): { get(storeId: string, listingId: string): { payload: string } } } }).database.prepare('SELECT payload FROM ebay_content_optimization_records WHERE store_id=? AND listing_id=?').get(store.id, 'PALLET-overview-1')
    const stored = JSON.parse(raw.payload) as { result: { sections: Array<{ id: string; content: string }> } }
    expect(stored.result.sections.find(section => section.id === 'SUMMARY')?.content).toBe('')
  })
})