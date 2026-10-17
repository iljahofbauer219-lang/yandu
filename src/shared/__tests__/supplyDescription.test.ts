import { describe, expect, it } from 'vitest'
import { pickSupplyDescriptionText } from '../supplyDescription'

describe('pickSupplyDescriptionText（图文描述只认真实版块）', () => {
  it('版块缺失（null）返回空串，不得回落全文', () => {
    expect(pickSupplyDescriptionText(null)).toBe('')
  })

  it('版块存在返回 trim 后原文', () => {
    expect(pickSupplyDescriptionText('  赛车座椅详情段落\n第二行  ')).toBe('赛车座椅详情段落\n第二行')
  })

  it('空版块文本返回空串', () => {
    expect(pickSupplyDescriptionText('   ')).toBe('')
  })

  it('超 20000 字截断', () => {
    expect(pickSupplyDescriptionText('x'.repeat(20005)).length).toBe(20000)
  })
})
