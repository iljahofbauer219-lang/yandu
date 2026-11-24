import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 自动发布改主进程后台调度：15s tick 读 DB 配置（渲染器 localStorage 双写迁移），
 * App 运行即到点执行（不依赖页签挂载/窗口前台）；跳过/失败留痕写 DB＋事件回渲染器；
 * 执行链复用 shared，prepare/fill/publish 抽内部函数供 IPC 与调度共用。
 */
const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8')
const main = read('main', 'main.ts')
const app = read('renderer', 'App.tsx')
const db = read('main', 'database', 'AppDatabase.ts')
const preload = read('preload', 'preload.ts')

describe('主进程后台调度', () => {
  const start = main.indexOf('function startEbayBackgroundScheduler()')
  const body = main.slice(start, start + 9000)
  it('15s tick＋shared 判定＋挂载无关（main setInterval）', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('},15000)')
    expect(body).toContain('dueScheduledPublish(map,new Date().toISOString(),plan)')
    expect(body).toContain('database.allEbaySchedulerConfigs()')
    expect(main).toContain('workspace!.ensureEbayScopeViewBounds(`ebay:${cfg.storeId}`)')
    expect(read('main', 'browser', 'BrowserWorkspace.ts')).toContain('if(b.width<320||b.height<240)tab.view.setBounds({x:0,y:0,width:1280,height:900})')
  })
  it('门与渲染器旧口径一致：listing ref/优品非 returned/草稿已存非 once 跳过留痕', () => {
    expect(body).toContain("if(product.publishRef?.kind==='listing')continue")
    expect(body).toContain('!draft.returnedAt&&draft.listing.listingId===product.listingId')
    expect(body).toContain("if(product.draftSavedAt&&entry?.mode!=='once')")
    expect(body).toContain('lastSkippedAt:new Date().toISOString()')
    expect(body).toContain('markScheduleFailure(base,id,new Date().toISOString(),lastError)')
  })
  it('执行链复用 shared＋内部函数；成功后删条目写 DB＋事件', () => {
    expect(body.indexOf('ensureEbayScopeViewBounds')).toBeLessThan(body.indexOf('const activeHit=await workspace.findEbayActiveListingIdByTitle'))
    expect(body).toContain('const activeHit=await workspace.findEbayActiveListingIdByTitle(product.title).catch(()=>null)')
    expect(body).toContain('检测到已在架，转出本地环节')
    expect(body).toContain('runScheduledPublishChain({title:product.title,skipFill:savedDraft,')
    expect(body).toContain('fillCurrentTabInternal(id,\'auto\',undefined)')
    expect(body).toContain('publishCurrentListingInternal(id)')
    expect(body).toContain('const m={...map};delete m[id]')
    expect(body).toContain('writeSchedulerMap(cfg.storeId,m)')
  })
  it('初始化即启动调度', () => {
    expect(main).toContain('workspace = new BrowserWorkspace(mainWindow, shell.webContents)\n  startEbayBackgroundScheduler()')
  })
})

describe('配置落 DB＋双写迁移＋事件回刷', () => {
  it('DB 表与三方法', () => {
    expect(db).toContain('CREATE TABLE IF NOT EXISTS ebay_scheduler_config')
    expect(db).toContain('getEbaySchedulerConfig(storeId: string)')
    expect(db).toContain('setEbaySchedulerConfig(storeId: string, publishMap: string, plan: string, fixedPreset: string)')
    expect(db).toContain('allEbaySchedulerConfigs()')
  })
  it('IPC put/get＋preload 登记＋事件订阅', () => {
    expect(main).toContain("ipcMain.handle('ebay:scheduler:put-config'")
    expect(main).toContain("ipcMain.handle('ebay:scheduler:get-config'")
    expect(preload).toContain("schedulerPutConfig:")
    expect(preload).toContain("onSchedulerChanged:")
    expect(preload).toContain("onSchedulerProductsChanged:")
  })
  it('渲染器三写双写＋DB 空时迁移＋事件回刷 state/localStorage', () => {
    expect(app).toContain('void window.desktop.ebay.schedulerPutConfig(activeStore.id,next,schedulePlanRef.current,readEbayFixedPreset()).catch(()=>undefined)')
    expect(app).toContain('void window.desktop.ebay.schedulerPutConfig(activeStore.id,scheduledPublishRef.current,next,readEbayFixedPreset()).catch(()=>undefined)')
    expect(app).toContain('void window.desktop.ebay.schedulerPutConfig(activeStore.id,scheduledPublishRef.current,schedulePlanRef.current,ebayFixedPresetDraft).catch(()=>undefined)')
    expect(app).toContain('const dbCfg=await window.desktop.ebay.schedulerGetConfig(storeId);if(!dbCfg)await window.desktop.ebay.schedulerPutConfig(')
    expect(app).toContain('window.desktop.ebay.onSchedulerChanged(')
    expect(app).toContain('window.desktop.ebay.onSchedulerProductsChanged(')
  })
})