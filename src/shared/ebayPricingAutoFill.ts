/** eBay 售价设定的成本要素自动填充：把货盘/下载档案里的文本事实解析为美元口径取值 */

export type EbayUsdRange = { low: number; high: number }

/** 写入本地产品成本档案的自动填充凭据：既用于展示取值来源，也用于「填充一次后不再覆盖手改」 */
export type EbayProfitAutoFill = {
  at: string
  cnyPerUsd: number
  rateFetchedAt: string
  purchaseUsd: number
  purchaseSource: string
  logisticsUsd: number
  logisticsSource: string
  feeLabel: string
}

export type EbayLogisticsDerivation = { usd: number; source: string }

export type EbayCostAutoFillInput = {
  /** 货盘采购价文本，如 "$235.00" */
  priceText?: string | null
  /** 下载档案预估总额（含物流费），如 "$282.68 /件" */
  estimatedTotal?: string | null
  /** 货盘物流费文本，如 "$23.35 -$65.80 /件" */
  shippingFeeText?: string | null
  /** 外币→人民币汇率；<=0 表示未取到 */
  cnyPerUsd: number
}

export type EbayCostAutoFillResult = {
  purchaseUsd: number
  purchaseSource: string
  logisticsUsd: number
  logisticsSource: string
  /** 取数失败时给出中文全文原因，调用方据此提示并保持原值 */
  warnings: string[]
}

const roundCny = (value: number) => Math.round(value * 100) / 100

function moneyNumbers(text: string | null | undefined): number[] {
  const matches = String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []
  return matches.map(item => Number(item.replace(/,/g, ''))).filter(value => Number.isFinite(value) && value > 0)
}

/** 取文本中的第一个金额；无金额返回 0 */
export function parseEbayUsdAmount(text: string | null | undefined): number {
  return moneyNumbers(text)[0] || 0
}

/** 解析运费区间（"$23.35 -$65.80 /件" / "$20.63~$40.30 /件"）；单值时 low===high */
export function parseEbayUsdRange(text: string | null | undefined): EbayUsdRange | null {
  const numbers = moneyNumbers(text)
  if (!numbers.length) return null
  const [first, second] = numbers
  if (second === undefined) return { low: first, high: first }
  return { low: Math.min(first, second), high: Math.max(first, second) }
}

/** 物流费：优先用「预估总额 − 采购价」，落在运费区间外或无总额时回落到区间中值 */
export function deriveEbayLogisticsUsd(input: Pick<EbayCostAutoFillInput, 'priceText' | 'estimatedTotal' | 'shippingFeeText'>): EbayLogisticsDerivation | null {
  const purchaseUsd = parseEbayUsdAmount(input.priceText)
  const totalUsd = parseEbayUsdAmount(input.estimatedTotal)
  const range = parseEbayUsdRange(input.shippingFeeText)
  if (totalUsd > 0 && purchaseUsd > 0 && totalUsd >= purchaseUsd) {
    const delta = roundCny(totalUsd - purchaseUsd)
    const inRange = !range || (delta >= range.low - 0.01 && delta <= range.high + 0.01)
    if (inRange) return { usd: delta, source: `自动取自预估总额 $${totalUsd.toFixed(2)} − 采购价 $${purchaseUsd.toFixed(2)} = $${delta.toFixed(2)}` }
  }
  if (range) {
    const mid = roundCny((range.low + range.high) / 2)
    return { usd: mid, source: range.high > range.low ? `自动取自物流费区间 $${range.low.toFixed(2)}–$${range.high.toFixed(2)} 中值 $${mid.toFixed(2)}` : `自动取自物流费 $${range.low.toFixed(2)}` }
  }
  return null
}

export function deriveEbayCostAutoFill(input: EbayCostAutoFillInput): EbayCostAutoFillResult {
  const purchaseUsd = parseEbayUsdAmount(input.priceText)
  const logistics = deriveEbayLogisticsUsd(input)
  const rate = Number.isFinite(input.cnyPerUsd) && input.cnyPerUsd > 0 ? input.cnyPerUsd : 0
  const warnings: string[] = []
  if (purchaseUsd <= 0) warnings.push('未读取到该产品的货盘采购价，采购成本保持原值。')
  if (!logistics) warnings.push('未读取到该产品的物流费与预估总额，物流成本保持原值。')
  if (rate <= 0) warnings.push('最新汇率获取失败，核算汇率保持原值（美元成本仍按产品数据填入），可点「重试取最新汇率」再来一次。')
  return {
    purchaseUsd,
    purchaseSource: purchaseUsd > 0 ? `自动取自货盘采购价 $${purchaseUsd.toFixed(2)}` : '',
    logisticsUsd: logistics?.usd || 0,
    logisticsSource: logistics?.source || '',
    warnings
  }
}

/**
 * 旧「人民币口径」成本记录迁移为美元：
 * 未被手改过时直接用填充凭据里的美元原值；手改过或无凭据时按当时汇率反推；两者都没有则原样保留，交给用户核对。
 */
