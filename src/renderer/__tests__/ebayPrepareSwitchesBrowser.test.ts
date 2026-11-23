import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-23 三截图）：点「eBay保存发布」应直接在店铺浏览浏览器窗口执行；
 * 旧态 prepare 先经 IPC 开 eBay 页再可能抛错，catch 把编辑器留在原页签 → 内嵌原生视图盖覆编辑器成上下重叠乱态。
 * 修复：两 prepare handler 在 prepare IPC 之前无条件 setActiveTab('browser')（不依赖会话守卫/结果），
 * 失败报错随浏览器页签左栏信息槽可见；会话守卫仍只保护编辑器状态写回。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('eBay保存发布切浏览器执行', () => {
  it('publish prepare：切页签在 prepare IPC 前且脱离会话守卫', () => {
    const seg = app.split('const preparePublishEditorInSellerHub=async()=>{')[1]?.split('\n  const readSpecificsFor')[0] ?? ''
    const guardIdx = seg.indexOf('if(isEditorCurrent()) {')
    const switchIdx = seg.indexOf("setActiveTab('browser')")
    const prepareIdx = seg.indexOf('window.desktop.ebay.prepareLocalProductRevision(saved.id)')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(switchIdx).toBeGreaterThan(guardIdx)
    expect(prepareIdx).toBeGreaterThan(switchIdx)
    expect(seg.slice(guardIdx, switchIdx)).not.toContain('setActiveTab')
  })
  it('local prepare：切页签在 prepare IPC 前（失败也不留编辑器叠原生视图）', () => {
    const seg = app.split('const prepareLocalEditorInSellerHub=async()=>{')[1]?.split('\n  const uploadLocalEditorMedia')[0] ?? ''
    const switchIdx = seg.indexOf("setActiveTab('browser')")
    const prepareIdx = seg.indexOf('window.desktop.ebay.prepareLocalProductRevision(product.id)')
    expect(switchIdx).toBeGreaterThan(-1)
    expect(prepareIdx).toBeGreaterThan(switchIdx)
    expect(seg).toContain("setLocalEditorProductId('');setLocalEditorDraft(null);const filled=")
  })
})