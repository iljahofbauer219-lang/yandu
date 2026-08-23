import type { AmazonEntryDecision, AmazonListingEvidence, AmazonReviewEvidence, AmazonSampleAudit, ClassifiedAmazonMarketSample } from './amazonScraper'
import type { ExtractedProductInfo } from './selectionExtract'
import { SELECTION_REPORT_TEMPLATE, SELECTION_REPORT_TEMPLATE_REFERENCE, type SelectionReportSectionContract, type SelectionReportTableContract } from './selectionReportTemplate'

export interface SelectionReportTablePayload {
  id: string
  title: string
  columns: string[]
  rows: string[][]
}

export interface SelectionReportSectionPayload {
  id: string
  title: string
  tables: SelectionReportTablePayload[]
}

/** 阶段3的唯一数据交接对象；模型只可补充文字，不能更改本对象的结构或系统事实。 */
export interface SelectionReportPayload {
  schemaVersion: 'selection-report-payload/v1'
  templateSha256: string
  generatedAt: string
  productName: string
  targetPlatform: string
  status: '正式' | '预备'
  decision: AmazonEntryDecision
  /** 只读详情页事实，供受控模型按 ASIN 白名单归纳；渲染字段仍由 tables 决定。 */
  listingEvidence: AmazonListingEvidence[]
  reviewEvidence: AmazonReviewEvidence[]
  sections: SelectionReportSectionPayload[]
}

export interface SelectionReportPayloadInput {
  info: ExtractedProductInfo
  targetPlatform: string
  keywords?: string[]
  audit?: AmazonSampleAudit | null
  samples?: ClassifiedAmazonMarketSample[]
  /** 阶段1 Amazon DIRECT详情页真实采集结果；页面未显示的字段保持待验证。 */
  listingEvidence?: AmazonListingEvidence[]
  /** 阶段4 评论页原始可见片段；只作为样本，不得外推评论趋势或用户群体。 */
  reviewEvidence?: AmazonReviewEvidence[]
  decision?: AmazonEntryDecision
  /** 主数据源或页面补充的失败/降级说明，必须随报告保留，不能在界面提示消失后丢失。 */
  marketDataNotice?: string
}

const pending = '待验证'
const cell = (value: unknown, fallback = pending): string => String(value ?? '').replace(/[|\n\r]/g, ' ').trim() || fallback
const money = (value?: number | null): string => value == null ? pending : `$${value.toFixed(2)}`
const evidence = (source?: string): string => source ? `来源：${source}` : pending

function table(contract: SelectionReportTableContract, rows: string[][]): SelectionReportTablePayload {
  return {
    id: contract.id,
    title: contract.title,
    columns: [...contract.columns],
    rows: (rows.length ? rows : [contract.columns.map(() => pending)]).map(row => contract.columns.map((_, index) => cell(row[index])))
  }
}

function findTable(section: SelectionReportSectionContract, id: string): SelectionReportTableContract {
  const found = section.tables.find(item => item.id === id)
  if (!found) throw new Error(`未定义的报告表格：${id}`)
  return found
}

function directSamples(samples: ClassifiedAmazonMarketSample[] = [], limit = 3): ClassifiedAmazonMarketSample[] {
  return samples.filter(sample => sample.comparisonClass === 'DIRECT').slice(0, limit)
}

