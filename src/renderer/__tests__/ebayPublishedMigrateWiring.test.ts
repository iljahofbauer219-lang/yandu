import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 渲染端双通道：onState 实时（上一跳 lstng draftId 匹配本地行＋本跳正向上架证据才回收）＋
 * 60s 对账 tick（仅线上发布页签可见时跑，进页签立即跑一次）；回收后刷本地/线上列表并同步目录，中文 notice 点名去向。
 */
const app = readFileSync(path.join(__dirname, '..', '..', 'renderer', 'App.tsx'), 'utf8')
const slice = (from: string, to: string) => {
  const start = app.indexOf(from)
  expect(start, `${from} 必须存在`).toBeGreaterThan(-1)
  const rest = app.slice(start)
  const end = rest.indexOf(to, from.length)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('已上架转出 · 渲染端接线', () => {
  it('import 登记正向证据函数；本地行 render 期镜像供 onState 闭包读新值', () => {
    expect(app).toMatch(/import \{[^}]*readEbayPublishedLanding[^}]*\} from '\.\.\/shared\/ebayListingTarget'/)
    expect(app).toContain('localProductsRef.current=localProducts')
    expect(app).toContain('const ebayPrevWebUrlRef=useRef')
  })
  it('onState 实时通道：上一跳 draftId 匹配＋本跳正向证据＋编号门禁才回收', () => {
    const body = slice("return window.desktop.browser.onState(next=>{if(next.platform==='web'){setEbayBrowserState(next);", '},[active])')
    expect(body).toContain('const prevRef=ebayPublishRefFromUrl(ebayPrevWebUrlRef.current)')
    expect(body).toContain('ebayPrevWebUrlRef.current=next.url')
    expect(body).toContain('const landing=readEbayPublishedLanding(next.url)')
    expect(body).toContain("if(prevRef?.kind==='draft'&&landing.published&&/^\\d{6,}$/.test(landing.itemId))")
    expect(body).toContain('item.publishRef.id===prevRef.id')
    expect(body).toContain('void migratePublishedRowRef.current(row,landing.itemId)')
  })
  it('migratePublishedRow：IPC 回收＋双列表刷新＋目录/商品同步＋中文 notice＋失败中文报错', () => {
    const body = slice('const migratePublishedRow=', 'const migratePublishedRowRef=')
    expect(body).toContain('window.desktop.ebay.migratePublished(row.storeId,row.id,itemId)')
    expect(body).toContain('if(!res.migrated)return')
    expect(body).toContain('setLocalProducts(await window.desktop.ebay.localProducts(row.storeId))')
    expect(body).toContain('setListings(await window.desktop.ebay.listings(row.storeId))')
    expect(body).toContain('await syncStoreCategories(store,true).catch(()=>undefined)')
    expect(body, '会话店铺无 OAuth，API 同步必报错；落位走刮取 upsert，不调 syncStore').not.toContain('syncStore(')
    expect(body).toContain('已移出线上发布并同步到线上产品·产品目录')
    expect(body).toContain("readableError(reason,'已上架产品转出失败')")
  })
  it('runPublishedReconcile：对账 IPC＋命中后刷新同步＋中文 notice＋失败中文报错', () => {
    const body = slice('const runPublishedReconcile=', 'const runPublishedReconcileRef=')
    expect(body).toContain('window.desktop.ebay.reconcilePublished(store.id,excludeIds)')
    expect(body).toContain('if(!migrated.length)return')
    expect(body).toContain('setLocalProducts(await window.desktop.ebay.localProducts(store.id))')
    expect(body).toContain('await syncStoreCategories(store,true).catch(()=>undefined)')
    expect(body).toContain('已移出线上发布并同步到线上产品·产品目录')
    expect(body).toContain("readableError(reason,'已上架对账失败')")
  })
  it('60s tick 线上发布/本地产品/线上产品/优品可见时跑，进页签立即对账一次，排除正在优化的行', () => {
    expect(app).toContain("useEffect(()=>{if(!active||(activeTab!=='publish'&&activeTab!=='local'&&activeTab!=='library'&&activeTab!=='premium')||!activeStore)return;void runPublishedReconcileRef.current(activeStore,[selectedLocalProductId].filter(Boolean));const timer=window.setInterval(()=>{void runPublishedReconcileRef.current(activeStore,[selectedLocalProductId].filter(Boolean))},60000);return()=>window.clearInterval(timer)},[active,activeTab,activeStore?.id,selectedLocalProductId])")
    expect(app).toContain('const runPublishedReconcile=async(store:EbayStore,excludeIds?:string[])=>{try{const migrated=await window.desktop.ebay.reconcilePublished(store.id,excludeIds)')
  })
  it('线上发布页签有可见 notice/error 槽（信息栏折叠时全局槽不渲染），错误带重试动作', () => {
    const body = slice("{activeTab==='publish'&&<div className=\"ebay-stage-panel ebay-publish-stage\">", '本地定时发布')
    expect(body).toContain("{notice&&<div className=\"ebay-success-notice\">{notice}<button onClick={()=>setNotice('')}>×</button></div>}")
    expect(body).toContain('{ebayError&&<div className="ebay-error-notice">{ebayError}')
    expect(body).toContain('>{ebayErrorAction.label}</button>')
    expect(app).toContain("setEbayErrorAction({label:'重试',run:()=>{if(activeStore)void runPublishedReconcileRef.current(activeStore)}})")
  })
})