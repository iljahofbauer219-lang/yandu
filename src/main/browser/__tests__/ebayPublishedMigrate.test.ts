import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 已上架转出：主进程回收入口（写 listing ref＋移除本地行，与自动链同口径、幂等）＋
 * 对账兜底（仅 draft ref 行；店铺页签停在刊登编辑页时跳过本轮、事后还原地址，不拉走用户开着的页）＋
 * 自动链改共用 shared 正向证据函数。
 */
const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8')
const main = read('main', 'main.ts')
const ws = read('main', 'browser', 'BrowserWorkspace.ts')
const preload = read('preload', 'preload.ts')

describe('migrate-published · 回收入口', () => {
  const start = main.indexOf("ipcMain.handle('ebay:local-products:migrate-published'")
  const body = main.slice(start, start + 1200)
  it('编号门禁＋写 listing ref＋移除本地行＋行缺失幂等 no-op', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("if(!/^\\d{6,}$/.test(itemId))throw new Error('上架编号不合格，未执行转出')")
    expect(body).toContain("database.setEbayLocalProductPublishRef(localProductId,{kind:'listing',id:itemId,at:new Date().toISOString()})")
    expect(body).toContain('removeEbayLocalProduct(localProductId)')
    expect(body).toContain('if(!product)return {migrated:false')
  })
})

describe('reconcile-published · 对账兜底', () => {
  const start = main.indexOf("ipcMain.handle('ebay:local-products:reconcile-published'")
  const body = main.slice(start, start + 2600)
  it('仅 draft/listing ref 行参与；listing ref 直接落位清理；draft 命中后写 ref＋移除；逐行回收', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("item.publishRef?.kind==='draft'||item.publishRef?.kind==='listing'")
    expect(body).toContain("for(const row of rows.filter(item=>item.publishRef?.kind==='listing'))")
    expect(body).toContain('await landEbayPublishedListing(storeId,itemId)\n    removeEbayLocalProduct(row.id)')
    expect(body).toContain('workspace.reconcileEbayPublishedDrafts(`ebay:${storeId}`')
    expect(body).toContain("database.setEbayLocalProductPublishRef(row.id,{kind:'listing',id:hit.itemId,at:new Date().toISOString()})")
    expect(body).toContain('removeEbayLocalProduct(row.id)\n    await landEbayPublishedListing(storeId,hit.itemId)')
  })
})

describe('reconcileEbayPublishedDrafts · 不拉走用户开着的刊登页', () => {
  const start = ws.indexOf('async reconcileEbayPublishedDrafts(')
  const body = ws.slice(start, start + 1600)
  it('编辑页跳过本轮；对账后还原对账前地址；逐行找在架且单行失败不阻断', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('if(/\\/(lstng|sl\\/list)/i.test(before))return []')
    expect(body).toContain('this.findEbayActiveListingIdByTitle(row.title)')
    expect(body).toContain('await tab.view.webContents.loadURL(before).catch(()=>undefined)')
  })
})

describe('自动发布链共用正向证据单一真值', () => {
  it('publishEbayCurrentListing 改调 shared 函数，旧内联判定删除', () => {
    expect(ws).toContain("import { readEbayPublishedLanding } from '../../shared/ebayListingTarget'")
    expect(ws).toContain('const {published,itemId}=readEbayPublishedLanding(url)')
    expect(ws).not.toContain('const published=/')
  })
})

describe('preload 登记两个新 IPC', () => {
  it('migratePublished/reconcilePublished 签名与通道名', () => {
    expect(preload).toContain("migratePublished: (storeId:string, localProductId:string, itemId:string):Promise<{migrated:boolean;title:string;itemId:string}> => ipcRenderer.invoke('ebay:local-products:migrate-published',storeId,localProductId,itemId)")
    expect(preload).toContain("reconcilePublished: (storeId:string,excludeIds?:string[]):Promise<Array<{localProductId:string;title:string;itemId:string}>> => ipcRenderer.invoke('ebay:local-products:reconcile-published',storeId,excludeIds)")
    expect(read('renderer', 'global.d.ts')).toContain('reconcilePublished(storeId:string,excludeIds?:string[]):Promise<Array<{localProductId:string;title:string;itemId:string}>>')
  })
})

describe('转出落位 · 会话店铺无 OAuth 也能进线上产品与目录', () => {
  it('landEbayPublishedListing：刮在售行→upsert→既有分类器归类', () => {
    const start = main.indexOf('async function landEbayPublishedListing(')
    const body = main.slice(start, start + 1800)
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('workspace.readEbayActiveListingRow(`ebay:${storeId}`,itemId)')
    expect(body).toContain('database.upsertEbayListing(storeId,listing)')
    expect(body).toContain('classifyAgainstStoreTree({title:row.title,sourceCategory:\'\',description:\'\',tree})')
    expect(body).toContain('database.updateEbayListingCategory(storeId,itemId,result.categoryId)')
  })
  it('两 handler 回收后都 await 落位', () => {
    expect(main).toContain('removeEbayLocalProduct(localProductId)\n  await landEbayPublishedListing(storeId,itemId)')
    expect(main).toContain('removeEbayLocalProduct(row.id)\n    await landEbayPublishedListing(storeId,hit.itemId)')
  })
  it('readEbayActiveListingRow：编辑页跳过＋刮完还原＋按 itm 链接定位行', () => {
    const start = ws.indexOf('async readEbayActiveListingRow(')
    const body = ws.slice(start, start + 2200)
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('if(/\\/(lstng|sl\\/list)/i.test(before))return null')
    expect(body).toContain("a[href*=\"/itm/\"]")
    expect(body).toContain('await tab.view.webContents.loadURL(before).catch(()=>undefined)')
  })
  it('空 ref 行按 listings 在架对账清理（下载到本地重建的已上架行不再滞留），排除在优化行', () => {
    const start = main.indexOf("ipcMain.handle('ebay:local-products:reconcile-published'")
    const body = main.slice(start, start + 4200)
    expect(body).toContain("const activeIds=new Set(database.getEbayListings(storeId).filter(item=>item.status==='ACTIVE').map(item=>item.listingId))")
    expect(body).toContain('const bareRows=database.getEbayLocalProducts().filter(item=>item.storeId===storeId&&!item.publishRef&&activeIds.has(item.listingId)&&!(excludeIds||[]).includes(item.id))')
    expect(body).toContain("database.setEbayLocalProductPublishRef(row.id,{kind:'listing',id:row.listingId,at:new Date().toISOString()})")
    expect(body).toContain('ipcMain.handle(\'ebay:local-products:reconcile-published\', async (_event, storeId:string, excludeIds?:string[])')
  })
})