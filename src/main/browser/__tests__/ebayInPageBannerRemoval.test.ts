import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceSource = readFileSync(path.join(__dirname, '..', 'BrowserWorkspace.ts'), 'utf8')
const appSource = readFileSync(path.join(__dirname, '..', '..', '..', 'renderer', 'App.tsx'), 'utf8')

/**
 * 用户口径（2026-11-14 截图）：注入 eBay 页内的固定/自动填写、prepare、视频上传横幅
 * （__cross_border_local_revision_guard / __cross_border_publish_guard）一律移除，
 * 信息统一走应用左栏槽位（notice/error/toast）。这些文案渲染器本就有通道：
 * 填写 notice 含 warnings（App.tsx 4413）、prepare 用 task.message、视频用 task.videoUpload.message。
 * 旧横幅节点须在下次操作时清除，不残留遮罩页内内容。
 */
describe('页内注入横幅移除 · 主进程守卫', () => {
  it('不再创建页内横幅节点', () => {
    expect(workspaceSource).not.toContain("banner=document.createElement('div')")
    expect(workspaceSource).not.toContain('banner.textContent=')
  })

  it('两类旧横幅节点在操作时清除', () => {
    expect(workspaceSource).toContain("__cross_border_local_revision_guard')?.remove()")
    expect(workspaceSource).toContain("__cross_border_publish_guard')?.remove()")
  })

  it('填写/prepare/视频结果仍回传渲染器所需字段', () => {
    expect(workspaceSource).toContain('filledFields:[...new Set(filledFields)]')
    expect(workspaceSource).toContain('skippedFields:[...new Set(skippedFields)]')
    expect(workspaceSource).toContain('warnings')
  })
})

describe('页内注入横幅移除 · 渲染器通道守卫', () => {
  it('填写 notice 含跳过明细与 warnings，且走左栏槽位', () => {
    expect(appSource).toContain('result.warnings.join')
    expect(appSource).toContain('ebayInfoBoxes')
  })

  it('prepare 与视频上传提示经 task.message 进 notice', () => {
    expect(appSource).toContain('setNotice(`${task.message}。系统没有点击最终提交按钮。`)')
    expect(appSource).toContain('setNotice(`${task.videoUpload?.message||task.message}。系统没有点击最终提交按钮。`)')
  })
})