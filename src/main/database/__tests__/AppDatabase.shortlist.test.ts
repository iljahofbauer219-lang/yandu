import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))
let db: AppDatabaseType

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-shortlist-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

const item = (over: Record<string, unknown> = {}) => ({ keyword: 'Headlight Assemblies', storeId: 's1', itemId: 'i1', title: 't', imageUrl: '', itemSoldCount: 100, avgSoldPrice: 90, avgShipping: 20, totalSales: 9000, lastSoldDateTime: '2026-11-14', ...over })

describe('入选榜单 ebay_shortlist_items', () => {
  afterEach(() => { if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true }) })

  it('入榜按关键词分组回读，移除生效', async () => {
    db = await freshDatabase()
    db.addShortlistItems([item(), item({ itemId: 'i2', keyword: 'Car Mats' })])
    const list = db.listShortlist()
    expect(list).toHaveLength(2)
    expect(list.map(i => i.keyword).sort()).toEqual(['Car Mats', 'Headlight Assemblies'])
    db.removeShortlistItem(list[0].id)
    expect(db.listShortlist()).toHaveLength(1)
  })

  it('同店铺同词同商品重复入榜为更新不新增', async () => {
    db = await freshDatabase()
    db.addShortlistItems([item()])
    db.addShortlistItems([item({ itemSoldCount: 200 })])
    const list = db.listShortlist()
    expect(list).toHaveLength(1)
    expect(list[0].itemSoldCount).toBe(200)
  })
})