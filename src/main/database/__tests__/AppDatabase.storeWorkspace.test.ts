import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let db: AppDatabaseType

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-store-ws-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

describe('eBay 店铺按 workspace 命名空间隔离（搜索采集独立工作区）', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('默认店铺归 ebay 工作区，搜索采集店铺归 search-collect，列表按工作区过滤互不混', async () => {
    db = await freshDatabase()
    const main = db.createEbayStore('美国主店', 'mainuser', 'enc-main', 'EBAY_US')
    const search = db.createEbayStore('搜索店', 'searchuser', 'enc-search', 'EBAY_US', 'search-collect')

    expect(main.workspace).toBe('ebay')
    expect(search.workspace).toBe('search-collect')

    const all = db.getEbayStores()
    expect(all.map(store => store.id).sort()).toEqual([main.id, search.id].sort())

    const ebayOnly = db.getEbayStores('ebay')
    expect(ebayOnly.map(store => store.id)).toEqual([main.id])

    const searchOnly = db.getEbayStores('search-collect')
    expect(searchOnly.map(store => store.id)).toEqual([search.id])
  })

  it('搜索采集工作区初始为空，添加店铺不影响 ebay 工作区列表', async () => {
    db = await freshDatabase()
    db.createEbayStore('美国主店', 'mainuser', 'enc-main', 'EBAY_US')
    expect(db.getEbayStores('search-collect')).toHaveLength(0)

    db.createEbayStore('搜索店', 'searchuser', 'enc-search', 'EBAY_US', 'search-collect')
    expect(db.getEbayStores('search-collect')).toHaveLength(1)
    expect(db.getEbayStores('ebay')).toHaveLength(1)
  })
})