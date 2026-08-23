// 选品提取共享契约：提取卡完整展示 + 发送组装。
// 注意：buildSelectionInfoText 的行顺序须与主进程 BrowserWorkspace.ts 注入脚本的
// toPromptText 信息行保持一致（标题/价格/供应商/起订量/发货地/成交/规格属性/图片）。

import { estimateFbaFulfillmentFee } from './amazonScraper'

/** 提取后输入框预填的分析要求（完整版，用户可再编辑） */
export const SELECTION_ANALYSIS_REQUEST = '请帮我分析这款产品在亚马逊美国站是否有机会，按方法论文档输出完整评估报告。'

/** 利润字段的取值来源；数值和其可信度必须一起保存，禁止把临时 0 当成真实成本。 */
export type ProfitFieldEvidenceLevel = '事实' | '外部估算' | '分析假设' | '未知'
export type ProfitFieldOrigin = '自动提取' | '系统预设' | '用户修改' | '暂缺填零'
export type ProfitFieldKey =
  | 'purchaseCostUsd' | 'referralFeeRate' | 'fbaFulfillmentFeeUsd' | 'returnLossRate' | 'advertisingRate' | 'couponCostUsd'
  | 'packagingQcUsd.low' | 'packagingQcUsd.base' | 'packagingQcUsd.high'
  | 'domesticFreightUsd.low' | 'domesticFreightUsd.base' | 'domesticFreightUsd.high'
  | 'firstLegFreightUsd.low' | 'firstLegFreightUsd.base' | 'firstLegFreightUsd.high'
  | 'dutyUsd.low' | 'dutyUsd.base' | 'dutyUsd.high'
  | 'customsClearanceUsd.low' | 'customsClearanceUsd.base' | 'customsClearanceUsd.high'
  | 'inboundUsd.low' | 'inboundUsd.base' | 'inboundUsd.high'
  | 'storageUsd.low' | 'storageUsd.base' | 'storageUsd.high'
  | 'targetContributionMargin' | 'differentiationEvidence' | 'complianceIpEvidence'

export interface ProfitFieldMeta {
  origin: ProfitFieldOrigin
  evidenceLevel: ProfitFieldEvidenceLevel
  source: string
  updatedAt: string
  /** false 表示该值仅为待补项占位，不能支持正向入场结论。 */
  decisionEligible: boolean
  note?: string
}

export function userEditedProfitFieldMeta(): ProfitFieldMeta {
  return { origin: '用户修改', evidenceLevel: '分析假设', source: '用户录入', updatedAt: new Date().toISOString(), decisionEligible: true }
}

/** 从 1688 已提取的页面字段中确定性归集的供货事实；不做价格换汇或平台费用推断。 */
export interface ExtractedSupplyFacts {
  extractedAt: string
  purchasePriceCny?: { low: number; high: number; source: string }
  packagingDimensionsCm?: { length: number; width: number; height: number; source: string }
  grossWeightGrams?: { value: number; source: string }
  ingredientText?: string
  liquidRisk: boolean
  conflicts: string[]
}

export interface CnyUsdExchangeRate {
  /** 1 CNY 可兑换的 USD 数额。 */
  usdPerCny: number
  fetchedAt: string
  source: string
}

/**
 * 阶段 3 生成的 Amazon 费用候选值。它不是成交成本：阶段 4 才会把候选值写入可编辑表单，
 * 并保留每一个字段的来源和是否能作为入场结论依据。
 */
export interface AmazonFinancialPreset {
  generatedAt: string
  candidateCategory?: string
  categoryConfidence: '高' | '中' | '低'
  categoryBasis: string
  quickMarketProfit: NonNullable<ExtractedProductInfo['quickMarketProfit']>
  fullCostProfit: NonNullable<ExtractedProductInfo['fullCostProfit']>
  entryDecision: NonNullable<ExtractedProductInfo['entryDecision']>
  profitFieldMeta: Partial<Record<ProfitFieldKey, ProfitFieldMeta>>
  warnings: string[]
}

export interface ExtractedProductInfo {
  url?: string
  analysisDate?: string
  title?: string
  price?: string
  seller?: string
  moq?: string
  shipFrom?: string
  deals?: string
  attributes?: string[]
  images?: string[]
  imageEvidence?: Array<{ url: string; role: '主图' | '详情图'; source: string; alt?: string }>
  detailText?: string
  detailSource?: string
  imageOcrText?: string
  imageOcrWarnings?: string[]
  visualProductForm?: string
  visualUseMethod?: string
  visualTargetObject?: string
  visualConfidence?: number
  confirmedProductName?: string
  confirmedProductForm?: string
  confirmedUseMethod?: string
  confirmedTargetObject?: string
  identityResolutionNote?: string
  supplyFacts?: ExtractedSupplyFacts
  /** 仅供阶段 4 自动填表使用的候选值；不会覆盖既有用户录入。 */
  amazonFinancialPreset?: AmazonFinancialPreset
  quickMarketProfit?: {
    purchaseCostUsd?: number
    referralFeeRate?: number
    fbaFulfillmentFeeUsd?: number
    returnLossRate?: number
    advertisingRate?: number
    couponCostUsd?: number
  }
  fullCostProfit?: {
    packagingQcUsd?: { low?: number; base?: number; high?: number }
    domesticFreightUsd?: { low?: number; base?: number; high?: number }
    firstLegFreightUsd?: { low?: number; base?: number; high?: number }
    dutyUsd?: { low?: number; base?: number; high?: number }
    customsClearanceUsd?: { low?: number; base?: number; high?: number }
    inboundUsd?: { low?: number; base?: number; high?: number }
    storageUsd?: { low?: number; base?: number; high?: number }
  }
  entryDecision?: {
    targetContributionMargin?: number
    differentiationEvidence?: string
    complianceIpEvidence?: string
  }
  /** 经济模型与入场门禁字段的来源、等级和可决策状态；与数值分离以便后续自动填充/审计。 */
  profitFieldMeta?: Partial<Record<ProfitFieldKey, ProfitFieldMeta>>
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter(value => Number.isFinite(value)).map(value => Number(value.toFixed(4))))]
}

/**
 * 只解析商品页已抓取文字中的可追溯字段。多个尺寸/重量值不擅自选择，交由人工确认。
 * 该函数不换汇、不猜测类目/佣金，也不把未取得的成本写成零。
 */
