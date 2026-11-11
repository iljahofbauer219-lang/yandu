import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'
import type { EbayItemSpecificsSection } from '../../../shared/ebayItemSpecificsModel'

/**
 * H1：类目属性槽位是「类目」的资产，不是「产品」的资产——同一个 eBay 类目下换产品，槽位清单完全一样
 * （2026-11-11 用户两问：每个类目属性不同，APP 如何更高效）。D 批按 product_id 落库导致同类目第二个产品
 * 进发布仍要开页重读；这里加一张按 (store_id, category_key) 主键的缓存表：读取成功双写，进发布先命中它，
 * 命中就不开页。语义与 D 批一致：没读过就是 null，绝不拼假清单；损坏行按没读过处理。
 */

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-category-specifics-test-'))
  return { app: { getPath: () => ctx.dir } }
})

const SECTION: EbayItemSpecificsSection = {
  slots: [
    { name: 'Brand', group: 'ESSENTIAL', groupLabel: 'Required', control: 'MENU', required: true, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [], y: 1477 },
    { name: 'Universal Fitment', group: 'OPTIONAL', groupLabel: 'Additional (optional)', control: 'YESNO', required: false, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '~ 104 searches', metaKind: 'SEARCH_COUNT', options: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], y: 2177 }
  ],
  groups: [
    { name: 'Required', blurb: 'Buyers need these details to find your item.' },
    { name: 'Additional (optional)', blurb: 'Buyers also search for these details.' }
  ],
  toggleExpandedText: 'Show less',
  toggleCollapsedText: 'Show more',
  customActionText: 'Add custom item specific',
  collapsedSlotNames: ['Brand']
}

describe('AppDatabase · 类目级槽位缓存（store + category 主键）', () => {
  let database: AppDatabaseType

  beforeAll(async () => {
    const { AppDatabase } = await import('../AppDatabase.js')
    database = new AppDatabase()
  })

  it('没读过的类目返回 null，编辑器照旧走兜底/静默自读，不拼假清单', () => {
    expect(database.getEbayCategorySpecificsSection('s1', 'cat-seats')).toBeNull()
  })

  it('读取成功即按 (store, category) 落库，回读得到同一段与来源、时间', () => {
    database.saveEbayCategorySpecificsSection({ storeId: 's1', categoryKey: 'cat-seats', section: SECTION, sourceUrl: 'https://www.ebay.com/lstng?draftId=1&mode=AddItem', readAt: '2026-11-11T06:00:00.000Z' })
    const row = database.getEbayCategorySpecificsSection('s1', 'cat-seats')
    expect(row).not.toBeNull()
    expect(row?.section.slots.map(slot => slot.name)).toEqual(['Brand', 'Universal Fitment'])
    expect(row?.sourceUrl).toContain('mode=AddItem')
    expect(row?.readAt).toBe('2026-11-11T06:00:00.000Z')
  })

  it('同类目重复读取整行覆盖不增行；异类目、异店铺互不串', () => {
    database.saveEbayCategorySpecificsSection({ storeId: 's1', categoryKey: 'cat-seats', section: { ...SECTION, slots: SECTION.slots.slice(0, 1) }, sourceUrl: 'https://www.ebay.com/lstng?draftId=2&mode=AddItem', readAt: '2026-11-11T07:00:00.000Z' })
    database.saveEbayCategorySpecificsSection({ storeId: 's1', categoryKey: 'cat-canopy', section: SECTION, sourceUrl: '', readAt: '' })
    database.saveEbayCategorySpecificsSection({ storeId: 's2', categoryKey: 'cat-seats', section: SECTION, sourceUrl: '', readAt: '' })
    const again = database.getEbayCategorySpecificsSection('s1', 'cat-seats')
    expect(again?.section.slots).toHaveLength(1)
    expect(again?.readAt).toBe('2026-11-11T07:00:00.000Z')
    expect(database.getEbayCategorySpecificsSection('s1', 'cat-canopy')?.section.slots).toHaveLength(2)
    expect(database.getEbayCategorySpecificsSection('s2', 'cat-seats')?.section.slots).toHaveLength(2)
  })

  it('section_json 损坏按没读过处理并告警，不把坏 JSON 抛给渲染器', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    database.saveEbayCategorySpecificsSection({ storeId: 's1', categoryKey: 'cat-broken', section: SECTION, sourceUrl: '', readAt: '' })
    // 直接把手写坏行塞进同一张表，模拟历史数据损坏
    ;(database as unknown as { database: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).database
      .prepare('UPDATE ebay_category_specifics SET section_json=? WHERE store_id=? AND category_key=?')
      .run('{not json', 's1', 'cat-broken')
    expect(database.getEbayCategorySpecificsSection('s1', 'cat-broken')).toBeNull()
    expect(warn.mock.calls.some(call => String(call[0]).includes('ebay-category-specifics'))).toBe(true)
    warn.mockRestore()
  })
})
