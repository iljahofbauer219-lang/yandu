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
  it('到点链含 prepare→refDeleted 中止→标题门→auto→fixed→最终刊登', () => {
    expect(seg).toContain('prepareLocalProductRevision(id)')
    expect(seg).toContain('refDeleted')
    expect(seg).toContain('readCurrentDraftTitle()')
    expect(seg).toContain("fillCurrentTab(id,'auto'")
    expect(seg).toContain("fillCurrentTab(id,'fixed'")
    expect(seg).toContain('publishCurrentListing()')
    expect(seg.indexOf("fillCurrentTab(id,'auto'")).toBeLessThan(seg.indexOf("fillCurrentTab(id,'fixed'"))
    expect(seg.indexOf("fillCurrentTab(id,'fixed'")).toBeLessThan(seg.indexOf('publishCurrentListing()'))
  })
  it('标题不符中止且不点刊登（门在 publish 之前）', () => {
    expect(seg.indexOf('readCurrentDraftTitle()')).toBeLessThan(seg.indexOf('publishCurrentListing()'))
    expect(seg).toContain('草稿标题与本地不符')
  })
  it('全选自动发布＝全部产品 enabled（时间配置为店铺级批次计划，统一作用于所有产品）', () => {
    const head = app.split('全选自动发布</button>')[0]?.split('ebay-scheduled-head-actions')[1] ?? ''
    expect(head).toContain('toggleScheduledPublish(m,p.id,true')
    expect(app).toContain('dueScheduledPublish(scheduledPublishRef.current,new Date().toISOString(),schedulePlanRef.current)')
  })
})