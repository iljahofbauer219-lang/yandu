import { describe, expect, it } from 'vitest'
import { parseEstimatedTotal } from '../supplyEstimatedTotal'

describe('parseEstimatedTotal', () => {
  it('服务器详情页标签与金额分处节点可提取', () => {
    const html = `<div class="fee-row"><span class="label">预估总额(含物流费)</span><span class="value">$282.68 /件</span></div>`
    expect(parseEstimatedTotal(html)).toBe('$282.68 /件')
  })

  it('原站页全角括号与冒号形态可提取', () => {
    const html = `<p>预估总额 （含物流费）：$146.00 /件</p>`
    expect(parseEstimatedTotal(html)).toBe('$146.00 /件')
  })

  it('区间金额与无该字段形态', () => {
    expect(parseEstimatedTotal('<span>预估总额(含物流费) $20.63~$40.30 /件</span>')).toBe('$20.63~$40.30 /件')
    expect(parseEstimatedTotal('<span>物流费：$23.35 /件</span>')).toBe('')
  })
})