export function extractSupplyFacts(info: ExtractedProductInfo): ExtractedSupplyFacts {
  const source = [info.detailText || '', ...(info.attributes || [])].join('\n')
  const facts: ExtractedSupplyFacts = { extractedAt: new Date().toISOString(), liquidRisk: /液体|精华|喷雾|乳液|洗液|清洁液|liquid|spray|serum/i.test(source), conflicts: [] }
  const priceValues = uniqueNumbers([...(info.price || '').matchAll(/(?:¥|￥|人民币|RMB)?\s*(\d+(?:\.\d+)?)(?:\s*元)?/gi)].map(match => Number(match[1])))
  if (priceValues.length === 1) facts.purchasePriceCny = { low: priceValues[0], high: priceValues[0], source: '1688 商品页价格' }
  else if (priceValues.length === 2) facts.purchasePriceCny = { low: Math.min(...priceValues), high: Math.max(...priceValues), source: '1688 商品页价格区间' }
  else if (priceValues.length > 2) facts.conflicts.push('页面价格存在多个候选值，未自动选择采购价')

  const dimensionMatches = [...source.matchAll(/(?:包装尺寸|外箱尺寸|单件(?:包装)?尺寸|产品尺寸)[^\n]{0,30}?(\d+(?:\.\d+)?)\s*(mm|cm|毫米|厘米)?\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|毫米|厘米)?\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|毫米|厘米)?/gi)]
    .map(match => {
      const toCm = (value: string, unit: string) => Number(value) * (/mm|毫米/i.test(unit) ? 0.1 : 1)
      return [toCm(match[1], match[2]), toCm(match[3], match[4]), toCm(match[5], match[6])]
    })
  const uniqueDimensions = [...new Map(dimensionMatches.map(value => [value.map(item => item.toFixed(3)).join('x'), value])).values()]
  if (uniqueDimensions.length === 1) {
    const [length, width, height] = uniqueDimensions[0]
    facts.packagingDimensionsCm = { length, width, height, source: '1688 商品页规格/详情' }
  } else if (uniqueDimensions.length > 1) facts.conflicts.push('页面存在多个包装尺寸，未自动选择 FBA 尺寸')

  const weightValues = uniqueNumbers([...source.matchAll(/(?:毛重|包装重量|单件重量)[^\n]{0,30}?(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克)/gi)].map(match => Number(match[1]) * (/kg|公斤|千克/i.test(match[2]) ? 1000 : 1)))
  if (weightValues.length === 1) facts.grossWeightGrams = { value: weightValues[0], source: '1688 商品页规格/详情' }
  else if (weightValues.length > 1) facts.conflicts.push('页面存在多个包装重量，未自动选择 FBA 重量')

  const ingredient = source.match(/(?:成分|配方|主要成分|ingredients?)\s*[：:]?\s*([^\n]{2,160})/i)?.[1]?.trim()
  if (ingredient) facts.ingredientText = ingredient
  return facts
}

/**
 * 用实时 CNY→USD 汇率将已经从 1688 提取的采购价换算为可编辑 USD 候选值。
 * 采购价区间使用上限，避免以低价误判毛利；已有采购价（尤其是用户修改）绝不覆盖。
 */
export function applyCnyPurchasePriceUsd(info: ExtractedProductInfo, exchange: CnyUsdExchangeRate | null | undefined): ExtractedProductInfo {
  const facts = info.supplyFacts || extractSupplyFacts(info)
  const purchase = facts.purchasePriceCny
  if (!purchase || !exchange || !Number.isFinite(exchange.usdPerCny) || exchange.usdPerCny <= 0 || info.quickMarketProfit?.purchaseCostUsd != null) return info
  const cny = purchase.high
  const usd = Number((cny * exchange.usdPerCny).toFixed(4))
  if (!Number.isFinite(usd) || usd <= 0) return info
  const source = `${purchase.source}：¥${purchase.low.toFixed(2)}${purchase.high !== purchase.low ? `–¥${purchase.high.toFixed(2)}` : ''}；按区间上限 ¥${cny.toFixed(2)} × CNY→USD ${exchange.usdPerCny.toFixed(6)}（${exchange.source}，${exchange.fetchedAt}）`
  return {
    ...info,
    supplyFacts: facts,
    quickMarketProfit: { ...info.quickMarketProfit, purchaseCostUsd: usd },
    profitFieldMeta: {
      ...info.profitFieldMeta,
      purchaseCostUsd: presetMeta('自动提取', '外部估算', source, true, '汇率会随结算日波动；本次按1688采购价区间上限换算，用户可修改为报价或实际成交成本')
    }
  }
}

function presetMeta(origin: ProfitFieldOrigin, evidenceLevel: ProfitFieldEvidenceLevel, source: string, decisionEligible: boolean, note?: string): ProfitFieldMeta {
  return { origin, evidenceLevel, source, decisionEligible, note, updatedAt: new Date().toISOString() }
}

/**
 * 基于已提取的商品身份生成可审计的 Amazon 美国站候选费率。
 * 这里不调用 FBA 费用计算器：Amazon 明确说明履约费随尺寸、重量等输入变化，未取得计算器
 * 结果时只能暂缺填零，绝不能当作实际费用。物流、关税、清关和入仓也同理。
 */
