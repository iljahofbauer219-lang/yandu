import { describe, expect, it } from 'vitest'
import { buildEbayCategorySearchText, deriveEbayCostAutoFill, deriveEbayLogisticsUsd, ebayCategoryFeeRule, ebayPlatformFeeBreakdown, parseEbayUsdAmount, parseEbayUsdRange, toEbayProfitCostUsd } from '../ebayPricingAutoFill'

// 真库样本：大健云仓 Item Code 1253671（2PC Universal Bucket Racing Seats）
const pallet = { priceText: '$235.00', estimatedTotal: '$282.68 /件', shippingFeeText: '$23.35 -$65.80 /件' }

describe('parseEbayUsdAmount / parseEbayUsdRange', () => {
  it('从带币种与单位后缀的文本取第一个金额', () => {
    expect(parseEbayUsdAmount('$282.68 /件')).toBe(282.68)
    expect(parseEbayUsdAmount('USD 1,320.50')).toBe(1320.5)
    expect(parseEbayUsdAmount('待补采')).toBe(0)
    expect(parseEbayUsdAmount(undefined)).toBe(0)
  })

  it('区间取首末两值，单值时首末相同', () => {
    expect(parseEbayUsdRange('$23.35 -$65.80 /件')).toEqual({ low: 23.35, high: 65.8 })
    expect(parseEbayUsdRange('$20.63~$40.30 /件')).toEqual({ low: 20.63, high: 40.3 })
    expect(parseEbayUsdRange('物流费：$23.35 /件')).toEqual({ low: 23.35, high: 23.35 })
    expect(parseEbayUsdRange('')).toBeNull()
  })
})

describe('deriveEbayLogisticsUsd', () => {
  it('优先用「预估总额 − 采购价」，落在运费区间内即采纳', () => {
    expect(deriveEbayLogisticsUsd(pallet)).toEqual({ usd: 47.68, source: '自动取自预估总额 $282.68 − 采购价 $235.00 = $47.68' })
  })

  it('预估总额与采购价差值超出运费区间时回落到区间中值', () => {
    const derived = deriveEbayLogisticsUsd({ ...pallet, estimatedTotal: '$400.00 /件' })
    expect(derived?.usd).toBe(44.58)
    expect(derived?.source).toBe('自动取自物流费区间 $23.35–$65.80 中值 $44.58')
  })

  it('无预估总额时用区间中值，单值运费直接用该值', () => {
    expect(deriveEbayLogisticsUsd({ priceText: '$235.00', estimatedTotal: '', shippingFeeText: '$23.35 -$65.80 /件' })?.usd).toBe(44.58)
    expect(deriveEbayLogisticsUsd({ priceText: '$235.00', estimatedTotal: '', shippingFeeText: '物流费：$30.00 /件' })?.usd).toBe(30)
    expect(deriveEbayLogisticsUsd({ priceText: '$235.00', estimatedTotal: '', shippingFeeText: '待补采' })).toBeNull()
  })
})

describe('deriveEbayCostAutoFill', () => {
  it('按产品数据填出美元成本，汇率只决定核算汇率是否可用', () => {
    const result = deriveEbayCostAutoFill({ ...pallet, cnyPerUsd: 7.12 })
    expect(result.purchaseUsd).toBe(235)
    expect(result.logisticsUsd).toBe(47.68)
    expect(result.purchaseSource).toBe('自动取自货盘采购价 $235.00')
    expect(result.warnings).toEqual([])
  })

  it('缺采购价/缺物流费/汇率不可用分别给出中文提示并保持为 0', () => {
    const empty = deriveEbayCostAutoFill({ priceText: '', estimatedTotal: '', shippingFeeText: '', cnyPerUsd: 0 })
    expect(empty.purchaseUsd).toBe(0)
    expect(empty.logisticsUsd).toBe(0)
    expect(empty.warnings).toEqual([
      '未读取到该产品的货盘采购价，采购成本保持原值。',
      '未读取到该产品的物流费与预估总额，物流成本保持原值。',
      '最新汇率获取失败，核算汇率保持原值（美元成本仍按产品数据填入），可点「重试取最新汇率」再来一次。'
    ])
  })

  it('汇率不可用时美元成本照常填入，只提示汇率保持原值', () => {
    const result = deriveEbayCostAutoFill({ ...pallet, cnyPerUsd: 0 })
    expect(result.purchaseUsd).toBe(235)
    expect(result.logisticsUsd).toBe(47.68)
    expect(result.warnings).toEqual(['最新汇率获取失败，核算汇率保持原值（美元成本仍按产品数据填入），可点「重试取最新汇率」再来一次。'])
  })
})

