import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * W 批：打开「预设」弹窗时界面须干净——内嵌 eBay 原生视图（含页内注入的绿横幅）隐藏、
 * 渲染层残留通知横条不渲染；关闭后恢复。只改显隐，不动填写/预设逻辑。
 * 原生视图恒盖渲染层之上，故必须经 browser.hide/show 联动；notice 等横条条件渲染。
 */
const source = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('预设弹窗显隐联动（W）', () => {
  it('弹窗打开隐藏原生视图、关闭恢复（复用 browser.hide/show，不新增 IPC）', () => {
    expect(source).toContain("if(ebayFixedPresetOpen){void window.desktop.browser.hide()")
    expect(source).toContain("window.desktop.browser.show('web')")
    expect(source).toMatch(/\[ebayFixedPresetOpen,activeTab,activeStore\?\.id\]/)
  })

  it('弹窗打开时残留通知/错误/下载/登录横条不渲染，关闭后恢复', () => {
    expect(source).toContain('{notice&&!ebayFixedPresetOpen&&')
    expect(source).toContain('{ebayError&&!ebayFixedPresetOpen&&')
    expect(source).toContain('{downloadToast&&!ebayFixedPresetOpen&&')
  })
})