import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 进入发布回落链（2026-11-18）：全流程后本地行被移除属预期；无本地行但存在在线商品
 * （listings 命中或 viewUrl/listingId 含 itm id）→ 打开 eBay ReviseItem 修改页，不重复新建、
 * 不误弹「尚未同步为本地产品」；仅真正无源才模态。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const seg = app.split('const openPublishEditorFromDraft=')[1]?.split('\n  const ')[0] ?? ''

describe('进入发布 · 无本地行回落链', () => {
  it('无本地行先查在线商品/itm id，命中开 ReviseItem 而非模态', () => {
    expect(seg).toContain('const online=listings.find(')
    expect(seg).toContain('mode=ReviseItem&itemId=')
    expect(seg).toContain("setActiveTab('browser')")
    expect(seg.indexOf('mode=ReviseItem&itemId=')).toBeLessThan(seg.indexOf('setPublishNoMatchDraft(premium)'))
  })
  it('仅真正无源才置模态', () => {
    expect(seg).toContain('if(!lp){')
    expect(seg).toContain('setPublishNoMatchDraft(premium);return')
  })
  it('回落打开修改页有中文说明不重复新建', () => {
    expect(seg).toContain('不重复新建')
  })
})