export function buildAmazonFinancialPreset(info: ExtractedProductInfo): AmazonFinancialPreset {
  const facts = info.supplyFacts || extractSupplyFacts(info)
  const sourceText = [info.confirmedProductName || '', info.title || '', info.confirmedProductForm || '', info.visualProductForm || '', info.detailText || '', ...(info.attributes || [])].join('\n')
  const isPet = /宠物|猫狗|犬猫|dog|cat|pet/i.test(sourceText)
  const isVeterinaryDiet = /处方粮|兽医处方|veterinary\s+diet/i.test(sourceText)
  const candidateCategory = isPet ? 'Pet Supplies（候选）' : undefined
  const categoryBasis = isPet
    ? `商品身份/页面文字含宠物用途${facts.liquidRisk ? '，且为液体/喷雾形态' : ''}`
    : '未能从已提取商品信息确定 Amazon 候选类目'
  const warnings: string[] = []
  if (!candidateCategory) warnings.push('候选类目未确定，未预设 Amazon 佣金')
  if (isVeterinaryDiet) warnings.push('检测到兽医处方饮食相关描述，Pet Supplies 佣金例外为 22%，必须人工确认类目')
  if (!facts.packagingDimensionsCm || !facts.grossWeightGrams) warnings.push('缺少唯一包装尺寸或毛重，FBA 履约费只能暂缺填零，不能用于正向入场结论')

  const fbaEstimate = (facts.grossWeightGrams?.value && facts.packagingDimensionsCm)
    ? estimateFbaFulfillmentFee({
        weightGrams: facts.grossWeightGrams.value,
        dimensionsCm: { length: facts.packagingDimensionsCm.length, width: facts.packagingDimensionsCm.width, height: facts.packagingDimensionsCm.height }
      })
    : null
  const fbaFee = fbaEstimate?.feeUsd ?? 0
  const quickMarketProfit: NonNullable<ExtractedProductInfo['quickMarketProfit']> = {
    ...(candidateCategory && !isVeterinaryDiet ? { referralFeeRate: 15 } : {}),
    returnLossRate: facts.liquidRisk ? 5 : 3,
    advertisingRate: 10,
    couponCostUsd: 5,
    fbaFulfillmentFeeUsd: fbaFee
  }
  const zeroRange = { low: 0, base: 0, high: 0 }
  const fullCostProfit: NonNullable<ExtractedProductInfo['fullCostProfit']> = {
    packagingQcUsd: { ...zeroRange },
    domesticFreightUsd: { ...zeroRange },
    firstLegFreightUsd: { ...zeroRange },
    dutyUsd: { ...zeroRange },
    customsClearanceUsd: { ...zeroRange },
    inboundUsd: { ...zeroRange },
    storageUsd: { ...zeroRange }
  }
  const differentiationEvidence = [
    info.confirmedProductForm || info.visualProductForm ? `形态：${info.confirmedProductForm || info.visualProductForm}` : '',
    facts.ingredientText ? `页面成分：${facts.ingredientText}` : '',
    info.confirmedUseMethod || info.visualUseMethod ? `使用方式：${info.confirmedUseMethod || info.visualUseMethod}` : ''
  ].filter(Boolean).join('；')
  const complianceIpEvidence = [
    facts.ingredientText ? `页面成分/配方：${facts.ingredientText}` : '',
    facts.liquidRisk ? '液体/喷雾形态：需核验运输、标签及适用监管要求' : ''
  ].filter(Boolean).join('；')
  const entryDecision: NonNullable<ExtractedProductInfo['entryDecision']> = {
    targetContributionMargin: 20,
    ...(differentiationEvidence ? { differentiationEvidence } : {}),
    ...(complianceIpEvidence ? { complianceIpEvidence } : {})
  }
  const meta: AmazonFinancialPreset['profitFieldMeta'] = {
    referralFeeRate: candidateCategory && !isVeterinaryDiet
      ? presetMeta('系统预设', '事实', 'Amazon US 标准销售费率：https://sell.amazon.com/pricing?mons_sel_locale=en_US（Pet Supplies 15%，兽医处方饮食例外 22%）', false, '候选类目，须以实际 listing 类目确认')
      : presetMeta('暂缺填零', '未知', '候选类目未确认', false),
    fbaFulfillmentFeeUsd: fbaEstimate?.feeUsd != null
      ? presetMeta('系统预设', '外部估算', fbaEstimate.source, true, fbaEstimate.warnings.join('；') || undefined)
      : presetMeta('暂缺填零', '未知', '待接入 Amazon Revenue Calculator（尺寸、重量、类目、售价）', false),
    returnLossRate: presetMeta('系统预设', '分析假设', facts.liquidRisk ? '液体/喷雾风险预设 5%' : '非液体产品风险预设 3%', false, '需以类目/历史退货数据或用户确认替换'),
    advertisingRate: presetMeta('系统预设', '分析假设', '用户指定默认广告费率 10%', true),
    couponCostUsd: presetMeta('系统预设', '分析假设', '用户指定默认优惠券 $5', true),
    targetContributionMargin: presetMeta('系统预设', '分析假设', '用户指定目标贡献利润率 20%', true),
    differentiationEvidence: presetMeta('自动提取', differentiationEvidence ? '事实' : '未知', differentiationEvidence ? '1688 商品页标题/属性/详情' : '未提取到可用差异化线索', false, '仅供人工核验，不代表已完成差异化验证'),
    complianceIpEvidence: presetMeta('自动提取', complianceIpEvidence ? '事实' : '未知', complianceIpEvidence ? '1688 商品页属性/详情' : '未提取到合规/IP线索', false, '仅供人工核验，不代表合规或 IP 已通过')
  }
  ;(['packagingQcUsd', 'domesticFreightUsd', 'firstLegFreightUsd', 'dutyUsd', 'customsClearanceUsd', 'inboundUsd', 'storageUsd'] as const).forEach(field => {
    ;(['low', 'base', 'high'] as const).forEach(range => {
      const key = `${field}.${range}` as ProfitFieldKey
      meta[key] = presetMeta('暂缺填零', '未知', '待货代/报关/仓储报价或实际账单', false, '暂缺填零不可按真实成本参与正向入场结论')
    })
  })
  return {
    generatedAt: new Date().toISOString(),
    candidateCategory,
    categoryConfidence: candidateCategory ? '中' : '低',
    categoryBasis,
    quickMarketProfit,
    fullCostProfit,
    entryDecision,
    profitFieldMeta: meta,
    warnings
  }
}

/**
 * 将阶段 3 候选值安全映射到编辑表单。只填空字段，绝不覆盖已有数字、文本或其人工来源。
 * 这使旧会话也能获得预填，同时不会破坏用户此前已确认或修改的成本。
 */
export function applyAmazonFinancialPreset(info: ExtractedProductInfo): ExtractedProductInfo {
  const preset = info.amazonFinancialPreset || buildAmazonFinancialPreset(info)
  const currentQuick = info.quickMarketProfit || {}
  const currentFull = info.fullCostProfit || {}
  const currentEntry = info.entryDecision || {}
  const currentMeta = info.profitFieldMeta || {}
  const quickMarketProfit = { ...preset.quickMarketProfit, ...currentQuick }
  const fullCostProfit: NonNullable<ExtractedProductInfo['fullCostProfit']> = {}
  ;(['packagingQcUsd', 'domesticFreightUsd', 'firstLegFreightUsd', 'dutyUsd', 'customsClearanceUsd', 'inboundUsd', 'storageUsd'] as const).forEach(field => {
    fullCostProfit[field] = { ...(preset.fullCostProfit[field] || {}), ...(currentFull[field] || {}) }
  })
  const entryDecision = { ...preset.entryDecision, ...currentEntry }
  const profitFieldMeta: Partial<Record<ProfitFieldKey, ProfitFieldMeta>> = { ...preset.profitFieldMeta, ...currentMeta }
  return { ...info, amazonFinancialPreset: preset, quickMarketProfit, fullCostProfit, entryDecision, profitFieldMeta }
}

export type ExtractionEvidenceLevel = 'COMPLETE' | 'NEEDS_REVIEW' | 'INSUFFICIENT'

export interface ExtractionEvidenceAssessment {
  level: ExtractionEvidenceLevel
  label: '证据完整' | '需人工核对' | '证据不足'
  hasTitle: boolean
  hasDetail: boolean
  imageCount: number
  hasOcr: boolean
  hasReliableVisual: boolean
  missing: string[]
  warnings: string[]
  conflicts: string[]
}

