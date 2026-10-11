import { describe, expect, it } from 'vitest'
import { riskBadge } from '../riskBadge'

describe('riskBadge（优选卡风险徽标可读化）', () => {
  it('无风险：文案暂无风险且无悬停标题', () => {
    expect(riskBadge([])).toEqual({ text: '暂无风险', title: '' })
  })

  it('单条风险：直接展示风险文案', () => {
    expect(riskBadge(['类目待核实'])).toEqual({ text: '类目待核实', title: '类目待核实' })
  })

  it('多条风险：首条+计数，悬停标题为全量顿号串', () => {
    expect(riskBadge(['类目待核实', '库存待补采'])).toEqual({ text: '类目待核实 等2项', title: '类目待核实、库存待补采' })
  })
})
