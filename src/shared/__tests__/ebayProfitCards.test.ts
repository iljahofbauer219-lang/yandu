import { describe, expect, it } from 'vitest'
import { computeEbayProfitCards } from '../ebayProfitCards'

const base = {
  exchangeRate: 6.6798,
  purchaseCostUsd: 235,
  logisticsCostUsd: 52.72,
  packagingCostCny: 0,
  fulfillmentCostCny: 0,
  otherCostCny: 0,
  salePriceUsd: 469.63,
  platformFeeRate: 11.5,
  salesTaxRate: 6.64,
  internationalShippingRate: 1.3,
  fixedFeeUsd: 0.4,
  promotionFeeRate: 5,
  returnLossRate: 2
}

describe('四卡美元利润链纯函数', () => {
  it('产品成本＝成本要素五项之和（人民币三项按核算汇率折美元），不含平台固定费', () => {
    const cards = computeEbayProfitCards(base)
    expect(cards.productCostUsd).toBeCloseTo(287.72, 6)
    const withCny = computeEbayProfitCards({ ...base, packagingCostCny: 66.798, fulfillmentCostCny: 33.399, otherCostCny: 6.6798 })
    expect(withCny.productCostUsd).toBeCloseTo(287.72 + 10 + 5 + 1, 6)
  })

  it('销售成本＝平台与经营费率拆解（含固定费、代收税基数）＋推广佣金＋退货预留，按销售价格基数计提', () => {
    const cards = computeEbayProfitCards(base)
    // 计费基数 469.63×1.0664=500.81；成交费 57.59＋国际运费 6.51＋固定费 0.40=64.50
    expect(cards.platformFeesUsd).toBeCloseTo(64.5, 2)
    expect(cards.promotionFeeUsd).toBeCloseTo(469.63 * 0.05, 6)
    expect(cards.returnLossUsd).toBeCloseTo(469.63 * 0.02, 6)
    expect(cards.sellingCostUsd).toBeCloseTo(64.5 + 469.63 * 0.05 + 469.63 * 0.02, 6)
  })

  it('销售价格透传建议销售价；产品毛利＝销售价格−产品成本−销售成本', () => {
    const cards = computeEbayProfitCards(base)
    expect(cards.salePriceUsd).toBeCloseTo(469.63, 6)
    expect(cards.grossProfitUsd).toBeCloseTo(469.63 - cards.productCostUsd - cards.sellingCostUsd, 6)
    expect(cards.grossProfitUsd).toBeCloseTo(84.5359, 3)
  })

  it('费率为零时销售成本只剩固定费；毛利可为负（不夹零）', () => {
    const cards = computeEbayProfitCards({ ...base, platformFeeRate: 0, salesTaxRate: 0, internationalShippingRate: 0, promotionFeeRate: 0, returnLossRate: 0, salePriceUsd: 100 })
    expect(cards.sellingCostUsd).toBeCloseTo(0.4, 6)
    expect(cards.grossProfitUsd).toBeCloseTo(100 - 287.72 - 0.4, 6)
    expect(cards.grossProfitUsd).toBeLessThan(0)
  })

  it('汇率缺省不除零：人民币成本按保护汇率折算，不产生 Infinity/NaN', () => {
    const cards = computeEbayProfitCards({ ...base, exchangeRate: 0, packagingCostCny: 10 })
    expect(Number.isFinite(cards.productCostUsd)).toBe(true)
    expect(Number.isFinite(cards.grossProfitUsd)).toBe(true)
  })
})