export function createSelectionReportPayload(input: SelectionReportPayloadInput): SelectionReportPayload {
  const { info, targetPlatform, audit } = input
  const direct = directSamples(input.samples, 8)
  const evidenceByAsin = new Map((input.listingEvidence || []).map(item => [item.asin.toUpperCase(), item]))
  const reviewByAsin = new Map((input.reviewEvidence || []).map(item => [item.asin.toUpperCase(), item]))
  const listing = (sample: ClassifiedAmazonMarketSample) => evidenceByAsin.get(sample.asin.toUpperCase())
  const review = (sample: ClassifiedAmazonMarketSample) => reviewByAsin.get(sample.asin.toUpperCase())
  const evidenceTrace = (item?: AmazonListingEvidence) => item ? `详情页 ${item.url}；${item.capturedAt.slice(0, 10)}` : pending
  const productName = cell(info.confirmedProductName || info.title, '待命名产品')
  const purchase = info.quickMarketProfit?.purchaseCostUsd
  const sections = SELECTION_REPORT_TEMPLATE.map(section => {
    if (section.id === 'part-1') return {
      id: section.id, title: section.title, tables: [table(findTable(section, 'product-basics'), [
        ['货源基础', '商品链接 / 产品图', cell(info.url), evidence('1688 商品页')],
        ['货源基础', '采购单价、起订量、交期', purchase == null ? pending : money(purchase), evidence(info.profitFieldMeta?.purchaseCostUsd?.source)],
        ['产品参数', '材质、产品尺寸、净重', cell((info.attributes || []).join('；')), evidence(info.detailSource)],
        ['产品参数', '包装尺寸、毛重、装箱数', info.supplyFacts?.packagingDimensionsCm && info.supplyFacts?.grossWeightGrams ? `${info.supplyFacts.packagingDimensionsCm.length}×${info.supplyFacts.packagingDimensionsCm.width}×${info.supplyFacts.packagingDimensionsCm.height}cm；${info.supplyFacts.grossWeightGrams.value}g` : pending, evidence(info.supplyFacts?.packagingDimensionsCm?.source || info.supplyFacts?.grossWeightGrams?.source)],
        ['产品参数', '款式、颜色、变体数', cell(info.attributes?.filter(item => /款式|颜色|规格|SKU/i.test(item)).join('；')), evidence('1688 商品页属性')],
        ['需求价值', '可解决核心痛点', pending, '分析师补充；无证据不得写成事实'],
        ['需求价值', '用户核心购买理由', pending, '分析师补充；无证据不得写成事实'],
        ['本品自评', '核心优势', cell(info.confirmedProductForm || info.visualProductForm), evidence('人工锁定/商品图片')],
        ['本品自评', '现存劣势', pending, '待与DIRECT样本比较'],
        ['证据状态', '身份与信息完整性', cell(info.identityResolutionNote), '系统锁定商品身份']
      ])]
    }
    if (section.id === 'part-2') return {
      id: section.id, title: section.title, tables: [
        table(findTable(section, 'market-overview'), [
          ['DIRECT样本数量', cell(audit?.directCount, '0'), pending, audit?.directCount ? '仅统计同一核心用途、形态、对象的DIRECT样本' : '待补数'],
          ['三组检索词成功率', audit ? `${audit.keywordsSucceeded}/${audit.keywordsRequested}` : pending, cell(input.keywords?.join('；')), audit?.keywordsSucceeded === audit?.keywordsRequested ? '检索覆盖达成' : '待补数'],
          ['DIRECT价格/评分/评论字段覆盖', audit ? `${audit.fieldCoveragePercent}%` : pending, pending, audit && audit.fieldCoveragePercent >= 50 ? '可用于方向性比较' : '字段覆盖不足'],
          ['样本完整率', audit ? `${audit.coveragePercent}%` : pending, pending, audit?.confidence || pending],
          ['购买信号', audit?.salesSignalCount ? `${audit.salesSignalCount} 个DIRECT样本；下限 ${audit.salesSignalLowerBound}+` : pending, pending, '仅为搜索页购买徽标，不得改写为精确月销量'],
          ['数据源状态', audit?.rawCount ? '已取得样本' : pending, pending, cell(input.marketDataNotice, audit?.rawCount ? 'OmkarCloud API 优先；Amazon 页面仅补充缺失字段' : '待验证')]
        ]),
        table(findTable(section, 'category-recommendation'), [[cell(info.amazonFinancialPreset?.candidateCategory), pending, cell(info.amazonFinancialPreset?.categoryBasis), pending, '候选，待实际Listing类目确认', cell(info.amazonFinancialPreset?.categoryConfidence)]]),
        table(findTable(section, 'compliance-ip'), [
          ['产品安全/标签', cell(info.supplyFacts?.ingredientText), '待核验目标市场标签及成分要求', evidence('1688 商品页'), '人工核验'],
          ['危险品/运输', info.supplyFacts?.liquidRisk ? '液体/喷雾形态' : pending, '待核验运输与FBA限制', evidence('商品属性/详情'), '人工核验'],
          ['商标/专利/IP', pending, '待检索', pending, '人工核验']
        ])
      ]
    }
    if (section.id === 'part-3') {
      const competitors = [...direct.slice(0, 3), ...Array.from({ length: Math.max(0, 3 - direct.length) }, () => null)]
      const value = (sample: ClassifiedAmazonMarketSample | null, field: 'title' | 'price' | 'rating' | 'reviews') => {
        if (!sample) return pending
        const item = listing(sample)
        if (field === 'price') return money(item?.price ?? sample.price)
        if (field === 'rating') return cell(item?.rating ?? sample.rating)
        if (field === 'reviews') return cell(item?.reviews ?? sample.reviews)
        return cell(item?.title ?? sample.title)
      }
      return { id: section.id, title: section.title, tables: [table(findTable(section, 'core-competitors'), [
        ['标题/ASIN', productName, ...competitors.map(sample => sample ? `${cell(sample.asin)} ${cell(sample.title)}` : pending), 'DIRECT样本仅作可比竞品'],
        ['标准化售价', pending, ...competitors.map(sample => value(sample, 'price')), '待按零售单位复核'],
        ['评分', pending, ...competitors.map(sample => value(sample, 'rating')), '系统抓取字段'],
        ['评论量', pending, ...competitors.map(sample => value(sample, 'reviews')), '系统抓取字段'],
        ['差异化/痛点', cell(info.entryDecision?.differentiationEvidence), ...competitors.map(sample => sample ? cell([listing(sample)?.bulletPoints.slice(0, 1).join('；'), review(sample)?.snippets[0] ? `评论样本：${review(sample)?.snippets[0].title} ${review(sample)?.snippets[0].body}` : ''].filter(Boolean).join('；')) : pending), '详情页卖点与评论页原文样本；不得外推为高频结论']
      ])] }
    }
    if (section.id === 'part-4') {
      return { id: section.id, title: section.title, tables: [table(findTable(section, 'top-stores'), direct.length
        ? direct.map(sample => {
          const item = listing(sample)
          const trafficEvidence = [item?.bsr, ...(item?.badges || [])].filter(Boolean).join('；') || cell(sample.salesVolume)
          return [
            cell(item?.brand),
            `${cell(sample.asin)} ${cell(item?.title ?? sample.title)}`,
            money(item?.price ?? sample.price),
            `${cell(item?.rating ?? sample.rating)}/${cell(item?.reviews ?? sample.reviews)}`,
            trafficEvidence,
            cell(item?.bulletPoints.slice(0, 2).join('；')),
            cell(item?.operations.join('；')),
            `${evidenceTrace(item)}${review(sample)?.snippets[0] ? `；评论页 ${review(sample)?.url}；${review(sample)?.capturedAt.slice(0, 10)}；样本：${review(sample)?.snippets[0].title}` : ''}`
          ]
        })
        : [[pending, pending, pending, pending, pending, pending, pending, '未取得DIRECT样本']])]
      }
    }
    if (section.id === 'part-5') {
      return { id: section.id, title: section.title, tables: [
        table(findTable(section, 'profitability'), [
          ['采购价', money(purchase), money(purchase), evidence(info.profitFieldMeta?.purchaseCostUsd?.source)],
          ['Amazon佣金', info.quickMarketProfit?.referralFeeRate == null ? pending : `${info.quickMarketProfit.referralFeeRate}%`, info.quickMarketProfit?.referralFeeRate == null ? pending : `${info.quickMarketProfit.referralFeeRate}%`, evidence(info.profitFieldMeta?.referralFeeRate?.source)],
          ['FBA履约费', money(info.quickMarketProfit?.fbaFulfillmentFeeUsd), money(info.quickMarketProfit?.fbaFulfillmentFeeUsd), evidence(info.profitFieldMeta?.fbaFulfillmentFeeUsd?.source)],
          ['广告/优惠券', info.quickMarketProfit?.advertisingRate == null ? pending : `${info.quickMarketProfit.advertisingRate}% / ${money(info.quickMarketProfit.couponCostUsd)}`, pending, '系统预设或用户修改'],
          ['全成本物流/税费', pending, pending, '未知项不可按真实成本参与正向结论']
        ]),
        table(findTable(section, 'opportunity'), [
          ['市场样本基线', audit ? `${audit.directCount} DIRECT；完整率${audit.coveragePercent}%` : pending, audit?.confidence || pending, '补齐三组检索词和DIRECT字段'],
          ['差异化', cell(info.entryDecision?.differentiationEvidence), '待核验', '提供样品/竞品对比/买家证据'],
          ['合规/IP', cell(info.entryDecision?.complianceIpEvidence), '待核验', '完成官方检索与测试/标签核验']
        ]),
        table(findTable(section, 'entry-decision'), [
          ['系统入市结论', input.decision || '❓ 数据不足，不能判定'],
          ['目标贡献利润率', info.entryDecision?.targetContributionMargin == null ? pending : `${info.entryDecision.targetContributionMargin}%`],
          ['30天验证计划', '补齐FBA、全成本、合规/IP和DIRECT样本，复算全成本贡献利润'],
          ['停止条件', '全成本贡献利润为负、合规/IP硬门禁失败或无法形成可核验差异化']
        ])
      ] }
    }
    return { id: section.id, title: section.title, tables: [
      table(findTable(section, 'improvement'), [
        ['外观/结构改良', pending, '待与DIRECT竞品对比', pending, '待验证'],
        ['规格/SKU拓展', pending, '待与DIRECT竞品对比', pending, '待验证'],
        ['合规资质补齐', '完成成分、标签、运输与IP核验', '平台与法规要求', pending, '降低上架风险']
      ]),
      table(findTable(section, 'long-term-opportunity'), [['细分需求机会', '待完成30天验证后，以DIRECT价格、购买信号和全成本贡献利润复盘']])
    ] }
  })
  return {
    schemaVersion: 'selection-report-payload/v1',
    templateSha256: SELECTION_REPORT_TEMPLATE_REFERENCE.sha256,
    generatedAt: new Date().toISOString(),
    productName,
    targetPlatform,
    // 有审计对象不等于样本已可决策；低覆盖或DIRECT不足时仍只能交付预备事实包。
    status: audit && audit.keywordsSucceeded >= 3 && audit.directCount >= 15 && audit.fieldCoveragePercent >= 50 && audit.coveragePercent >= 50 ? '正式' : '预备',
    decision: input.decision || '❓ 数据不足，不能判定',
    listingEvidence: input.listingEvidence || [],
    reviewEvidence: input.reviewEvidence || [],
    sections
  }
}