const FORM_PATTERNS: Array<{ form: string; pattern: RegExp }> = [
  { form: '液体精华', pattern: /液体精华|擦浴精华|免洗精华|scrub essence|wash[- ]?free essence/i },
  { form: '湿巾', pattern: /预浸湿巾|宠物湿巾|清洁湿巾|pet wipes|grooming wipes/i },
  { form: '泡沫', pattern: /清洁泡沫|泡沫清洁|cleansing foam|cleaning foam/i },
  { form: '喷雾', pattern: /清洁喷雾|除臭喷雾|grooming spray|cleaning spray/i },
  { form: '膏体', pattern: /膏体|软膏|cream|ointment/i },
  { form: '粉末', pattern: /粉末|powder/i },
  { form: '固体', pattern: /固体|香皂|soap bar/i }
]

function canonicalProductForm(value: string): string {
  const match = FORM_PATTERNS.find(item => item.pattern.test(value))
  return match?.form || (/湿巾|wipes/i.test(value) ? '湿巾' : value.trim())
}

function withoutNegatedWipeMentions(value: string): string {
  return value
    .replace(/(?:不是|并非|而非|非|不属于|区别于|替代)\s*(?:宠物)?(?:预浸)?湿巾/gi, '')
    .replace(/\b(?:not|rather\s+than|unlike)\s+(?:pet\s+|grooming\s+|pre[- ]?moistened\s+)?wipes?\b/gi, '')
}

function formsInText(value: string): string[] {
  if (!value) return []
  const withoutNegatedWipes = withoutNegatedWipeMentions(value)
  return FORM_PATTERNS.filter(item => item.pattern.test(withoutNegatedWipes)).map(item => item.form)
}

/** 统一评估提取证据覆盖率；标题不能单独构成可靠商品身份。 */
export function assessExtractionEvidence(info: ExtractedProductInfo): ExtractionEvidenceAssessment {
  const hasTitle = Boolean(info.title?.trim())
  const hasDetail = Boolean(info.detailText?.trim())
  const imageCount = Array.isArray(info.images) ? info.images.filter(Boolean).length : 0
  const hasOcr = Boolean(info.imageOcrText?.trim())
  const visualForm = canonicalProductForm(info.visualProductForm || '')
  const hasReliableVisual = Boolean(visualForm && visualForm !== '无法判断' && Number(info.visualConfidence || 0) >= 70)
  const warnings = [...new Set((info.imageOcrWarnings || []).map(item => String(item).trim()).filter(Boolean))]
  const sources = [
    { name: '标题', forms: formsInText(info.title || '') },
    { name: '详情页文字', forms: formsInText(info.detailText || '') },
    { name: '图片OCR', forms: formsInText(info.imageOcrText || '') }
  ].filter(source => source.forms.length)
  const anchor = hasReliableVisual ? visualForm : (sources.find(source => source.name === '图片OCR')?.forms[0] || sources[0]?.forms[0] || '')
  const conflicts = sources.flatMap(source => {
    if (!anchor || source.forms.includes(anchor)) return []
    return [`${source.name}指向“${source.forms.join('/')}”，与${hasReliableVisual ? `图片视觉“${visualForm}”` : `其他证据“${anchor}”`}冲突`]
  })
  const missing: string[] = []
  if (!hasTitle) missing.push('商品标题')
  if (!hasDetail) missing.push('详情页文字')
  if (!imageCount) missing.push('商品图片')
  if (!hasOcr) missing.push('包装图片OCR')
  if (!hasReliableVisual) missing.push('可靠视觉形态')
  const level: ExtractionEvidenceLevel = !hasTitle || (!hasDetail && !hasOcr && !hasReliableVisual)
    ? 'INSUFFICIENT'
    : missing.length || warnings.length || conflicts.length
      ? 'NEEDS_REVIEW'
      : 'COMPLETE'
  return {
    level,
    label: level === 'COMPLETE' ? '证据完整' : level === 'NEEDS_REVIEW' ? '需人工核对' : '证据不足',
    hasTitle,
    hasDetail,
    imageCount,
    hasOcr,
    hasReliableVisual,
    missing,
    warnings,
    conflicts: [...new Set(conflicts)]
  }
}

/** 平台名实时联动：替换要求文本「在 XX」处的平台名（含中文「亚马逊」），站点部分不动由用户人工编辑；无匹配时原样返回 */
export const PLATFORM_TEXT_RE = /(在\s*)(亚马逊|Amazon|eBay|Ozon|Temu|TikTok|eMAG|Lazada)/
export function applyPlatformToRequest(text: string, platform: string): string {
  const target = !platform || platform === 'Amazon' ? '亚马逊' : platform
  return PLATFORM_TEXT_RE.test(text) ? text.replace(PLATFORM_TEXT_RE, (_m, prefix: string) => prefix + target) : text
}

/** 组装「完整商品信息」文本块（不含分析要求；要求由渲染层发送时追加） */
export function buildSelectionInfoText(info: ExtractedProductInfo): string {
  const lines = ['我在1688看到一款商品，商品信息如下：']
  if (info.url) lines.push('- 1688商品URL：' + info.url)
  if (info.analysisDate) lines.push('- 分析日期：' + info.analysisDate)
  if (info.title) lines.push('- 标题：' + info.title)
  if (info.price) lines.push('- 价格：' + info.price)
  if (info.seller) lines.push('- 供应商/店铺：' + info.seller)
  if (info.moq) lines.push('- 起订量：' + info.moq)
  if (info.shipFrom) lines.push('- 发货地：' + info.shipFrom)
  if (info.deals) lines.push('- 成交：' + info.deals + ' 件')
  if (info.attributes && info.attributes.length) {
    lines.push('- 规格属性：\n' + info.attributes.map(item => '  * ' + item).join('\n'))
  }
  if (info.images && info.images.length) lines.push('- 图片：' + info.images.length + ' 张')
  if (info.imageEvidence && info.imageEvidence.length) {
    lines.push('- 商品图片证据：\n' + info.imageEvidence.map((item, index) => `  * 图${index + 1}｜${item.role}｜${item.source}｜${item.url}`).join('\n'))
  }
  if (info.detailText) lines.push('- 详情页文字（页面DOM）：\n' + info.detailText)
  if (info.imageOcrText) lines.push('- 包装图片OCR文字（图片来源）：\n' + info.imageOcrText)
  if (info.imageOcrWarnings && info.imageOcrWarnings.length) lines.push('- 图片OCR核验提示：' + info.imageOcrWarnings.join('；'))
  if (info.visualProductForm || info.visualUseMethod || info.visualTargetObject) lines.push(`- 图片视觉识别（置信度${info.visualConfidence ?? 0}%）：形态=${info.visualProductForm || '无法判断'}；用途=${info.visualUseMethod || '无法判断'}；适用对象=${info.visualTargetObject || '无法判断'}`)
  if (info.confirmedProductForm) lines.push(`- 人工身份裁决：产品=${info.confirmedProductName || info.title || '待命名产品'}；形态=${info.confirmedProductForm}；用途=${info.confirmedUseMethod || '待确认'}；适用对象=${info.confirmedTargetObject || '待确认'}${info.identityResolutionNote ? `；说明=${info.identityResolutionNote}` : ''}`)
  if (lines.length > 1) {
    const evidence = assessExtractionEvidence(info)
    lines.push(`- 提取证据状态：${evidence.label}`)
    if (evidence.missing.length) lines.push('- 缺失证据：' + evidence.missing.join('、'))
    if (evidence.conflicts.length) lines.push('- 商品身份冲突：' + evidence.conflicts.join('；'))
  }
  return lines.join('\n')
}

