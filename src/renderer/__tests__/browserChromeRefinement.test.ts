import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.join(__dirname, '..', 'image-studio.css'), 'utf8')

/**
 * 方向 C「现状精修」（2026-11-14 用户拍板）：不动布局，只修浏览器外壳可读性与一致性。
 * 现状硬伤：字号 7–8px、控件 26/30/32/39 混高、间距 4/5/7/9 无 scale、无 focus-visible、页签溢出无渐隐。
 * 目标：chrome 控件字号 12px、地址栏控件统一 32px 高、间距 4/8/12/16、焦点环、页签滚动渐隐。
 */
const block = (selector: string) => {
  const start = css.indexOf(selector + '{')
  expect(start, `${selector} 必须存在`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('浏览器外壳 C 精修 · 可读性与一致性守卫', () => {
  it('页签标题与地址栏输入字号提到 12px', () => {
    expect(block('.ebay-browser-tabs button')).toContain('font-size:12px')
    expect(block('.ebay-browser-panel .ebay-address-bar.address-bar input')).toContain('font-size:12px')
    expect(block('.ebay-browser-panel .ebay-address-bar.address-bar input')).toContain('min-height:32px')
  })

  it('地址栏控件统一 32px 高', () => {
    expect(block('.ebay-browser-panel .ebay-address-bar.address-bar button')).toContain('height:32px;min-height:32px')
    expect(block('.ebay-address-bar .translation-trigger')).toContain('height:32px')
    expect(block('.ebay-address-bar .built-in-collector-trigger')).toContain('height:32px')
  })

  it('翻译/采集触发器字号 12px，加载 pill 字号 12px', () => {
    expect(block('.ebay-address-bar .translation-trigger')).toContain('font-size:12px')
    expect(block('.ebay-address-bar .built-in-collector-trigger')).toContain('font-size:12px')
    expect(block('.tabs .run-state')).toContain('font-size:12px')
  })

  it('chrome 控件补 focus-visible 焦点环', () => {
    expect(css).toContain('.ebay-browser-tabs button:focus-visible')
    expect(css).toContain('.ebay-address-bar button:focus-visible')
    expect(css).toContain('.ebay-address-bar input:focus-visible')
  })

  it('页签溢出滚动两端渐隐', () => {
    expect(block('.ebay-browser-tabs .tab-scroll')).toContain('mask-image')
  })

  it('eBay 头部动作区（翻译/填写按钮）同样 32px/12px', () => {
    expect(block('.browser-heading-actions .translation-trigger')).toContain('height:32px;min-height:32px;font-size:12px')
    expect(block('.browser-heading-actions .ebay-fill-actions button')).toContain('height:32px;min-height:32px;font-size:12px')
  })

  it('间距走 4/8/12/16 scale，不再 5/7/9 混用', () => {
    const b = block('.ebay-address-bar')
    expect(b).toContain('gap:8px')
    expect(b).toContain('padding:0 8px')
  })
})