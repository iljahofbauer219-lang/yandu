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
  it('弹窗/刊登资料抽屉打开隐藏原生视图、关闭恢复（复用 browser.hide/show，不新增 IPC）', () => {
    expect(source).toContain("const overlayOpen=ebayFixedPresetOpen||(localEditorMode==='details'&&Boolean(localEditorProduct))")
    expect(source).toContain("if(overlayOpen){void window.desktop.browser.hide()")
    expect(source).toContain("window.desktop.browser.show('web')")
    expect(source).toMatch(/\[ebayFixedPresetOpen,localEditorMode,localEditorProduct,activeTab,activeStore\?\.id\]/)
  })

  it('弹窗打开时残留通知/错误/下载/登录横条不渲染，关闭后恢复', () => {
    expect(source).toContain('{notice&&!ebayFixedPresetOpen&&')
    expect(source).toContain('{ebayError&&!ebayFixedPresetOpen&&')
    expect(source).toContain('{downloadToast&&!ebayFixedPresetOpen&&')
  })

  it('Y：预设弹窗「开」时渲染三档折扣下拉且绑定 draft，可保存', () => {
    expect(source).toContain('ebayFixedPresetDraft.volumePricingEnabled===true&&')
    expect(source).toContain('volumeTier2')
    expect(source).toContain('volumeTier3')
    expect(source).toContain('volumeTier4')
  })

  it('Z：预设弹窗物品状况下渲染数量输入且绑定 draft', () => {
    expect(source).toContain('ebayFixedPresetDraft.quantity')
  })

  it('AE：预设弹窗不再显示费用项警示段（费用授权逻辑保留）', () => {
    expect(source).not.toContain('ebay-fixed-preset-fee-warn')
    expect(source).toContain('promotedRegularEnabled')
  })
})