describe('toEbayProfitCostUsd', () => {
  it('成本未被手改过时直接用填充凭据里的美元原值', () => {
    expect(toEbayProfitCostUsd(1572.46, 235, 6.6913)).toBe(235)
    expect(toEbayProfitCostUsd(319.04, 47.68, 6.6913)).toBe(47.68)
  })

  it('手改过人民币值时按当时汇率反推，不丢用户改过的数', () => {
    expect(toEbayProfitCostUsd(999, 235, 6.6913)).toBe(149.3)
  })

  it('没有填充凭据时按汇率反推；汇率也缺失则原样保留、绝不清零', () => {
    expect(toEbayProfitCostUsd(720, 0, 7.2)).toBe(100)
    expect(toEbayProfitCostUsd(720, undefined, 0)).toBe(720)
  })

  it('旧记录为空时保持 0，异常入参不会产出 NaN', () => {
    expect(toEbayProfitCostUsd(undefined, undefined, undefined)).toBe(0)
    expect(toEbayProfitCostUsd(null, 62, 6.6913)).toBe(62)
    expect(toEbayProfitCostUsd('abc' as unknown as number, 235, 6.6913)).toBe(235)
  })
})

describe('ebayPlatformFeeBreakdown', () => {
  it('与后台结算页同口径：计费基数含代收销售税，逐行舍入到分', () => {
    const b = ebayPlatformFeeBreakdown({ salePrice: 80, salesTaxRate: 10.55, finalValueFeeRate: 12.7, internationalShippingRate: 1.3, fixedFee: 0.4 })
    expect(b).toEqual({ feeBase: 88.44, finalValueFee: 11.23, internationalShippingFee: 1.15, goodsFeeTotal: 12.38, fixedFee: 0.4, totalFees: 12.78, netProceeds: 67.22 })
  })

  it('销售税为 0 时计费基数等于售价，国际运费置 0 即不收', () => {
    const b = ebayPlatformFeeBreakdown({ salePrice: 235, salesTaxRate: 0, finalValueFeeRate: 11.5, internationalShippingRate: 0, fixedFee: 0.4 })
    expect(b.feeBase).toBe(235)
    expect(b.finalValueFee).toBe(27.03)
    expect(b.internationalShippingFee).toBe(0)
    expect(b.totalFees).toBe(27.43)
    expect(b.netProceeds).toBe(207.57)
  })

  it('负值与异常入参按 0 处理，不产出 NaN', () => {
    const b = ebayPlatformFeeBreakdown({ salePrice: -5, salesTaxRate: NaN, finalValueFeeRate: -1, internationalShippingRate: undefined as unknown as number, fixedFee: 0.4 })
    expect(b).toEqual({ feeBase: 0, finalValueFee: 0, internationalShippingFee: 0, goodsFeeTotal: 0, fixedFee: 0.4, totalFees: 0.4, netProceeds: -0.4 })
  })
})

describe('ebayCategoryFeeRule', () => {
  it('保留原有规则并新增家居与园艺 12.7%（乐器/高客单运动鞋/书籍影音/通用 13.6）', () => {
    expect(ebayCategoryFeeRule('Musical Instruments', 200).rate).toBe(6.7)
    expect(ebayCategoryFeeRule('乐器', 20).rate).toBe(6.7)
    expect(ebayCategoryFeeRule('Athletic Shoes', 150).rate).toBe(8)
    expect(ebayCategoryFeeRule('运动鞋', 149).rate).toBe(13.6)
    expect(ebayCategoryFeeRule('Books, Movies & Music', 30).rate).toBe(15.3)
    expect(ebayCategoryFeeRule('书籍', 30).rate).toBe(15.3)
    expect(ebayCategoryFeeRule('Home & Garden', 80).rate).toBe(12.7)
    expect(ebayCategoryFeeRule('居家日用品 / 挡风、遮阳、防雨工具 / 雨棚/帐篷 家居', 80).rate).toBe(12.7)
    expect(ebayCategoryFeeRule('Home & Garden', 30).label).toBe('家居与园艺类目规则 12.7%（$2,500 以内，超出部分另计）')
    expect(ebayCategoryFeeRule('Toys & Hobbies', 30).rate).toBe(13.6)
    expect(ebayCategoryFeeRule('', 30).label).toBe('eBay 美国站通用类目规则 13.6%')
  })

  it('货盘类目与店铺类目任一含汽车要素即命中汽配件 11.5%', () => {
    const autoParts = buildEbayCategorySearchText(['零部件', '汽配 (3) / 零部件', '汽车用品 / 汽车内饰改装 / 改装座椅'])
    const rule = ebayCategoryFeeRule(autoParts, 235)
    expect(rule.rate).toBe(11.5)
    expect(rule.label).toBe('eBay 汽配件类目 11.5%（$1,000 以内，超出部分 2.35%）')
    expect(ebayCategoryFeeRule(['汽车配件与运输 / 零部件', ''], 235).rate).toBe(11.5)
    expect(ebayCategoryFeeRule(['Vehicle Parts & Accessories'], 235).rate).toBe(11.5)
  })

  it('数组入参忽略空值并用首个非空文本命名通用规则', () => {
    expect(ebayCategoryFeeRule(['', undefined, '玩具', ''], 10).label).toBe('玩具 · 通用类目规则 13.6%')
  })
})

describe('buildEbayCategorySearchText', () => {
  it('拼接非空类目文本，全空返回空串', () => {
    expect(buildEbayCategorySearchText(['A', '', null, 'B'])).toBe('A / B')
    expect(buildEbayCategorySearchText(['', null, undefined])).toBe('')
  })
})
