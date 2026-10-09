/**
 * 产品页落盘存储单测：重下载「只留最新一批」语义。
 *  - writePageAtomic：新批次整批写 staging，成功后原子替换旧目录（旧资产文件一并消失）；写失败保留旧目录且无 staging 残留。
 *  - findProductPages：仅命中同组织+同商品的页面目录（meta.json 归属判定）。
 *  - pruneProductPages：删除同商品兄弟孤儿目录，保留 keep 与其它商品/组织目录。
 */
import fsp from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findProductPages, pruneProductPages, writePageAtomic } from '../storage.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pp-storage-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function seedPage(pageId: string, meta: Record<string, unknown>, assets: Record<string, string>, html = '<div>old</div>'): Promise<void> {
  const dir = path.join(root, pageId)
  await fsp.mkdir(path.join(dir, 'assets'), { recursive: true })
  for (const [name, content] of Object.entries(assets)) {
    await fsp.writeFile(path.join(dir, 'assets', name), content)
  }
  await fsp.writeFile(path.join(dir, 'index.html'), html)
  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
}

const listAssets = async (pageId: string): Promise<string[]> => {
  try {
    return (await fsp.readdir(path.join(root, pageId, 'assets'))).sort()
  } catch {
    return []
  }
}

describe('writePageAtomic（重下载只留最新一批）', () => {
  it('成功后旧批次文件整体消失，仅存新批次', async () => {
    await seedPage('page-a', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'old', '99-stale.png': 'stale' })
    await writePageAtomic(root, 'page-a', async staging => {
      await fsp.writeFile(path.join(staging, 'assets', '01.png'), 'new')
      await fsp.writeFile(path.join(staging, 'index.html'), '<div>new</div>')
      await fsp.writeFile(path.join(staging, 'meta.json'), JSON.stringify({ orgId: 'org-1', warehouseProductId: 'wh-1' }))
    })
    expect(await listAssets('page-a')).toEqual(['01.png'])
    expect(await fsp.readFile(path.join(root, 'page-a', 'assets', '01.png'), 'utf8')).toBe('new')
    expect(await fsp.readFile(path.join(root, 'page-a', 'index.html'), 'utf8')).toBe('<div>new</div>')
    const leftovers = (await fsp.readdir(root)).filter(name => name.includes('staging'))
    expect(leftovers).toEqual([])
  })

  it('写入失败保留旧批次且清理 staging', async () => {
    await seedPage('page-b', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'old' }, '<div>old</div>')
    await expect(writePageAtomic(root, 'page-b', async staging => {
      await fsp.writeFile(path.join(staging, 'assets', '01.png'), 'partial')
      throw new Error('写盘中断')
    })).rejects.toThrow('写盘中断')
    expect(await listAssets('page-b')).toEqual(['01.png'])
    expect(await fsp.readFile(path.join(root, 'page-b', 'assets', '01.png'), 'utf8')).toBe('old')
    expect(await fsp.readFile(path.join(root, 'page-b', 'index.html'), 'utf8')).toBe('<div>old</div>')
    const leftovers = (await fsp.readdir(root)).filter(name => name.includes('staging'))
    expect(leftovers).toEqual([])
  })
})

describe('findProductPages（同组织+同商品归属）', () => {
  it('仅命中同组织同商品目录，忽略其它商品/组织/无 meta/暂存目录', async () => {
    await seedPage('p1', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    await seedPage('p2', { orgId: 'org-1', warehouseProductId: 'wh-2' }, { '01.png': 'x' })
    await seedPage('p3', { orgId: 'org-2', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    await fsp.mkdir(path.join(root, 'p4'))
    await seedPage('~staging-p1-tmp', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    expect(await findProductPages(root, 'org-1', 'wh-1')).toEqual(['p1'])
  })

  it('根目录不存在时返回空', async () => {
    expect(await findProductPages(path.join(root, 'missing'), 'org-1', 'wh-1')).toEqual([])
  })
})

describe('pruneProductPages（同商品旧批次自动删除）', () => {
  it('删除同商品兄弟目录并返回删除名单，保留 keep 与无关目录', async () => {
    await seedPage('keep-1', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    await seedPage('orphan-1', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    await seedPage('orphan-2', { orgId: 'org-1', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    await seedPage('other-product', { orgId: 'org-1', warehouseProductId: 'wh-2' }, { '01.png': 'x' })
    await seedPage('other-org', { orgId: 'org-2', warehouseProductId: 'wh-1' }, { '01.png': 'x' })
    const removed = await pruneProductPages(root, 'org-1', 'wh-1', 'keep-1')
    expect(removed.sort()).toEqual(['orphan-1', 'orphan-2'])
    const remaining = (await fsp.readdir(root)).sort()
    expect(remaining).toEqual(['keep-1', 'other-org', 'other-product'])
  })
})