/** 本品事实锁：市场样本只能作为竞品参照，不得改写本品形态和用途。 */
export function buildProductIdentityLock(info: ExtractedProductInfo): string {
  const evidence = assessExtractionEvidence(info)
  const manuallyResolved = Boolean(info.confirmedProductForm?.trim())
  const productName = info.confirmedProductName || info.title || '待命名产品'
  const form = manuallyResolved ? String(info.confirmedProductForm) : evidence.hasReliableVisual ? (info.visualProductForm || '待确认') : '待人工确认'
  const useMethod = manuallyResolved ? (info.confirmedUseMethod || '待确认') : (info.visualUseMethod || '待确认')
  const target = manuallyResolved ? (info.confirmedTargetObject || '待确认') : (info.visualTargetObject || '待确认')
  const blocked = form === '液体精华'
    ? '宠物湿巾、预浸湿巾、pet wipes、grooming wipes、纸巾或擦拭巾'
    : '不得用任何竞品名称替换本品身份'
  return [
    '【本品身份锁｜最高优先级】',
    `本次唯一分析对象：${productName}`,
    `产品形态：${form}${manuallyResolved ? '（人工裁决已锁定）' : `（图片视觉识别置信度：${info.visualConfidence ?? 0}%）`}`,
    `使用方式：${useMethod}`,
    `适用对象：${target}`,
    `提取证据状态：${evidence.label}${evidence.missing.length ? `（缺失：${evidence.missing.join('、')}）` : ''}`,
    ...(evidence.conflicts.length ? [`身份冲突：${evidence.conflicts.join('；')}，必须人工确认后才能作为本品事实。`] : []),
    `禁止将本品改写、归类或替换为：${blocked}`,
    '以下 Amazon 市场样本只能用于竞品/替代竞品参照，不得回填到“本品数据”、本品标题或本品类目。',
    '若标题、详情、OCR与图片识别冲突，必须保留冲突并标记待人工确认，不得自行选择竞品形态。'
  ].join('\n')
}

export function validateSelectionReportIdentity(content: string, info: ExtractedProductInfo): string[] {
  const issues: string[] = []
  const firstPart = content.split(/\n##\s*第二部分/)[0]
  const expectedForm = info.confirmedProductForm || (Number(info.visualConfidence || 0) >= 70 ? (info.visualProductForm || '') : '')
  if (expectedForm === '液体精华' && /湿巾|预浸湿巾|pet wipes|grooming wipes/i.test(withoutNegatedWipeMentions(firstPart))) {
    issues.push(`本品${info.confirmedProductForm ? '人工确认锁定' : '视觉识别'}为液体精华，但报告第一部分出现宠物湿巾/预浸湿巾形态`)
  }
  const productName = reportProductName(firstPart)
  if (productName !== '待命名产品' && /湿巾|wipes/i.test(productName) && !/湿巾|wipes/i.test(info.title || '')) {
    issues.push(`报告本品名称“${productName}”与当前商品标题不一致`)
  }
  return issues
}

function hasKnownPackagingDimensions(info: ExtractedProductInfo): boolean {
  const source = [info.detailText, ...(info.attributes || [])].filter(Boolean).join('\n')
  return /(?:包装尺寸|外箱尺寸|单件(?:包装)?尺寸|产品尺寸)[^\n]{0,40}\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)?\s*[×xX*]\s*\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)?\s*[×xX*]\s*\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)/i.test(source)
}

function hasKnownGrossWeight(info: ExtractedProductInfo): boolean {
  const source = [info.detailText, ...(info.attributes || [])].filter(Boolean).join('\n')
  return /(?:毛重|包装重量|单件重量)[^\n]{0,30}\d+(?:\.\d+)?\s*(?:kg|公斤|千克|g|克)(?:\s|$|[，,；;])/i.test(source)
}

function selectedPositiveDecision(content: string): boolean {
  return content.split(/\n+/).some(line => {
    if (!/(?:✅\s*建议入场|⚠️\s*有条件谨慎入场)/.test(line)) return false
    return !line.trim().startsWith('|') || /\|\s*(?:是|选中|✓|✅)\s*\|/.test(line)
  })
}

function markdownCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || trimmed.indexOf('|', 1) < 0) return null
  const body = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1)
  return body.split('|').map(cell => cell.trim())
}

const COMPLIANCE_TERM = /(?:FDA|EPA|专利|认证)/i
const COMPLIANCE_CERTAINTY = /(?:必须|硬门槛|需(?:办理|备案|注册)|无(?:侵权|IP)风险|专利保护|专利技术|专利投诉|认证通过|(?:FDA|EPA)新规|政策收紧)/i
const COMPLIANCE_COST_OR_TIME = /(?:\$\s*\d|\d+\s*(?:周|天|月))/i
const COMPLIANCE_ROW_LABEL = /^(?:合规|知识产权|海外资质|平台规则|海关要求|行业壁垒|准入维度|核查项)$/i

function unsupportedComplianceLine(line: string): boolean {
  if (!COMPLIANCE_TERM.test(line) || /(?:仅列核验任务|不得判断|无法判断)/i.test(line)) return false
  const cells = markdownCells(line)
  if (!cells) return COMPLIANCE_CERTAINTY.test(line) || COMPLIANCE_COST_OR_TIME.test(line)
  if (cells.some(cell => COMPLIANCE_TERM.test(cell) && (COMPLIANCE_CERTAINTY.test(cell) || COMPLIANCE_COST_OR_TIME.test(cell)))) return true
  const dedicatedRow = cells.slice(0, 2).some(cell => COMPLIANCE_ROW_LABEL.test(cell))
  return dedicatedRow && cells.some(cell => COMPLIANCE_TERM.test(cell)) && cells.some(cell => COMPLIANCE_COST_OR_TIME.test(cell))
}

function markdownScenarioValues(content: string, label: RegExp): number[] | null {
  const line = content.split(/\n+/).find(item => {
    const cells = item.split('|').map(cell => cell.trim()).filter(Boolean)
    return cells.length >= 4 && label.test(cells[0])
  })
  if (!line) return null
  const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
  const values = cells.slice(1, 4).map(cell => {
    const match = cell.replace(/,/g, '').match(/(-?)\s*\$\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s*(?:USD|美元)/i)
    if (!match) return Number.NaN
    return match[3] ? Number(match[3]) : Number(`${match[1] || ''}${match[2]}`)
  })
  return values.every(Number.isFinite) ? values : null
}

