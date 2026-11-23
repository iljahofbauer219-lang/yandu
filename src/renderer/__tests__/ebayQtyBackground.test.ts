import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 库存 chip 空读根因：poll 有 draftSavedAt 门＋relevant 页门（页签_idle 永不读），已上架行草稿无源。
 * 修复：隐藏视图后台刮草稿栏数量（不附着、用完即关、每行 60s 节流）＋chip 回落同 listingId ACTIVE 在架数量＋tooltip 区分来源。
 */
const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
const app = read('renderer', 'App.tsx')
const ws = read('main', 'browser', 'BrowserWorkspace.ts')
const main = read('main', 'main.ts')
const preload = read('preload', 'preload.ts')
const types = read('renderer', 'global.d.ts')

describe('后台库存读回 · 隐藏视图不扰用户页签', () => {
  const start = ws.indexOf('async readEbayDraftQuantityBackground(')
  const body = ws.slice(start, start + 2600)
  it('隐藏视图刮草稿栏；finally 关闭；不附着不改 activeTabId', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("const url='https://www.ebay.com/sh/lst/drafts'")
    expect(body).toContain('if(!view.webContents.isDestroyed())view.webContents.close()')
    expect(body).not.toContain('attachView')
    expect(body).not.toContain('activeTabId=')
  })
  it('草稿栏刮取脚本单一真值：readEbayActiveTabQuantity 与后台读回共用', () => {
    expect(ws).toContain('ebayDraftsQuantityScript(')
    const active = ws.slice(ws.indexOf('async readEbayActiveTabQuantity('), ws.indexOf('async readEbayDraftQuantityBackground('))
    expect(active).toContain('this.ebayDraftsQuantityScript(listingId,title)')
    expect(body).toContain('this.ebayDraftsQuantityScript(listingId,title)')
  })
  it('IPC/preload/类型登记', () => {
    expect(main).toContain("ipcMain.handle('ebay:local-products:draft-quantity-background'")
    expect(preload).toContain("draftQuantityBackground: (storeId:string, listingId?:string, title?:string):Promise<{quantity:number|null;at:string;url:string}> => ipcRenderer.invoke('ebay:local-products:draft-quantity-background',storeId,listingId,title)")
    expect(types).toContain('draftQuantityBackground(storeId:string, listingId?:string, title?:string):Promise<{quantity:number|null;at:string;url:string}>')
  })
})

describe('poll 去 draftSavedAt 门＋后台节流读回', () => {
  const start = app.indexOf('// 蓝位库存：')
  const body = app.slice(start, start + 2600)
  it('不再以 draftSavedAt 跳过；非相关页/无值时 draft ref 行 60s 节流后台读回', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).not.toContain('if(!p.draftSavedAt||scheduledMetaBusy')
    expect(body).toContain('const qtyBackgroundAt=useRef<Map<string,number>>(new Map())')
    expect(body).toContain('Date.now()-last>=60000')
    expect(body).toContain('window.desktop.ebay.draftQuantityBackground(p.storeId,p.publishRef.id,p.title)')
  })
})

describe('chip 在架回落＋tooltip 来源', () => {
  it('同 listingId ACTIVE 的 listings quantity 回落显示，tooltip 区分草稿读回/在架/未读', () => {
    expect(app).toContain("const onlineQty=listings.find(l=>l.listingId===product.listingId&&l.status==='ACTIVE')?.quantity")
    expect(app).toContain('eBay 在架库存（listings 同步）')
    expect(app).toContain("(onlineQty!==undefined?onlineQty:'—')")
  })
})