export function toEbayProfitCostUsd(legacyCny: number | null | undefined, autoUsd: number | null | undefined, cnyPerUsd: number | null | undefined): number {
  const cny = Number(legacyCny)
  const legacy = Number.isFinite(cny) && cny > 0 ? cny : 0
  const rate = Number(cnyPerUsd)
  const usableRate = Number.isFinite(rate) && rate > 0 ? rate : 0
  const usd = Number(autoUsd)
  if (Number.isFinite(usd) && usd > 0 && (!legacy || !usableRate || Math.abs(legacy - roundCny(usd * usableRate)) <= 0.02)) return roundCny(usd)
  if (legacy && usableRate) return roundCny(legacy / usableRate)
  return roundCny(legacy)
}

export type EbayPlatformFeeBreakdownInput = {
  /** 单件售价（与 fixedFee 同币种） */
  salePrice: number
  /** 代收销售税率（%）：eBay 代收代缴，不进卖家收入，只扩大计费基数 */
  salesTaxRate: number
  /** 最终成交费率（%） */
  finalValueFeeRate: number
  /** 国际运费费率（%）：跨境发货按计费基数收取 */
  internationalShippingRate: number
  /** 每单固定成交费（同币种） */
  fixedFee: number
}

export type EbayPlatformFeeBreakdown = {
  /** 计费基数 = 售价 + 代收销售税 */
  feeBase: number
  finalValueFee: number
  internationalShippingFee: number
  /** 商品总费用 = 成交费 + 国际运费 */
  goodsFeeTotal: number
  fixedFee: number
  totalFees: number
  /** 净收益 = 售价 − 总费用（不扣采购/物流，仅与后台结算页对账） */
  netProceeds: number
}

/** 与 eBay 后台结算页同口径拆解平台费用：计费基数含代收销售税，每行金额各自四舍五入到分 */
export function ebayPlatformFeeBreakdown(input: EbayPlatformFeeBreakdownInput): EbayPlatformFeeBreakdown {
  const sale = roundCny(Math.max(0, Number(input.salePrice) || 0))
  const feeBase = roundCny(sale * (1 + Math.max(0, Number(input.salesTaxRate) || 0) / 100))
  const finalValueFee = roundCny(feeBase * Math.max(0, Number(input.finalValueFeeRate) || 0) / 100)
  const internationalShippingFee = roundCny(feeBase * Math.max(0, Number(input.internationalShippingRate) || 0) / 100)
  const goodsFeeTotal = roundCny(finalValueFee + internationalShippingFee)
  const fixedFee = roundCny(Math.max(0, Number(input.fixedFee) || 0))
  const totalFees = roundCny(goodsFeeTotal + fixedFee)
  return { feeBase, finalValueFee, internationalShippingFee, goodsFeeTotal, fixedFee, totalFees, netProceeds: roundCny(sale - totalFees) }
}

type EbayFeeRule = { rate: number; label: string }
/**
 * eBay 美国站类目成交费率规则（2025-01 生效费率，来源 ebay.com/sellercenter 类目费表）。
 * 命中顺序即优先级；未命中回落通用 13.6%。
 */
export function ebayCategoryFeeRule(categoryNames: string | (string | null | undefined)[], salePrice: number): EbayFeeRule {
  const texts = (Array.isArray(categoryNames) ? categoryNames : [categoryNames]).map(item => String(item || '').trim()).filter(Boolean)
  const category = texts.join(' ').toLocaleLowerCase()
  if (/musical instruments|乐器/.test(category)) return { rate: 6.7, label: '乐器类目规则 6.7%' }
  if (/athletic shoes|sneaker|运动鞋|球鞋/.test(category) && salePrice >= 150) return { rate: 8, label: '高客单运动鞋规则 8%（售价 ≥ $150）' }
  if (/books|movies|music|书籍|电影|音乐|影音/.test(category)) return { rate: 15.3, label: '书籍、影音类目规则 15.3%' }
  if (/home & garden|home, garden|家居|园艺/.test(category)) return { rate: 12.7, label: '家居与园艺类目规则 12.7%（$2,500 以内，超出部分另计）' }
  if (/vehicle parts|auto parts|automotive|car seat|eBay Motors|motorcycle|汽配|汽车配件|汽车用品|汽车内饰|改装座椅|赛车座椅/.test(category)) {
    return { rate: 11.5, label: 'eBay 汽配件类目 11.5%（$1,000 以内，超出部分 2.35%）' }
  }
  return { rate: 13.6, label: texts[0] ? `${texts[0]} · 通用类目规则 13.6%` : 'eBay 美国站通用类目规则 13.6%' }
}

/** 把店铺类目路径与货盘三级类目拼成用于费率匹配的文本 */
export function buildEbayCategorySearchText(parts: (string | null | undefined)[]): string {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join(' / ')
}
