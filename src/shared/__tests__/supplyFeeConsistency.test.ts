import { describe, expect, it } from 'vitest'
import { pickSupplyFees } from '../supplyFeePick'

// BrowserWorkspace 以 toString() 把 pickSupplyFees 注入原页执行；用字符串化形态回归，防模板串语法/const 再赋值类崩溃复发
const injectedPick = new Function('return ' + pickSupplyFees.toString())() as typeof pickSupplyFees

const dualSections = {
  packing: ['$3.90'],
  freight: ['$19.45~$61.90', '$43.78'],
  shipping: ['$23.35~$65.80 /件', '$47.68 /件']
}

describe('pickSupplyFees 一件代发/云送仓双费用套择真', () => {
  it('一件代发与云送仓并存时按预估总额一致性选中一件代发套（注入形态）', () => {
    const pick = injectedPick(dualSections, '$235.00', '$282.68')
    expect(pick.packingFee).toBe('$3.90')
    expect(pick.freightFee).toBe('$43.78')
    expect(pick.shippingFee).toBe('$47.68 /件')
  })

  it('直接调用与注入形态结果一致', () => {
    expect(pickSupplyFees(dualSections, '$235.00', '$282.68')).toEqual(injectedPick(dualSections, '$235.00', '$282.68'))
  })

  it('区间值为真值时原样保留区间串', () => {
    const pick = pickSupplyFees(
      { packing: ['$3.90'], freight: ['$19.45~$61.90'], shipping: ['$23.35~$65.80 /件'] },
      '$235.00',
      '$258.35'
    )
    expect(pick.shippingFee).toBe('$23.35~$65.80 /件')
    expect(pick.freightFee).toBe('$19.45~$61.90')
    expect(pick.packingFee).toBe('$3.90')
  })

  it('单价/总额缺失时回落文档序首候选且不抛错', () => {
    const pick = pickSupplyFees(dualSections, '', '')
    expect(pick).toEqual({ packingFee: '$3.90', freightFee: '$19.45~$61.90', shippingFee: '$23.35~$65.80 /件' })
  })

  it('候选全空返回空串不抛错（注入形态）', () => {
    expect(injectedPick({ packing: [], freight: [], shipping: [] }, '$235.00', '$282.68')).toEqual({
      packingFee: '',
      freightFee: '',
      shippingFee: ''
    })
  })

  it('总额与任何物流费候选都不一致时保留首候选', () => {
    const pick = pickSupplyFees(dualSections, '$235.00', '$999.00')
    expect(pick.shippingFee).toBe('$23.35~$65.80 /件')
  })
})
