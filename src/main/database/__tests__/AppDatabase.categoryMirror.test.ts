import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'
import type { EbayStoreCategory } from '../../../shared/contracts'

/**
 * 回归守卫：eBay 店铺目录镜像同步——以线上抓取集合为根，APP 独有目录自动删除。
 * 用户 2026-10-12 真机确认行为：同步目录后线上目录正常落库、APP 旧目录自动消失。
 * 此处把该语义固化为单测：REMOVED 软删除、树查询只读 ACTIVE、collected: 行豁免、空集合保护。
 */

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-catmirror-test-'))
  return { app: { getPath: () => ctx.dir } }
})

function cat(categoryId: string, name: string, sortOrder: number, parentCategoryId = ''): EbayStoreCategory {
  return {
    storeId: 'store-1',
    categoryId,
    name,
    parentCategoryId,
    level: parentCategoryId ? 2 : 1,
    childCount: 0,
    listingCount: 0,
    sortOrder,
    status: 'ACTIVE',
    syncedAt: ''
  }
}

describe('AppDatabase · eBay 店铺目录镜像同步（抓取集合为根，APP 独有自动删除）', () => {
  let database: AppDatabaseType
  let storeId = ''

  const sqlite = () => (database as unknown as {
    database: { prepare(sql: string): { get(...args: unknown[]): unknown }; exec(sql: string): void }
  }).database

  const rawStatus = (categoryId: string) => {
    const row = sqlite().prepare('SELECT status FROM ebay_store_categories WHERE store_id=? AND category_id=?').get(storeId, categoryId) as { status: string } | undefined
    return row?.status
  }

  beforeAll(async () => {
    const { AppDatabase } = await import('../AppDatabase.js')
    database = new AppDatabase()
    storeId = database.createEbayStore('镜像验收店', 'qa@example.test', 'enc', 'EBAY_US').id
  })

  it('首次同步把抓取集合落为 ACTIVE 并记 added', () => {
    const workspace = database.saveEbayStoreCategories(storeId, [cat('c1', '家具', 0), cat('c2', '卧室家具', 1, 'c1')])
    expect(workspace.categories.map(item => item.categoryId).sort()).toEqual(['c1', 'c2'])
    expect(workspace.lastSync?.added).toBe(2)
    expect(workspace.lastSync?.removed).toBe(0)
  })

  it('二次同步以新抓取集合为根：改名更新、APP 独有标 REMOVED 且树不返回、collected 行豁免', () => {
    sqlite().exec(`INSERT INTO ebay_store_categories (store_id,category_id,name,parent_category_id,level,child_count,listing_count,sort_order,status,synced_at,updated_at) VALUES ('${storeId}','collected:t','采集类目','',1,0,0,9,'ACTIVE','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`)
    const workspace = database.saveEbayStoreCategories(storeId, [cat('c1', '家具收纳', 0), cat('c3', '厨具', 1)])
    expect(workspace.categories.map(item => item.categoryId).sort()).toEqual(['c1', 'c3', 'collected:t'])
    expect(rawStatus('c2')).toBe('REMOVED')
    expect(rawStatus('c1')).toBe('ACTIVE')
    expect(rawStatus('collected:t')).toBe('ACTIVE')
    const summary = workspace.lastSync
    expect(summary?.added).toBe(1)
    expect(summary?.renamed).toBe(1)
    expect(summary?.removed).toBe(1)
    expect(summary?.changes.map(item => item.type).sort()).toEqual(['ADDED', 'REMOVED', 'RENAMED'])
  })

  it('REMOVED 类目被重新抓取时判 ADDED 并恢复 ACTIVE', () => {
    const workspace = database.saveEbayStoreCategories(storeId, [cat('c2', '卧室家具', 0, 'c1')])
    expect(workspace.categories.map(item => item.categoryId)).toContain('c2')
    expect(rawStatus('c2')).toBe('ACTIVE')
    expect(rawStatus('c1')).toBe('REMOVED')
    expect(rawStatus('c3')).toBe('REMOVED')
    expect(workspace.lastSync?.added).toBe(1)
    expect(workspace.lastSync?.removed).toBe(2)
  })

  it('空抓取集合抛错取消写入，库保持不变', () => {
    expect(() => database.saveEbayStoreCategories(storeId, [])).toThrow(/eBay店铺目录为空/)
    expect(rawStatus('c2')).toBe('ACTIVE')
    expect(rawStatus('c1')).toBe('REMOVED')
  })
})
