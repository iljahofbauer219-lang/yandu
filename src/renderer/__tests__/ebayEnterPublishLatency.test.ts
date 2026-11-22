/**
 * 「进入发布」时延根因守卫：
 * 无本地行时先按草稿 seed 重建并立即开编辑器（本地 DB 毫秒级），
 * eBay 在售/草稿找回 scrape 降为后台续作（命中回写 publishRef 并提示），不得串行 await 刮页后才开编辑器。
 * ReviseItem 前置分支（本地 listings/itemId 命中）口径不动。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const app = readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8')
const main = readFileSync(path.resolve(__dirname, '../../main/main.ts'), 'utf8')

const handler = app.slice(app.indexOf('const openPublishEditorFromDraft='), app.indexOf('const openPublishEditorFromDraft=') + 6000)

describe('先 seed 先开编辑器', () => {
  it('seed 重建出现在找回 scrape 之前', () => {
    const seedAt = handler.indexOf('seedLocalProductFromPremium(premium.storeId,premium,premium.publishRef')
    const scrapeAt = handler.indexOf('findActiveListingIdByTitle(')
    expect(seedAt).toBeGreaterThan(-1)
    expect(scrapeAt).toBeGreaterThan(-1)
    expect(seedAt).toBeLessThan(scrapeAt)
  })

  it('编辑器打开（setActiveTab publish）在 scrape 之前', () => {
    const openAt = handler.indexOf("setActiveTab('publish')")
    const scrapeAt = handler.indexOf('findActiveListingIdByTitle(')
    expect(openAt).toBeGreaterThan(-1)
    expect(openAt).toBeLessThan(scrapeAt)
  })

  it('找回 scrape 位于后台 void 异步块且无草稿 ref 时才跑', () => {
    expect(handler).toContain('if(!premium.publishRef){')
    expect(handler).toContain('void (async()=>{')
  })

  it('后台命中草稿回写 publishRef 并提示续作', () => {
    expect(handler).toContain('已后台续作既有 eBay 草稿，不重复新建。')
  })

  it('ReviseItem 前置分支口径不动', () => {
    expect(handler).toContain('该优品已存在在线商品（全流程后本地行已移除属预期），进入发布改为打开 eBay 修改页（ReviseItem），不重复新建。')
  })
})

describe('主进程 seed 存量行附 ref', () => {
  it('existing 行带 draftId 重seed 时回写 publishRef 与 draftSaved', () => {
    expect(main).toContain('if(existing){')
    expect(main).toContain('database.setEbayLocalProductPublishRef(existing.id,{kind:\'draft\',id:draftId,at:capturedAt})')
  })
})