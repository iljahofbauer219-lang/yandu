import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

/**
 * 回归守卫：eBay 本地产品的媒体行主键。
 *
 * 背景：main.ts 的 updateEbayLocalProduct 为了继承上一版媒体的下载状态/sha256，会把源媒体记录
 * **连 id 一起**展开进新快照；而媒体表 id 曾是单一主键，于是第二次编辑必然撞 UNIQUE ——
 * 客户端整个事务 ROLLBACK（本次编辑全丢），服务端 createMany 报 P2002 → 500。
 * 修法是把 id 退化为代理键、逻辑 id 迁到 media_key。
 *
 * 这里刻意从「升级前的老库」起步（媒体表没有 media_key 列、且已有一条历史行），
 * 因为 AppDatabase 的 schema exec 块跑在 ensureColumn **之前**：任何在 schema 块里引用新列的语句
 * （例如 CREATE INDEX ... (snapshot_id, media_key)）都会让老库 no such column 抛错，
 * 而构造函数失败等于应用启动崩溃。用全新空库测不出这个回归。
 */

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-media-test-'))
  return { app: { getPath: () => ctx.dir } }
})

/** 建一个"升级前"形态的媒体表：无 media_key 列，含一条历史行（省略 FK 以免连带建父表） */
async function seedLegacyDatabase() {
  const { DatabaseSync } = await import('node:sqlite')
  const sqlite = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
  sqlite.exec(`
    CREATE TABLE ebay_local_product_media (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      remote_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      download_status TEXT NOT NULL
    );
    INSERT INTO ebay_local_product_media
      (id, snapshot_id, media_type, sort_order, remote_url, local_path, download_status)
    VALUES ('legacy-media', 'legacy-snapshot', 'IMAGE', 0, 'https://i.ebayimg.com/x.jpg', '/tmp/x.jpg', 'DOWNLOADED');
  `)
  sqlite.close()
}

function mediaItem(id: string, sortOrder: number) {
  return {
    id, mediaType: 'IMAGE', sortOrder,
    remoteUrl: 'https://i.ebayimg.com/images/g/x/s-l1600.jpg',
    localPath: '/tmp/x.jpg', mimeType: 'image/jpeg',
    width: 1600, height: 1600, fileSize: 2048, sha256: `sha-${id}`, downloadStatus: 'DOWNLOADED'
  }
}

/** 只填 saveEbayLocalProductSnapshot 真正读取的字段，其余用 cast 绕过（本测试只关心媒体行主键语义） */
function makeInput(storeId: string, media: Array<Record<string, unknown>>, version: number) {
  return {
    listing: {
      storeId, marketplaceId: 'EBAY_US', listingId: 'listing-1',
      categoryId: 'cat-1', categoryName: '类目', title: `标题 v${version}`, price: '10', currency: 'USD'
    },
    details: { title: `标题 v${version}`, descriptionText: '描述', descriptionHtml: '', price: '10', currency: 'USD' },
    media,
    capturedAt: new Date().toISOString(),
    completeness: 100,
    missingFields: [],
    contentHash: `hash-v${version}`
  } as never
}

describe('AppDatabase · eBay 本地产品媒体行主键（老库升级路径）', () => {
  let database: AppDatabaseType
  // ebay_local_products 对 ebay_stores 有外键，且 node:sqlite 默认开启外键约束，
  // 所以必须先建真实店铺行，否则 INSERT 会 FOREIGN KEY constraint failed。
  let storeId = ''

  const query = (sql: string) => {
    const sqlite = (database as unknown as {
      database: { prepare(statement: string): { all(...args: unknown[]): unknown[] } }
    }).database
    return sqlite.prepare(sql).all() as Array<Record<string, unknown>>
  }

  beforeAll(async () => {
    await import('electron') // 触发 mock 工厂，填充 ctx.dir
    await seedLegacyDatabase()
    const module = await import('../AppDatabase.js')
    database = new module.AppDatabase()
    storeId = database.createEbayStore('测试店铺', 'test-seller', 'encrypted-password', 'EBAY_US').id
  })

  it('老库能正常升级：ensureColumn 补出 media_key 并回填历史行（未在 schema exec 阶段引用新列）', () => {
    expect(query(`SELECT id, media_key FROM ebay_local_product_media WHERE snapshot_id='legacy-snapshot'`))
      .toEqual([{ id: 'legacy-media', media_key: 'legacy-media' }])
  })

  it('补列后建的索引存在（说明 CREATE INDEX 排在 ensureColumn 之后）', () => {
    const indexes = query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ebay_local_product_media'`)
    expect(indexes.map(row => row.name)).toContain('idx_ebay_local_product_media_key')
  })

  it('同一逻辑媒体 id 跨快照复用不再撞主键（第二次编辑曾整体回滚）', () => {
    const v1 = database.saveEbayLocalProductSnapshot(makeInput(storeId, [mediaItem('media-a', 0)], 1))
    expect(v1.snapshot.version).toBe(1)
    expect(v1.snapshot.media[0]?.id).toBe('media-a')

    const v2 = database.saveEbayLocalProductSnapshot(makeInput(storeId, [{ ...mediaItem('media-a', 3) }], 2))
    expect(v2.snapshot.version).toBe(2)

    const v3 = database.saveEbayLocalProductSnapshot(makeInput(storeId, [{ ...mediaItem('media-a', 1) }, { ...mediaItem('media-b', 0) }], 3))
    expect(v3.snapshot.version).toBe(3)
    // 快照 payload 里保留的仍是逻辑 id，读路径不受代理键影响
    expect(v3.snapshot.media.map(item => item.id).sort()).toEqual(['media-a', 'media-b'])
  })

  it('媒体表以代理键为主键、逻辑 id 落在 media_key，各版快照的行互不覆盖', () => {
    const rows = query(
      `SELECT id, media_key, snapshot_id FROM ebay_local_product_media WHERE snapshot_id <> 'legacy-snapshot'`
    ) as Array<{ id: string; media_key: string; snapshot_id: string }>

    expect(rows).toHaveLength(4)
    expect(new Set(rows.map(row => row.id)).size).toBe(4)
    expect(rows.map(row => row.media_key).sort()).toEqual(['media-a', 'media-a', 'media-a', 'media-b'])
    expect(new Set(rows.map(row => row.snapshot_id)).size).toBe(3)
  })
})
