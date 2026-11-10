import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'
import type { EbayItemSpecificsSection } from '../../../shared/ebayItemSpecificsModel'

/**
 * 回归守卫：05 段现网清单（attributeSection）此前只活在 EbayPlatformWorkspace 的内存里，
 * 重启 / 刷新渲染器 / 离开 eBay 平台页就丢，操作员每次进发布都得重点一次读取（2026-11-10 用户三问根因）。
 * 语义：读取成功即按产品 id 落库（section JSON + 来源 URL + 读取时间），进编辑器时库态兜底种子；
 * 同产品重复读取整行覆盖（UPSERT），不产生重复行；没读过就是 null，编辑器照旧落兜底态，绝不拼假清单。
 */

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-specifics-section-test-'))
  return { app: { getPath: () => ctx.dir } }
})

const SECTION: EbayItemSpecificsSection = {
  slots: [
    { name: 'Brand', group: 'ESSENTIAL', groupLabel: 'Required', control: 'MENU', required: true, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [], y: 1477 },
    { name: 'Vintage Part', group: 'OPTIONAL', groupLabel: 'Additional (optional)', control: 'YESNO', required: false, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '~ 209 searches', metaKind: 'SEARCH_COUNT', options: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], y: 2177 }
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

describe('AppDatabase · 05 段现网清单持久化', () => {
  let database: AppDatabaseType

  beforeAll(async () => {
    const { AppDatabase } = await import('../AppDatabase.js')
    database = new AppDatabase()
  })

  it('没读过的产品取回 null：编辑器据此落兜底态，不拼假清单', () => {
    expect(database.getEbaySpecificsSection('lp-none')).toBeNull()
  })

  it('读取成功整份落库：section、来源 URL 与读取时间原样取回', () => {
    database.saveEbaySpecificsSection({ productId: 'lp-1', storeId: 's-1', section: SECTION, sourceUrl: 'https://www.ebay.com/lstng?draftId=1&mode=AddItem', readAt: '2026-11-09T15:25:00.000Z' })
    const row = database.getEbaySpecificsSection('lp-1')
    expect(row).not.toBeNull()
    expect(row?.section).toEqual(SECTION)
    expect(row?.sourceUrl).toContain('mode=AddItem')
    expect(row?.readAt).toBe('2026-11-09T15:25:00.000Z')
  })

  it('同产品重复读取整行覆盖：不产生重复行，时间戳换成最新一次', () => {
    database.saveEbaySpecificsSection({ productId: 'lp-1', storeId: 's-1', section: { ...SECTION, toggleExpandedText: '' }, sourceUrl: 'https://www.ebay.com/lstng?draftId=2&mode=AddItem', readAt: '2026-11-10T00:00:00.000Z' })
    const row = database.getEbaySpecificsSection('lp-1')
    expect(row?.readAt).toBe('2026-11-10T00:00:00.000Z')
    expect(row?.section.toggleExpandedText).toBe('')
    expect(row?.sourceUrl).toContain('draftId=2')
  })

  it('坏 JSON 不炸读取：行内容损坏时按没读过处理并点名', () => {
    database.saveEbaySpecificsSection({ productId: 'lp-bad', storeId: 's-1', section: SECTION, sourceUrl: '', readAt: '2026-11-10T00:00:00.000Z' })
    // 直接把手写坏 JSON 塞进库，模拟半写盘 / 手工改库
    ;(database as unknown as { database: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }).database
      .prepare('UPDATE ebay_specifics_sections SET section_json=? WHERE product_id=?').run('{broken', 'lp-bad')
    expect(database.getEbaySpecificsSection('lp-bad')).toBeNull()
  })
})