/**
 * 正式报告证据与计算门禁：只核验当前系统实际拥有的数据，避免模型用常识、估算或竞品事实
 * 补写本品参数。未知值允许保留为“待验证”，但不得据此输出正向入场结论。
 */
export function validateSelectionReportEvidence(content: string, info: ExtractedProductInfo): string[] {
  const issues: string[] = []
  const lines = content.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const dimensionsKnown = hasKnownPackagingDimensions(info)
  const grossWeightKnown = hasKnownGrossWeight(info)

  if (selectedPositiveDecision(content) && (!dimensionsKnown || !grossWeightKnown)) {
    const missing = [!dimensionsKnown ? '包装尺寸' : '', !grossWeightKnown ? '毛重' : ''].filter(Boolean).join('、')
    issues.push(`本品缺少${missing}，FBA费用和贡献利润不可复算，最终结论必须为“❓ 数据不足，不能判定”`)
  }

  const unsupportedReview = lines.find(line => /(?:高频好评|高频差评|差评提及|评论原文|用户评论称|review\s+quote)/i.test(line)
    && /(?:“[^”]{2,}”|"[^"]{2,}"|泵头|喷头|香味|温和|刺激|容量|价格|方便|有效|持久|漏液|用量难控)/i.test(line))
  if (unsupportedReview) issues.push(`系统未抓取评论正文，但报告生成了评论洞察或引语：${unsupportedReview.slice(0, 100)}`)

  const unsupportedHts = lines.find(line => /\bHTS(?:US)?\s*\d{4}(?:\.\d{2,4})+/i.test(line))
  if (unsupportedHts) issues.push(`系统未核验海关编码，但报告给出了具体 HTS 编码：${unsupportedHts.slice(0, 100)}`)
  const unsupportedCompliance = lines.find(unsupportedComplianceLine)
  if (unsupportedCompliance) issues.push(`系统未完成合规或知识产权核验，但报告输出了确定性要求、成本或结论：${unsupportedCompliance.slice(0, 100)}`)
  const unsupportedFeeSimulation = lines.find(line => /(?:FBA\s*计算器|FBA\s*calculator).*(?:模拟|测算|结果)/i.test(line))
  if ((!dimensionsKnown || !grossWeightKnown) && unsupportedFeeSimulation) {
    issues.push(`缺少包装尺寸或毛重，报告不得声称已完成 FBA 计算器模拟：${unsupportedFeeSimulation.slice(0, 100)}`)
  }

  const revenue = markdownScenarioValues(content, /实收销售收入/)
  const purchase = markdownScenarioValues(content, /采购\+包装\+质检成本/)
  const inbound = markdownScenarioValues(content, /国内物流\+头程\+关税清关/)
  const fba = markdownScenarioValues(content, /FBA入仓\+仓储\+履约/i)
  const commission = markdownScenarioValues(content, /平台佣金\/交易费/)
  const advertising = markdownScenarioValues(content, /广告\/优惠券/)
  const returns = markdownScenarioValues(content, /退货\/残损\/售后/)
  const total = markdownScenarioValues(content, /单件综合总成本/)
  const gross = markdownScenarioValues(content, /毛利润\/毛利率/)
  const contribution = markdownScenarioValues(content, /贡献利润\/贡献毛利率/)
  const rows = [revenue, purchase, inbound, fba, commission, advertising, returns, total, gross, contribution]
  if (rows.every((row): row is number[] => Boolean(row))) {
    const tolerance = 0.08
    for (let index = 0; index < 3; index += 1) {
      const expectedTotal = purchase![index] + inbound![index] + fba![index] + commission![index] + advertising![index] + returns![index]
      const expectedGross = revenue![index] - purchase![index] - inbound![index]
      const expectedContribution = revenue![index] - total![index]
      const scenario = ['悲观', '基准', '乐观'][index]
      if (Math.abs(total![index] - expectedTotal) > tolerance) issues.push(`${scenario}情景单件综合总成本计算错误：应为 $${expectedTotal.toFixed(2)}，报告为 $${total![index].toFixed(2)}`)
      if (Math.abs(gross![index] - expectedGross) > tolerance) issues.push(`${scenario}情景毛利润计算错误：应按收入减采购及头程为 $${expectedGross.toFixed(2)}，报告为 $${gross![index].toFixed(2)}`)
      if (Math.abs(contribution![index] - expectedContribution) > tolerance) issues.push(`${scenario}情景贡献利润计算错误：广告已含在综合总成本中，不得重复扣除；应为 $${expectedContribution.toFixed(2)}，报告为 $${contribution![index].toFixed(2)}`)
    }
  }
  return [...new Set(issues)]
}

/**
 * 对两轮模型修正后仍存在的无来源字段做透明降级，不生成新事实：相关单元格统一改为“待验证”，
 * 缺少 FBA 关键输入时强制选择“数据不足”。
 */
export function sanitizeSelectionReportEvidence(content: string, info: ExtractedProductInfo, targetPlatform?: string): string {
  const dimensionsKnown = hasKnownPackagingDimensions(info)
  const grossWeightKnown = hasKnownGrossWeight(info)
  const lines = content.split('\n')
  let hasCorrection = false
  let hasDataInsufficientRow = false
  let inFirstPart = true
  const lockedLiquidForm = (info.confirmedProductForm || (Number(info.visualConfidence || 0) >= 70 ? info.visualProductForm : '')) === '液体精华'

  const redactAfter = (line: string, pattern: RegExp, includeMatchedCell = false): string => {
    const cells = markdownCells(line)
    if (!cells) return line
    const matched = cells.findIndex(cell => pattern.test(cell))
    if (matched < 0) return line
    const start = includeMatchedCell ? matched : matched + 1
    for (let index = start; index < cells.length; index += 1) cells[index] = '待验证'
    hasCorrection = true
    return `| ${cells.join(' | ')} |`
  }

  const sanitized = lines.map(line => {
    const trimmed = line.trim()
    if (/^##\s*第二部分/.test(trimmed)) inFirstPart = false
    if (inFirstPart && lockedLiquidForm && /湿巾|预浸湿巾|pet wipes|grooming wipes/i.test(withoutNegatedWipeMentions(trimmed))) {
      hasCorrection = true
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.slice(1, -1).split('|').map(cell => cell.trim())
        return `| ${cells.map(cell => /湿巾|预浸湿巾|pet wipes|grooming wipes/i.test(withoutNegatedWipeMentions(cell)) ? '液体精华（人工确认锁定）' : cell).join(' | ')} |`
      }
      if (/^#\s+/.test(trimmed)) return `# ${info.confirmedProductName || '宠物免洗擦浴精华'} · ${reportPlatform(targetPlatform || content)}选品分析报告`
      return '- 产品形态：液体精华（人工确认锁定）；本品不是预浸湿巾。'
    }
    if (/❓\s*数据不足，?不能判定/.test(trimmed) && trimmed.startsWith('|')) {
      hasDataInsufficientRow = true
      if ((!dimensionsKnown || !grossWeightKnown) && /\|\s*(?:否|未选中|—|-|待定)\s*\|/.test(trimmed)) {
        hasCorrection = true
        return line.replace(/\|\s*(?:否|未选中|—|-|待定)\s*\|/, '| 是 |')
      }
    }
    if ((!dimensionsKnown || !grossWeightKnown) && /(?:✅\s*建议入场|⚠️\s*有条件谨慎入场)/.test(trimmed)) {
      hasCorrection = true
      if (trimmed.startsWith('|')) return line.replace(/\|\s*(?:是|选中|✓|✅)\s*\|/, '| 否 |')
      return line.replace(/(?:✅\s*建议入场|⚠️\s*有条件谨慎入场)/, '❓ 数据不足，不能判定')
    }
    if (markdownCells(trimmed)) {
      if (/(?:高频好评|高频差评|差评提及|评论原文|用户评论称)/i.test(trimmed)) return redactAfter(line, /(?:高频好评|高频差评|差评提及|评论原文|用户评论称)/i)
      if (/\bHTS(?:US)?\s*\d{4}(?:\.\d{2,4})+/i.test(trimmed)) return redactAfter(line, /\bHTS(?:US)?\s*\d{4}(?:\.\d{2,4})+/i, true)
      if (unsupportedComplianceLine(trimmed)) {
        const cells = markdownCells(trimmed) || []
        const dedicatedRow = cells.slice(0, 2).some(cell => COMPLIANCE_ROW_LABEL.test(cell))
        const risky = cells.flatMap((cell, index) => COMPLIANCE_TERM.test(cell) && (COMPLIANCE_CERTAINTY.test(cell) || COMPLIANCE_COST_OR_TIME.test(cell)) ? [index] : [])
        const first = risky[0] ?? cells.findIndex(cell => COMPLIANCE_TERM.test(cell))
        if (first >= 0) {
          if (dedicatedRow) {
            for (let index = first; index < cells.length; index += 1) cells[index] = '待验证'
          } else {
            risky.forEach(index => { cells[index] = '待验证' })
          }
          hasCorrection = true
          return `| ${cells.join(' | ')} |`
        }
      }
      if ((!dimensionsKnown || !grossWeightKnown) && /(?:FBA入仓\+仓储\+履约|单件综合总成本|贡献利润\/贡献毛利率|最低可行售价|盈亏平衡ACOS)/i.test(trimmed)) {
        return redactAfter(line, /(?:FBA入仓\+仓储\+履约|单件综合总成本|贡献利润\/贡献毛利率|最低可行售价|盈亏平衡ACOS)/i)
      }
      if ((!dimensionsKnown || !grossWeightKnown) && /(?:FBA\s*计算器|FBA\s*calculator)/i.test(trimmed)) return redactAfter(line, /(?:FBA\s*计算器|FBA\s*calculator)/i, true)
      return line
    }
    if (/(?:高频好评|高频差评|差评提及|评论原文|用户评论称)/i.test(trimmed) && /(?:“[^”]{2,}”|"[^"]{2,}")/.test(trimmed)) {
      hasCorrection = true
      return '- 评论正文未抓取，评论洞察待验证。'
    }
    if (/\bHTS(?:US)?\s*\d{4}(?:\.\d{2,4})+/i.test(trimmed)) {
      hasCorrection = true
      return '- HTS 编码尚未通过官方工具核验，待验证。'
    }
    if (unsupportedComplianceLine(trimmed)) {
      hasCorrection = true
      return '- 合规与知识产权尚未完成权威核验，相关要求、成本、周期和结论均待验证。'
    }
    return line
  })

  if ((!dimensionsKnown || !grossWeightKnown) && !hasDataInsufficientRow && !sanitized.some(line => /❓\s*数据不足，?不能判定/.test(line))) {
    sanitized.push('', '❓ 数据不足，不能判定')
    hasCorrection = true
  }
  const correctionMarker = '> 系统质量修正：未抓取或无法复算的字段已降级为“待验证”；未新增任何事实。'
  if (hasCorrection && !sanitized.includes(correctionMarker)) sanitized.push('', correctionMarker)
  let correctionMarkerSeen = false
  return sanitized.filter(line => {
    if (line !== correctionMarker) return true
    if (correctionMarkerSeen) return false
    correctionMarkerSeen = true
    return true
  }).join('\n')
}

/** 报告生成前门禁：证据未确认或冲突未裁决时，不得请求模型生成正式报告。 */
export function selectionGenerationGate(info: ExtractedProductInfo | null, confirmed: boolean): string {
  if (!info) return ''
  if (!confirmed) return '生成报告前必须先确认并锁定本品身份。'
  const evidence = assessExtractionEvidence(info)
  if (evidence.level !== 'COMPLETE' && !info.confirmedProductForm?.trim()) {
    return '当前商品存在证据冲突或证据不足，请完成人工身份裁决后再生成报告。'
  }
  return ''
}

// ─── 选品报告标题归一：产品名优先取当前报告正文、回退触发本次报告的提问，禁止拼接整段会话历史（避免同会话旧产品名覆盖新报告标题） ───

export function reportProductName(text: string): string {
  const match = text.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:商品名称|产品名称|商品标题|标题)(?:\*\*)?\s*[：:]\s*([^\n]+)/i)
  if (!match) return '待命名产品'
  return match[1]
    .replace(/[*_`#]/g, '')
    .replace(/\s*[|｜].*$/, '')
    .trim()
    .slice(0, 36) || '待命名产品'
}

export function reportPlatform(text: string): string {
  const explicit = text.match(/(?:目标平台|分析平台|下游平台)\s*[：:]\s*([^\n|｜]+)/i)?.[1]?.trim()
  const source = explicit || text
  if (/Amazon\s*美国站|亚马逊\s*美国站|Amazon\s*US/i.test(source)) return 'Amazon美国站'
  if (/Amazon\s*英国站|亚马逊\s*英国站|Amazon\s*UK/i.test(source)) return 'Amazon英国站'
  if (/Amazon\s*日本站|亚马逊\s*日本站/i.test(source)) return 'Amazon日本站'
  if (/eBay/i.test(source)) return /英国/i.test(source) ? 'eBay英国站' : 'eBay美国站'
  if (/Ozon/i.test(source)) return 'Ozon俄罗斯站'
  if (/Amazon|亚马逊/i.test(source)) return 'Amazon美国站'
  return explicit?.slice(0, 20) || '目标平台'
}

/** 报告平台只能来自本次请求固化的值；旧历史缺该值时，调用方才可传入紧邻的触发文本兜底。 */
export function normalizeSelectionReport(content: string, targetPlatform: string, preferredProductName?: string, fallbackText = '', forceReportTitle = false): string {
  // 正式报告保存前由调用方显式传入 forceReportTitle。不能只依赖模型是否使用了
  // 某个固定章节名，否则模型改写“第一部分”后，旧 eBay 标题会漏过归一化而只在校验时失败。
  if (!forceReportTitle && !/(?:标准分析报告|选品分析报告|第一部分[：:]\s*本品基础信息)/.test(content)) return content
  const fromContent = reportProductName(content)
  const preferred = preferredProductName?.replace(/[*_`#]/g, '').trim().slice(0, 36)
  const name = preferred || (fromContent !== '待命名产品' ? fromContent : reportProductName(fallbackText))
  const platform = reportPlatform(targetPlatform)
  const title = `${name} · ${platform}选品分析报告`
  const metadataNormalized = content.replace(/(目标平台\s*[：:]\s*)([^\n|｜]+)/ig, `$1${platform}`)
  return /^#\s+.+$/m.test(metadataNormalized)
    ? metadataNormalized.replace(/^#\s+.+$/m, `# ${title}`)
    : `# ${title}\n\n${metadataNormalized}`
}

/** 从已提取的 1688 字段 + supplyFacts + quickMarketProfit 拼装"第一部分：本品基础信息解析"系统事实块。
 *  纯函数、不调 LLM；空字段一律输出"待验证"；采购价优先使用用户录入的 USD，未录入时回退到 1688 人民币区间。 */
export function buildProductBasicsBlock(info: ExtractedProductInfo): string {
  const safe = (value: unknown, fallback = '待验证') => String(value ?? '').replace(/[|\n\r]/g, ' ').trim() || fallback
  const name = safe(info.confirmedProductName || info.title, '待命名产品')
  const url = safe(info.url, '待验证（未取得 1688 商品链接）')
  const form = safe(info.confirmedProductForm || info.visualProductForm)
  const formLevel = info.confirmedProductForm ? '事实/人工锁定' : (info.visualProductForm ? '外部估算/视觉识别' : '待验证')
  const purchaseUsd = info.quickMarketProfit?.purchaseCostUsd
  const purchaseText = purchaseUsd != null && Number.isFinite(purchaseUsd)
    ? `$${purchaseUsd.toFixed(2)}（事实｜用户录入）`
    : '待验证'
  const moq = safe(info.moq, '待验证')
  const shipFrom = safe(info.shipFrom, '待验证')
  const supply = info.supplyFacts || null
  const purchaseCnyText = supply?.purchasePriceCny
    ? `¥${supply.purchasePriceCny.low}–¥${supply.purchasePriceCny.high}（1688 原报区间；${safe(supply.purchasePriceCny.source)}）`
    : '待验证'
  const packageSizeText = supply?.packagingDimensionsCm
    ? `${supply.packagingDimensionsCm.length}×${supply.packagingDimensionsCm.width}×${supply.packagingDimensionsCm.height} cm（${safe(supply.packagingDimensionsCm.source)}）`
    : '待验证'
  const grossWeightText = supply?.grossWeightGrams
    ? `${supply.grossWeightGrams.value} g（${safe(supply.grossWeightGrams.source)}）`
    : '待验证'
  const ingredientText = safe(supply?.ingredientText, '待验证')
  const liquidRiskText = supply?.liquidRisk ? '高（液体/喷雾/乳液）' : (supply ? '低' : '待验证')
  const conflictsText = supply?.conflicts?.length ? supply.conflicts.join('；') : '无冲突'
  const productSizeText = '待验证（未从 1688 详情页中独立提取；如需可从 attributes 中人工补齐）'
  const productWeightText = '待验证（未从 1688 详情页中独立提取净重；可参考 attributes 或包裹中标注）'
  const cartonCount = '待验证（未提供装箱数；可从 attributes 或问供货商获取）'
  const attributesJoined = info.attributes?.length ? info.attributes.slice(0, 8).map(item => safe(item)).filter(Boolean).join('；') : ''
  const styleText = attributesJoined || '待验证'
  const detailText = safe(info.detailText).slice(0, 400)
  const scenarios = detailText && detailText !== '待验证' ? `${detailText}（来源：1688 详情页）` : '待验证'
  const visualForm = info.visualProductForm ? `视觉识别 ${info.visualProductForm}（置信度 ${info.visualConfidence ?? 0}%）` : '未进行视觉识别'
  const lines: string[] = []
  lines.push('## 第一部分：本品基础信息解析（系统事实块）')
  lines.push(`- 商品名称：${name}`)
  lines.push(`- 商品链接：${url}`)
  lines.push(`- 产品形态：${form}｜证据等级：${formLevel}`)
  lines.push(`- 采购价 USD：${purchaseText}｜1688 人民币区间：${purchaseCnyText}`)
  lines.push(`- 起订量：${moq}｜发货地：${shipFrom}`)
  lines.push(`- 包装尺寸：${packageSizeText}｜毛重：${grossWeightText}｜装箱数：${cartonCount}`)
  lines.push(`- 产品尺寸/净重（单品）：${productSizeText}；${productWeightText}`)
  lines.push(`- 材质/成分：${ingredientText}｜液体风险：${liquidRiskText}｜供货事实冲突：${conflictsText}`)
  lines.push(`- 款式/颜色/变体数（取 1688 规格属性前 8 条）：${styleText}`)
  lines.push(`- 覆盖应用场景（取 1688 详情页前 400 字）：${scenarios}`)
  lines.push(`- 视觉识别参考：${visualForm}`)
  lines.push('- 缺口提示：可解决核心痛点、用户核心购买理由、核心优势、现存劣势需后续由智能体或人工提炼补充；未识别前以"待验证"占位。')
  return lines.join('\n')
}

/** 正式报告保存门禁：标题与报告元数据必须同本次固化的平台一致。 */
export function validateSelectionReportPlatform(content: string, targetPlatform: string): string[] {
  const expected = reportPlatform(targetPlatform)
  const issues: string[] = []
  const heading = content.match(/^#\s+(.+)$/m)?.[1] || ''
  if (heading && !heading.includes(expected)) issues.push(`报告标题平台与本次请求不一致：应为${expected}`)
  const metadata = [...content.matchAll(/目标平台\s*[：:]\s*([^\n|｜]+)/ig)].map(match => match[1].trim())
  if (metadata.some(value => reportPlatform(value) !== expected)) issues.push(`报告元数据目标平台与本次请求不一致：应为${expected}`)
  return issues
}
