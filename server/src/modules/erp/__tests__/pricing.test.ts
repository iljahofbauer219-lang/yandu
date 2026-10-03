/**
 * pricing 纯函数单测（P4 / M4）：
 *   - computeReferencePrice：公式与手算一致（成本加成 + 佣金反推 + 固定费）
 *   - 非法参数（倍率≤0 / 佣金率≥1 / 汇率≤0）抛 400
 *   - resolveExchangeRate：同币种=1、配置表命中、缺失抛错
 *   - round2：四舍五入到 2 位
 * 触库路径（pricing-rules CRUD / listings / recalc / export）由 verify-erp-p4.ts e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { computeReferencePrice, resolveExchangeRate, round2, DEFAULT_PRICING_RULES } from '../pricing.js'

describe('round2', () => {
  it('四舍五入到 2 位小数', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(10.620689)).toBe(10.62)
    expect(round2(3)).toBe(3)
  })
})

describe('computeReferencePrice', () => {
  it('公式与手算一致：CNY→USD，倍率2.2/佣金0.13/固定费0.3', () => {
    // landedCost = (20+10)*0.14 = 4.20
    // target     = 4.20*2.2      = 9.24
    // gross      = 9.24/(1-0.13) = 10.620689…
    // price      = round2(10.620689+0.3) = 10.92
    // commission = round2(10.620689-9.24) = 1.38
    const result = computeReferencePrice({
      costPrice: 20, shippingCost: 10, markupRate: 2.2, commissionRate: 0.13,
      fixedFee: 0.3, exchangeRate: 0.14, currency: 'USD'
    })
    expect(result.landedCost).toBe(4.2)
    expect(result.target).toBe(9.24)
    expect(result.price).toBe(10.92)
    expect(result.commission).toBe(1.38)
    expect(result.currency).toBe('USD')
  })

  it('零佣金时 price = landedCost*markup + fixedFee', () => {
    const result = computeReferencePrice({
      costPrice: 100, shippingCost: 0, markupRate: 2, commissionRate: 0,
      fixedFee: 5, exchangeRate: 1, currency: 'CNY'
    })
    expect(result.landedCost).toBe(100)
    expect(result.price).toBe(205) // 100*2/1 + 5
    expect(result.commission).toBe(0)
  })

  it('运费计入到手成本', () => {
    const withShip = computeReferencePrice({ costPrice: 10, shippingCost: 10, markupRate: 2, commissionRate: 0, fixedFee: 0, exchangeRate: 1, currency: 'USD' })
    const noShip = computeReferencePrice({ costPrice: 10, shippingCost: 0, markupRate: 2, commissionRate: 0, fixedFee: 0, exchangeRate: 1, currency: 'USD' })
    expect(withShip.price).toBe(40)
    expect(noShip.price).toBe(20)
  })

  it('倍率≤0 抛 ERP_BAD_MARKUP', () => {
    expect(() => computeReferencePrice({ costPrice: 1, shippingCost: 0, markupRate: 0, commissionRate: 0.1, fixedFee: 0, exchangeRate: 1, currency: 'USD' }))
      .toThrowError(expect.objectContaining({ code: 'ERP_BAD_MARKUP' }))
  })

  it('佣金率≥1 抛 ERP_BAD_COMMISSION', () => {
    expect(() => computeReferencePrice({ costPrice: 1, shippingCost: 0, markupRate: 2, commissionRate: 1, fixedFee: 0, exchangeRate: 1, currency: 'USD' }))
      .toThrowError(expect.objectContaining({ code: 'ERP_BAD_COMMISSION' }))
  })

  it('汇率≤0 抛 ERP_BAD_FX', () => {
    expect(() => computeReferencePrice({ costPrice: 1, shippingCost: 0, markupRate: 2, commissionRate: 0.1, fixedFee: 0, exchangeRate: 0, currency: 'USD' }))
      .toThrowError(expect.objectContaining({ code: 'ERP_BAD_FX' }))
  })
})

describe('resolveExchangeRate', () => {
  const table = { 'CNY->USD': 0.14, 'USD->CNY': 7.14 }
  it('同币种汇率为 1', () => {
    expect(resolveExchangeRate('USD', 'USD', table)).toBe(1)
    expect(resolveExchangeRate('cny', 'CNY', table)).toBe(1)
  })
  it('命中配置表（大小写不敏感）', () => {
    expect(resolveExchangeRate('cny', 'usd', table)).toBe(0.14)
    expect(resolveExchangeRate('USD', 'CNY', table)).toBe(7.14)
  })
  it('缺失汇率抛 ERP_FX_MISSING', () => {
    expect(() => resolveExchangeRate('CNY', 'JPY', table)).toThrowError(expect.objectContaining({ code: 'ERP_FX_MISSING' }))
  })
})

describe('DEFAULT_PRICING_RULES', () => {
  it('eBay/Amazon/Ozon 默认目标币种正确', () => {
    expect(DEFAULT_PRICING_RULES.ebay!.currency).toBe('USD')
    expect(DEFAULT_PRICING_RULES.amazon!.currency).toBe('USD')
    expect(DEFAULT_PRICING_RULES.ozon!.currency).toBe('RUB')
  })
  it('佣金率均在 [0,1) 合法区间', () => {
    for (const rule of Object.values(DEFAULT_PRICING_RULES)) {
      expect(rule.commissionRate).toBeGreaterThanOrEqual(0)
      expect(rule.commissionRate).toBeLessThan(1)
      expect(rule.markupRate).toBeGreaterThan(0)
    }
  })
})
