import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 进入发布回落链（2026-11-18）：全流程后本地行被移除属预期；无本地行但存在在线商品
 * （listings 命中或 viewUrl/listingId 含 itm id）→ 打开 eBay ReviseItem 修改页，不重复新建、
 * 不误弹「尚未同步为本地产品」；仅真正无源才模态。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/preload.ts'), 'utf8')
const seg = app.split('const openPublishEditorFromDraft=')[1]?.split('\n  const ')[0] ?? ''

describe('进入发布 · 无本地行回落链', () => {
  it('无本地行先查在线商品/itm id，命中开 ReviseItem 而非模态', () => {
    expect(seg).toContain('const online=listings.find(')
    expect(seg).toContain('normTitle(item.title)===normTitle(premium.selectedTitle)')
    expect(seg).toContain('mode=ReviseItem&itemId=')
    expect(seg).toContain("setActiveTab('browser')")
    expect(seg.indexOf('mode=ReviseItem&itemId=')).toBeLessThan(seg.indexOf('setPublishNoMatchDraft(premium)'))
  })
  it('仅真正无源才置模态', () => {
    expect(seg).toContain('if(!lp){')
    expect(seg).toContain('setPublishNoMatchDraft(premium);return')
  })
  it('无源时按标题从 eBay 在售列表找回 item id（IPC 全链）', () => {
    expect(ws).toContain('async findEbayActiveListingIdByTitle(')
    expect(main).toContain("ipcMain.handle('ebay:find-active-listing-by-title'")
    expect(preload).toContain('findActiveListingIdByTitle:')
    expect(app).toContain('findActiveListingIdByTitle(premium.selectedTitle')
    expect(app).toContain('已按标题从 eBay 在售列表找回商品并打开修改页')
    expect(ws).toContain('sh/lst/drafts')
  })
  it('草稿命中不再直跳浏览器：重建本地行后走发布编辑器（2026-11-18 用户拍板恢复图1操作界面）', () => {
    expect(seg).not.toContain('lstng?draftId=')
    expect(seg).toContain('if(found.itemId){')
    expect(seg).toContain('seedLocalProductFromPremium(premium.storeId,premium,found.draftId)')
    expect(seg).toContain('已按优品草稿重建本地版本并打开发布编辑器')
    expect(seg.indexOf('seedLocalProductFromPremium(')).toBeLessThan(seg.indexOf("setActiveTab('publish')"))
    expect(preload).toContain('seedLocalProductFromPremium:')
    expect(main).toContain("ipcMain.handle('ebay:local-products:seed-from-premium'")
    expect(main).toContain('buildEbayPremiumLocalSeed(')
    expect(main).toContain('setEbayLocalProductPublishRef(product.id,{kind:\'draft\',id:draftId,at:capturedAt})')
    expect(main).toContain('setEbayLocalProductDraftSaved(product.id,capturedAt)')
  })
  it('回落打开修改页有中文说明不重复新建', () => {
    expect(seg).toContain('不重复新建')
  })
  it('回落两分支先附着店铺会话页签再 navigate——不得落通用 web-general 罐被 eBay 当匿名拦验证', () => {
    expect(seg, '禁未附着就 void navigate').not.toContain("void window.desktop.browser.navigate('web',url)")
    const shows = seg.match(/await window\.desktop\.browser\.show\('web',ebayOwnTabId\.current\)/g) || []
    const navs = seg.match(/await window\.desktop\.browser\.navigate\('web',url\)/g) || []
    expect(shows.length, '两分支各一次附着').toBe(2)
    expect(navs.length, '两分支各一次 awaited navigate').toBe(2)
    const chunks = seg.split("await window.desktop.browser.navigate('web',url)")
    for (const chunk of chunks.slice(0, -1)) expect(chunk, '每次 navigate 前必有 show 附着').toContain("await window.desktop.browser.show('web',ebayOwnTabId.current)")
  })
})