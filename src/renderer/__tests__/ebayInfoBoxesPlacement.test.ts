import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const cssSource = readFileSync(path.join(__dirname, '..', 'image-studio.css'), 'utf8')

/**
 * 用户口径（2026-11-14 截图）：顶部 notice 横幅、登录状态横幅、填写/下载结果 toast 三个信息框
 * 全部移入左栏工作台底部槽位堆叠；其它页签同类信息框同样入各自左栏；左栏折叠或无左栏时
 * 信息不得丢失（回落到顶部原位）。只改位置与容器样式，不改内容与交互。
 */
describe('信息框归位左栏 · 渲染点守卫', () => {
  it('信息框收拢为单一 fragment，含登录横幅/notice/error/toast 四者', () => {
    const start = appSource.indexOf('const ebayInfoBoxes=')
    expect(start).toBeGreaterThan(-1)
    const body = appSource.slice(start, appSource.indexOf('const ebayInfoInAside=', start))
    expect(body).toContain('{loginBanner}')
    expect(body).toContain('ebay-success-notice')
    expect(body).toContain('ebay-error-notice')
    expect(body).toContain('ebay-download-toast')
  })

  it('四类信息框各只渲染一次，不再顶部与左栏双份', () => {
    expect(appSource.split('className="ebay-success-notice"').length - 1).toBe(1)
    expect(appSource.split('className="ebay-error-notice"').length - 1).toBe(1)
    expect(appSource.split('className={`ebay-download-toast ').length - 1).toBe(1)
    expect(appSource.split('{loginBanner}').length - 1).toBe(1)
    expect(appSource).not.toContain('{!browserOnly&&loginBanner}')
    expect(appSource).not.toContain('{browserOnly&&loginBanner}')
  })

  it('店铺采集左栏删除店铺下方即信息槽位', () => {
    expect(appSource).toContain('{ebayInfoInAside&&<div className="ebay-workbench-info">{ebayInfoBoxes}</div>}</section></aside>')
  })

  it('五个有左栏的页签都插入槽位（browser/library/local/premium/optimize）', () => {
    expect(appSource.split('className="ebay-workbench-info"').length - 1).toBe(5)
  })

  it('顶部一律不再渲染信息框：回落渲染必须不存在（2026-11-14 用户拍板）', () => {
    expect(appSource).not.toContain('{!ebayInfoInAside&&ebayInfoBoxes}')
    expect(appSource.split('{ebayInfoBoxes}').length - 1).toBe(5)
    expect(appSource).not.toMatch(/ebay-workspace[^\n]*>\s*\{ebayInfoBoxes\}/)
  })
})

describe('信息框归位左栏 · 槽位样式', () => {
  it('槽位为堆叠网格，toast 改静态不再遮罩内容', () => {
    expect(cssSource).toContain('.ebay-workbench-info{display:grid')
    const start = cssSource.indexOf('.ebay-workbench-info .ebay-download-toast')
    expect(start).toBeGreaterThan(-1)
    expect(cssSource.slice(start, cssSource.indexOf('}', start))).toContain('position:static')
  })

  it('窄栏内 notice/error 允许换行且字号可读', () => {
    const start = cssSource.indexOf('.ebay-workbench-info .ebay-success-notice')
    expect(start).toBeGreaterThan(-1)
    const block = cssSource.slice(start, cssSource.indexOf('}', start))
    expect(block).toContain('align-items:flex-start')
    expect(block).toContain('font-size:10px')
  })
})