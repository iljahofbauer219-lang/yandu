import { describe, expect, it } from 'vitest'
import { US_SALES_TAX_NATIONAL, US_SALES_TAX_TABLE, usSalesTaxCombinedRate, usSalesTaxLabel, usSalesTaxNationalAverageRate } from '../usSalesTax'

describe('usSalesTax 表', () => {
  it('覆盖 50 州加 DC 共 51 辖区且代码不重复', () => {
    expect(US_SALES_TAX_TABLE).toHaveLength(51)
    expect(new Set(US_SALES_TAX_TABLE.map(item => item.code)).size).toBe(51)
    expect(US_SALES_TAX_TABLE.every(item => item.combinedRate >= 0 && item.combinedRate <= 20)).toBe(true)
  })

  it('关键辖区与 2026 版真值一致，无销售税州为 0', () => {
    expect(usSalesTaxCombinedRate('CA')).toBe(8.99)
    expect(usSalesTaxCombinedRate('NY')).toBe(8.54)
    expect(usSalesTaxCombinedRate('LA')).toBe(10.11)
    expect(usSalesTaxCombinedRate('WA')).toBe(9.51)
    expect(usSalesTaxCombinedRate('DE')).toBe(0)
    expect(usSalesTaxCombinedRate('OR')).toBe(0)
  })

  it('全国平均为 51 辖区简单平均，小写与空白代码可识别', () => {
    expect(usSalesTaxNationalAverageRate()).toBe(6.64)
    expect(usSalesTaxCombinedRate(US_SALES_TAX_NATIONAL)).toBe(6.64)
    expect(usSalesTaxCombinedRate(' ca ')).toBe(8.99)
  })

  it('未知辖区返回 null 且标签如实标注，交由调用方保原值', () => {
    expect(usSalesTaxCombinedRate('XX')).toBeNull()
    expect(usSalesTaxCombinedRate(undefined)).toBeNull()
    expect(usSalesTaxLabel('XX')).toBe('未知辖区')
    expect(usSalesTaxLabel(US_SALES_TAX_NATIONAL)).toBe('全国平均')
    expect(usSalesTaxLabel('CA')).toBe('California（CA）')
  })
})
