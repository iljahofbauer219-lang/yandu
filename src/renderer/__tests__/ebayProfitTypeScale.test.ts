import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../image-studio.css', import.meta.url), 'utf8')

function fontSize(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*[,{][^}]*?font-size:\\s*([\\d.]+)px`)
  const m = css.match(re)
  if (!m) throw new Error(`no font-size rule for ${selector}`)
  return parseFloat(m[1])
}

describe('售价设定可读字号尺度（红框微字美化）', () => {
  it('四卡标题/副标题与核算公式行不低于 11px', () => {
    expect(fontSize('.ebay-profit-summary small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-summary span')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-formula span')).toBeGreaterThanOrEqual(11)
  })

  it('四卡数值为醒目主数字（≥20px）', () => {
    expect(fontSize('.ebay-profit-summary b')).toBeGreaterThanOrEqual(20)
  })

  it('输入组标签/输入框/说明小字达到可读尺度', () => {
    expect(fontSize('.ebay-profit-fields label')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-fields input')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-fields small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-input-groups>section>header b')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-input-groups>section>header small')).toBeGreaterThanOrEqual(11)
  })

  it('工作台头/核算带标题/自动填充/采用按钮微字全部≥11px', () => {
    expect(fontSize('.ebay-profit-workbench>header b')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-workbench>header small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-workbench>header>span')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-formula b')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-formula small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-autofill-row small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-autofill-row button')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-target-price button')).toBeGreaterThanOrEqual(11)
  })

  it('微字颜色加深保证浅底对比度（不再用浅灰）', () => {
    const grab = (sel: string) => {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = css.match(new RegExp(`${escaped}\\s*\\{[^}]*?color:\\s*(#[0-9a-fA-F]{6})`))
      return m ? m[1].toLowerCase() : null
    }
    // 旧浅灰 #7d8987 / #84908e / #89918f / #84918f / #7a8986 对比度不足，须替换
    for (const sel of ['.ebay-profit-summary small', '.ebay-profit-summary span', '.ebay-profit-fields small', '.ebay-profit-formula small']) {
      const c = grab(sel)
      expect(c, sel).not.toBeNull()
      expect(['#7d8987', '#84908e', '#89918f', '#84918f', '#7a8986', '#71807e', '#70817e']).not.toContain(c)
    }
  })
})