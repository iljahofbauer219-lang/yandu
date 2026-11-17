import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 自动发布到点链（2026-11-17 用户拍板）：按各产品时间设置到点，对 publishRef 对应的 eBay 草稿
 * 执行 prepare(媒体重同步)→标题健康门→自动填写→固定填写→最终「刊登」真正上架（无需逐次二次确认）。
 * 仅调度自动发布路径点最终提交；手动/草稿发布仍禁点。标题不符/草稿已删→中止不新建顶替。
 * 全选自动发布＝全部 enabled 并套用统一时间配置。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/preload.ts'), 'utf8')
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const run = readFileSync(path.resolve(process.cwd(), 'src/renderer/scheduledPublishRun.ts'), 'utf8')

describe('自动发布 · 主进程最终刊登与标题读回', () => {
  it('publishEbayCurrentListing 只点最终刊登/Submit，排除保存草稿/预览', () => {
    expect(ws).toContain('async publishEbayCurrentListing(')
    expect(ws).toContain('/^(刊登|List item|List your item|Submit|发布)$/i')
    expect(ws).toContain('!/保存草稿|预览|Save draft|Preview/i')
  })
  it('readEbayCurrentTitle 读回草稿标题供健康门', () => {
    expect(ws).toContain('async readEbayCurrentTitle(')
    expect(ws).toContain('input[name="title"]')
  })
  it('main/preload 暴露 publish-current-listing 与 read-current-draft-title', () => {
    expect(main).toContain("ipcMain.handle('ebay:publish-current-listing'")
    expect(main).toContain("ipcMain.handle('ebay:read-current-draft-title'")
    expect(preload).toContain('publishCurrentListing:')
    expect(preload).toContain('readCurrentDraftTitle:')
  })
})

describe('自动发布 · 调度到点链与全选', () => {
  const seg = app.split('dueScheduledPublish(scheduledPublishRef.current')[1]?.split('},15000)')[0] ?? ''
  it('到点链含 prepare→refDeleted 中止→标题门→auto→fixed→最终刊登（链体在 scheduledPublishRun，App 只接线）', () => {
    expect(seg).toContain('prepareLocalProductRevision(id)')
    expect(run).toContain('refDeleted')
    expect(seg).toContain('readCurrentDraftTitle()')
    expect(seg).toContain("fillCurrentTab(id,'auto'")
    expect(seg).toContain("fillCurrentTab(id,'fixed'")
    expect(seg).toContain('publishCurrentListing(product.id)')
    expect(seg.indexOf("fillCurrentTab(id,'auto'")).toBeLessThan(seg.indexOf("fillCurrentTab(id,'fixed'"))
    expect(seg.indexOf("fillCurrentTab(id,'fixed'")).toBeLessThan(seg.indexOf('publishCurrentListing(product.id)'))
  })
  it('标题不符中止且不点刊登（门在 publish 之前）', () => {
    expect(seg.indexOf('readCurrentDraftTitle()')).toBeLessThan(seg.indexOf('publishCurrentListing(product.id)'))
    expect(run).toContain('草稿标题与本地不符')
    expect(run.indexOf('readDraftTitle()')).toBeLessThan(run.indexOf('deps.publish()'))
  })
  it('全选自动发布＝全部产品 enabled（时间配置为店铺级批次计划，统一作用于所有产品）', () => {
    const head = app.split('全选自动发布</button>')[0]?.split('ebay-scheduled-head-actions')[1] ?? ''
    expect(head).toContain('toggleScheduledPublish(m,p.id,true')
    expect(app).toContain('dueScheduledPublish(scheduledPublishRef.current,new Date().toISOString(),schedulePlanRef.current)')
  })
})

const sched = readFileSync(path.resolve(process.cwd(), 'src/shared/ebayScheduledPublish.ts'), 'utf8')

