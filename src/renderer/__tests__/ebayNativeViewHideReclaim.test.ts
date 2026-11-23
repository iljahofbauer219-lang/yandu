import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-23 19:25 截图重叠仍在）：非店铺浏览页签激活时内嵌原生视图必须恒隐藏。
 * 根因：hide effect 仅在 activeTab 变化时跑；prepare/开原商品等主进程 workspace.show 随后重新-show
 * 原生视图 → 非 browser 页签原生盖覆编辑器成上下重叠。修复：非 browser 分支订阅 browser.onState，
 * 每次主进程状态发射即收回 show 权（hide 幂等）；切回 browser 仍走既有 reattach/show。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')

describe('主进程 renderer 页签权限位', () => {
  it('attachView 双门：browserVisible 且 rendererAllowsBrowser', () => {
    expect(ws).toContain('if (!this.browserVisible || !this.rendererAllowsBrowser) return')
    expect(ws).toContain('private rendererAllowsBrowser = true')
  })
  it('hide 置 false、IPC show 先置 true 再 show', () => {
    expect(ws).toContain('  hide() {\n    this.browserVisible = false\n    this.rendererAllowsBrowser = false')
    expect(ws).toContain('  allowRendererBrowser() {\n    this.rendererAllowsBrowser = true\n  }')
    expect(main).toContain("ipcMain.handle('browser:show', (_event, platform: Platform, tabId?: string) => { workspace?.allowRendererBrowser(); return workspace?.show(platform, tabId) })")
  })
})

describe('非browser页签原生视图恒隐藏', () => {
  it('非 browser 分支 hide 后订阅 onState+onTabs 双通道收回 show 权并随 effect 清理', () => {
    expect(app).toContain("if(activeTab!=='browser'||!activeStore||storeFormOpen||!showBrowser){void window.desktop.browser.hide();const reclaim=()=>{void window.desktop.browser.hide()};const offState=window.desktop.browser.onState(reclaim);const offTabs=window.desktop.browser.onTabs(reclaim);return()=>{offState();offTabs()}}")
  })
  it('browser 页签 reattach/show 链路不动', () => {
    expect(app).toContain("await window.desktop.browser.show('web', ebayOwnTabId.current)")
    expect(app).toContain("if(lockTitleMode){if(!titleBrowserUrl){void window.desktop.browser.hide();return}return()=>void window.desktop.browser.hide()}")
  })
})