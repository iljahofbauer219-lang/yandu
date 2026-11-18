import { ebayPlatformFeeBreakdown } from './ebayPricingAutoFill'

export type EbayProfitCardsInput = {
  exchangeRate: number
  purchaseCostUsd: number
  logisticsCostUsd: number
  packagingCostCny: number
  fulfillmentCostCny: number
  otherCostCny: number
  salePriceUsd: number
  platformFeeRate: number
  salesTaxRate: number
  internationalShippingRate: number
  fixedFeeUsd: number
  promotionFeeRate: number
  returnLossRate: number
}

export type EbayProfitCards = {
  productCostUsd: number
  sellingCostUsd: number
  salePriceUsd: number
  grossProfitUsd: number
  platformFeesUsd: number
  promotionFeeUsd: number
  returnLossUsd: number
}

const positive = (value: number) => Math.max(0, Number(value) || 0)

/** 05 售价设定四卡美元利润链：产品成本=成本要素五项和；销售成本=平台与经营费率+推广佣金+退货预留（按销售价格基数）；毛利=销售价格−两者 */
export function computeEbayProfitCards(input: EbayProfitCardsInput): EbayProfitCards {
  const fx = Math.max(0.0001, positive(input.exchangeRate))
  const productCostUsd = positive(input.purchaseCostUsd) + positive(input.logisticsCostUsd)
    + (positive(input.packagingCostCny) + positive(input.fulfillmentCostCny) + positive(input.otherCostCny)) / fx
  const salePriceUsd = positive(input.salePriceUsd)
  const fees = ebayPlatformFeeBreakdown({
    salePrice: salePriceUsd,
    salesTaxRate: input.salesTaxRate,
    finalValueFeeRate: input.platformFeeRate,
    internationalShippingRate: input.internationalShippingRate,
    fixedFee: input.fixedFeeUsd
  })
  const promotionFeeUsd = salePriceUsd * positive(input.promotionFeeRate) / 100
  const returnLossUsd = salePriceUsd * positive(input.returnLossRate) / 100
  const sellingCostUsd = fees.totalFees + promotionFeeUsd + returnLossUsd
  return {
    productCostUsd,
    sellingCostUsd,
    salePriceUsd,
    grossProfitUsd: salePriceUsd - productCostUsd - sellingCostUsd,
    platformFeesUsd: fees.totalFees,
    promotionFeeUsd,
    returnLossUsd
  }
}