describe('自动发布 · chip 状态机与 once 到点放行', () => {
  it('确认新计划（含 custom）与行内开关清除失败+跳过留痕，chip 回到 waiting 显示下次北京时间', () => {
    expect(sched, '清运行留痕纯函数').toContain('export const clearScheduleRunTraces')
    expect(app, '确认弹窗两分支都清留痕').toContain('clearScheduleRunTraces(applyScheduleConfigToAll(')
    expect(app.split('clearScheduleRunTraces(applyScheduleConfigToAll(').length - 1, 'custom 与 daily 两分支各一处').toBe(2)
    expect(app, '行内开关清留痕').toContain('clearScheduleRunTraces(toggleScheduledPublish(')
    expect(sched, '状态优先级 failed>skipped>waiting>idle 不变').toMatch(/lastFailedAt\) return 'failed'[\s\S]*lastSkippedAt\) return 'skipped'[\s\S]*enabled\) return 'waiting'/)
    expect(sched, 'once 的下次时间用 at').toContain("instant = new Date(opts.at || '').getTime()")
  })
  it('自定义 once 到点视为显式指令执行发布；每日批次仍跳过已草稿', () => {
    expect(app, '跳过分支限定非 once').toContain("if(product.draftSavedAt&&scheduledPublishRef.current[id]?.mode!=='once'){")
  })
  it('确认新计划即启用（跳过分支曾置 enabled=false，确认须重新排上）', () => {
    expect(app, 'custom 确认传 enabled:true').toContain("{mode:'once',at:customRunIso(schedulePlanDraft.custom.minutes,nowIso),enabled:true}")
    expect(app, 'daily 确认传 enabled:true').toContain("{mode:'daily',enabled:true}")
    expect(sched, 'cfg.enabled 可选覆盖').toContain('...(cfg.enabled === undefined ? {} : { enabled: cfg.enabled })')
  })
  it('刊登成功须正向上架证据，验证码/错误页不得误判 PUBLISHED', () => {
    const pub = ws.split('async publishEbayCurrentListing(')[1]?.split('async saveEbayCurrentDraft(')[0] ?? ''
    expect(pub, '正向证据判据').toContain("const published=/\\/sl\\/list|itemId=\\d+|\\/itm\\/\\d+/.test(url)&&!/captcha|splashui|\\/error/.test(url)")
    expect(pub, '非成功页中文点名').toContain('落地页非上架成功页（疑似验证码/错误页）')
  })
})

describe('自动发布 · prepare 长挂不再永久阻塞后续到点', () => {
  it('执行链抽离到 scheduledPublishRun：整链 300s 竞态超时＋过期 token 守卫', () => {
    expect(run).toContain("import { raceTimeout } from '../shared/raceTimeout'")
    expect(run).toContain('SCHEDULED_RUN_TIMEOUT_MS=300_000')
    expect(run).toContain('await raceTimeout(chain,timeoutMs,SCHEDULED_RUN_TIMEOUT_MESSAGE)')
    expect(run, '每个 await 后拦截迟到续跑').toContain('const guard=()=>{if(expired)throw new Error(SCHEDULED_RUN_TIMEOUT_MESSAGE)}')
    expect(run, '超时后置过期，迟到结果不得写副作用').toContain('expired=true')
    expect(run).toContain('自动发布执行超时（300秒），已中止本轮，可重新开启自动发布重试')
  })
  it('App 接线：走 runScheduledPublishChain，flag 复位挪进 finally（超时/失败/成功都复位）', () => {
    expect(app).toContain("import { runScheduledPublishChain } from './scheduledPublishRun'")
    const line = app.split('\n').find(l => l.includes('dueScheduledPublish(scheduledPublishRef.current')) || ''
    expect(line).toContain('await runScheduledPublishChain({title:product.title,skipFill:savedDraft,prepare:()=>savedDraft?openSavedDraftForRun(product):window.desktop.ebay.prepareLocalProductRevision(id)')
    expect(line).toContain('finally{scheduledRunning.current[id]=false}')
    expect(line, '失败写回不变（daily 记 lastRunAt、once 停用）').toContain("entry?.mode==='daily'?{...entry,lastRunAt:new Date().toISOString(),lastSkippedAt:''}:{enabled:false,at:entry?.at||'',lastSkippedAt:''}")
    expect(line, '成功删 entry 不变').toContain('const m={...scheduledPublishRef.current};delete m[id];writeScheduledPublish(m)')
    expect(line, '旧的内联重试循环已移除').not.toContain("let lastError='';for(let attempt=0;attempt<2;attempt+=1)")
  })
})