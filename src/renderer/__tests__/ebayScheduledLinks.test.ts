import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 本地定时发布列表的「优化版本/发布版本」须与优品仓库卡片「查看优化版本/进入发布」同链路：
 * 有优品草稿时走草稿链路（openOptimizedVersion / openPublishEditorFromDraft），无草稿回落本地编辑/本地发布种子。
 * 钉住命名函数提取与列表两按钮的草稿优先接线。
 */
const source = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('本地定时发布列表 · 优化版本/发布版本 与优品卡片同链路', () => {
  it('提取 openOptimizedVersion 命名函数（优品卡片复用）', () => {
    expect(source).toContain('const openOptimizedVersion=(draft:EbayOptimizationDraft)=>{')
    expect(source).toContain('onClick={()=>openOptimizedVersion(draft)}>查看优化版本')
  })
  it('列表优化版本：有草稿走 openOptimizedVersion，无草稿回落 openLocalEditor', () => {
    expect(source).toContain('if(draft)openOptimizedVersion(draft);else void openLocalEditor(product)')
  })
  it('列表发布版本：有草稿走 openPublishEditorFromDraft，无草稿回落 openPublishVersion', () => {
    expect(source).toContain('if(draft)void openPublishEditorFromDraft(draft);else openPublishVersion(product)')
  })
})

describe('本地定时发布列表 · 打回优品', () => {
  const start = source.indexOf('const sendBackToPremium=')
  const body = source.slice(start, start + 2600)
  it('行内按钮位于重新优化左侧，带打回中禁用态', () => {
    expect(start).toBeGreaterThan(-1)
    expect(source).toContain("?'打回中…':'打回优品'}</button>")
    expect(source.indexOf('打回优品\'}</button>')).toBeLessThan(source.indexOf('>重新优化</button>'))
  })
  it('有草稿保留合规快照作底、无草稿新建：都先落草稿再退出本地定时发布', () => {
    expect(body).toContain('const existing=optimizationDrafts.find(item=>item.listing.listingId===product.listingId)')
    expect(body).toContain('const base=existing?{...existing}:{}')
    expect(body).toContain('await window.desktop.ebay.removeLocalProduct(product.id)')
    expect(body).toContain('setLocalProducts(await window.desktop.ebay.localProducts(product.storeId))')
  })
  it('草稿图用服务器原 URL（本地媒体目录随移除清理，不能引用 localPath），失败中文点名', () => {
    expect(body).toContain("map(item=>item.remoteUrl||'')")
    expect(body).not.toContain('cross-media://local/')
    expect(body).toContain("readableError(reason,'打回优品失败')")
  })
  it('落库后切优品仓库并按 Item ID 定位卡片', () => {
    expect(body).toContain("setActiveTab('premium')")
    expect(body).toContain('scrollIntoView')
    expect(body).toContain('setOptimizationDrafts(await window.desktop.ebay.optimizationDrafts(product.storeId))')
  })
})

describe('本地产品环节排除已进优品仓库的产品', () => {
  it('派生 localStageProducts：有同 listingId 优品草稿者不列本地环节', () => {
    expect(source).toContain('const localStageProducts=localProducts.filter(product=>!optimizationDrafts.some(draft=>draft.listing.listingId===product.listingId))')
  })
  it('本地页签树/计数/卡 grid 全部改走派生列表，不动 localProducts state', () => {
    expect(source).toContain('const localListings=localStageProducts.map(product=>product.snapshot.sourceListing)')
    expect(source).toContain('const visibleLocalProducts=localStageProducts.filter(')
    expect(source).toContain('全部产品 <em>{localStageProducts.length}</em>')
    expect(source).toContain('缺少本地图片 <em>{localStageProducts.filter(')
  })
})

describe('自动发布调度 · 已存 eBay 草稿跳过重复执行', () => {
  const line = source.split('\n').find(l => l.includes('dueScheduledPublish(scheduledPublishRef.current')) || ''
  it('跳过分支置于 prepare 之前：非 once 且 draftSavedAt 有值直接记完成态+中文 notice，不走执行链', () => {
    expect(line).toContain("if(product.draftSavedAt&&scheduledPublishRef.current[id]?.mode!=='once'){")
    expect(line.indexOf("if(product.draftSavedAt&&scheduledPublishRef.current[id]?.mode!=='once'){")).toBeLessThan(line.indexOf('prepareLocalProductRevision(id)'))
    expect(line).toContain('已在 eBay 草稿栏，跳过重复自动发布')
    expect(line).toContain('clearScheduleFailure(base0,id)')
    expect(line).toContain("entry0?.mode==='daily'?{...entry0,lastRunAt:new Date().toISOString(),lastSkippedAt:new Date().toISOString()}:{enabled:false,at:entry0?.at||'',lastSkippedAt:new Date().toISOString()}")
  })
  it('跳过态行内可见：scheduleStatus=skipped 渲染「已在草稿·跳过」chip（publish 页签无左栏槽位）', () => {
    expect(source).toContain("st==='skipped'?<span className=\"ebay-scheduled-skip\"")
    expect(source).toContain('已在草稿·跳过</span>')
    const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')
    expect(css).toContain('.ebay-scheduled-skip{')
  })
  it('再次执行成功清跳过留痕', () => {
    expect(line).toContain("lastRunAt:new Date().toISOString(),lastSkippedAt:''")
  })
})