/** 对事实包的结构进行确定性检查；此检查不验证模型文字，仅验证交接数据没有丢表、错列或空行。 */
export function validateSelectionReportPayload(payload: SelectionReportPayload): string[] {
  const issues: string[] = []
  if (payload.schemaVersion !== 'selection-report-payload/v1') issues.push('报告事实包版本不正确')
  if (payload.templateSha256 !== SELECTION_REPORT_TEMPLATE_REFERENCE.sha256) issues.push('报告事实包引用的模板版本不一致')
  if (!payload.targetPlatform.trim()) issues.push('报告事实包缺少目标平台')
  for (const section of SELECTION_REPORT_TEMPLATE) {
    const actual = payload.sections.find(item => item.id === section.id)
    if (!actual || actual.title !== section.title) { issues.push(`报告事实包缺少章节：${section.title}`); continue }
    for (const contract of section.tables) {
      const actualTable = actual.tables.find(item => item.id === contract.id)
      if (!actualTable || actualTable.title !== contract.title) { issues.push(`报告事实包缺少表格：${contract.title}`); continue }
      if (actualTable.columns.join('|') !== contract.columns.join('|')) issues.push(`报告事实包表头不一致：${contract.title}`)
      if (!actualTable.rows.length || actualTable.rows.some(row => row.length !== contract.columns.length)) issues.push(`报告事实包行数据不完整：${contract.title}`)
    }
  }
  return issues
}

/** 交给智能体的只读事实包。模型不得修改其中的系统字段或把待验证改为事实。 */
export function selectionReportPayloadFactBlock(payload: SelectionReportPayload): string {
  return `【结构化报告事实包（只读）】\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
}
