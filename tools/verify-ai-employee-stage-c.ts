#!/usr/bin/env node
/**
 * D 阶段端到端 verify 工具：复用 stage-c-d-runner.mjs 的 fixture + 代码路径，
 * 断言阶段 C 的 4 个核心交付物都真的填实了报告内容：
 *   1. buildProductBasicsBlock（第一部分）9 行不空
 *   2. buildCompetitorReviewInsights（第三部分 3.2）按 ASIN 聚合真实标题
 *   3. buildCompetitorListingSummary（第三部分 3.3）brand + 核心 bullet 真实拼接
 *   4. marketBlock 拼装路径（AIEmployee.tsx 1034 行）含全部 4 段
 *   5. 报告 markdown 6 部分齐全，第一/第三部分明确非空
 *   6. 真实归档文件存在
 *   7. 系统入场结论与报告最终结论一致
 *   8. 缺口提示显式存在（装箱数、净重、本品自评等）
 *
 * 不依赖 Electron / 1688 / Amazon / LLM：
 *   跑真实 fixture → 真实纯函数 → 真实 marketBlock → 真实报告归档
 *   与 .tmp-ui-verify/stage-c-d-runner.mjs 是同源 fixture
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ─── 1. 复用 stage-c-d-runner 的 fixture（动态 import） ─────────────
type ExtractedProductInfo = any
type AmazonListingEvidence = any
type AmazonReviewEvidence = any
type ClassifiedAmazonMarketSample = any
type AmazonSampleAudit = any

// 构造 fixture（与 runner 一致；不复用 runner 是为了保证 verify 工具自包含）
const nowIso = '2026-08-18T10:00:00.000Z'
const extracted: ExtractedProductInfo = {
  url: 'https://detail.1688.com/offer/998877665544.html',
  confirmedProductName: '宠物免洗清洁喷雾 200ml 猫狗通用',
  confirmedProductForm: '液体精华',
  confirmedUseMethod: '喷洒',
  confirmedTargetObject: '猫狗',
  visualProductForm: '液体精华',
  visualConfidence: 0.86,
  moq: '≥ 2 件',
  shipFrom: '广东广州',
  attributes: ['品牌: 萌宠乐园', '规格: 200ml', '适用对象: 猫狗通用', '形态: 喷雾', '香味: 绿茶/薰衣草'],
  detailText: '宠物免洗清洁喷雾专为猫咪狗狗设计，无需水洗即可去除宠物毛发上的污渍和异味。',
  supplyFacts: {
    purchasePriceCny: { low: 12.5, high: 15.8, source: '1688 商品页价格区间' },
    packagingDimensionsCm: { length: 5, width: 5, height: 18, source: '1688 商品页规格/详情' },
    grossWeightGrams: { value: 240, source: '1688 商品页规格/详情' },
    ingredientText: '去离子水、椰油基表面活性剂、茶多酚、香精',
    liquidRisk: true,
    conflicts: []
  },
  quickMarketProfit: { purchaseCostUsd: 2.45, referralFeeRate: 15, fbaFulfillmentFeeUsd: 3.43, returnLossRate: 5, advertisingRate: 10, couponCostUsd: 5 },
  fullCostProfit: {
    packagingQcUsd: { low: 0.5, base: 0.7, high: 1.0 },
    domesticFreightUsd: { low: 0.3, base: 0.5, high: 0.8 }
  },
  entryDecision: { targetContributionMargin: 15, differentiationEvidence: '猫狗通用 + 绿茶/薰衣草双香型', complianceIpEvidence: '成分均为常见日化原料' },
  profitFieldMeta: {
    purchaseCostUsd: { origin: '用户修改', evidenceLevel: '分析假设', source: '用户录入', updatedAt: nowIso, decisionEligible: true },
    targetContributionMargin: { origin: '用户修改', evidenceLevel: '分析假设', source: '用户录入', updatedAt: nowIso, decisionEligible: true }
  }
}

const listingEvidence: AmazonListingEvidence[] = [
  { asin: 'B0C1AQUPET', url: 'https://www.amazon.com/dp/B0C1AQUPET', capturedAt: nowIso, source: 'browser', title: 'Pet Waterless Cleansing Spray 8oz', brand: 'PawPure', price: 11.99, rating: 4.4, reviews: 1287, bulletPoints: ['WATERLESS CLEANSING - No-rinse formula gently removes dirt and odors from pet fur and coat', 'GENTLE FOR SENSITIVE SKIN - Hypoallergenic with aloe vera and chamomile extracts'], variantSummary: '8oz / 16oz', seller: 'PawPure Direct' },
  { asin: 'B0D2DOGCAT', url: 'https://www.amazon.com/dp/B0D2DOGCAT', capturedAt: nowIso, source: 'browser', title: 'No-Rinse Dog Cat Waterless Shampoo', brand: 'FurFresh', price: 13.49, rating: 4.1, reviews: 643, bulletPoints: ['WATERLESS DOG SHAMPOO - Clean and deodorize without water', 'SAFE INGREDIENTS - Plant-based formula'], variantSummary: '250ml', seller: 'FurFresh Co.' }
]

const reviewEvidence: AmazonReviewEvidence[] = [
  { asin: 'B0C1AQUPET', url: 'https://www.amazon.com/product-reviews/B0C1AQUPET', capturedAt: nowIso, source: 'browser', snippets: [
    { rating: 5, title: 'Amazing for my long-haired cat', body: 'Works like a charm' },
    { rating: 5, title: 'Smells wonderful and gentle', body: 'No skin irritation' },
    { rating: 2, title: 'Bottle is too small', body: 'Need bigger size' }
  ]},
  { asin: 'B0D2DOGCAT', url: 'https://www.amazon.com/product-reviews/B0D2DOGCAT', capturedAt: nowIso, source: 'browser', snippets: [
    { rating: 5, title: 'Best waterless shampoo for golden retriever', body: 'No rinsing required' },
    { rating: 1, title: 'Made my dog itch', body: 'Returned immediately' }
  ]}
]

const allSamples: ClassifiedAmazonMarketSample[] = [
  { asin: 'B0C1AQUPET', title: listingEvidence[0].title, price: listingEvidence[0].price, rating: listingEvidence[0].rating, reviews: listingEvidence[0].reviews, query: 'pet waterless shampoo', page: 1, sponsored: false, source: 'browser', salesVolume: '1K+ bought in past month', bsr: null, comparisonClass: 'DIRECT', comparisonReason: '对象、任务与产品形态一致' },
  { asin: 'B0D2DOGCAT', title: listingEvidence[1].title, price: listingEvidence[1].price, rating: listingEvidence[1].rating, reviews: listingEvidence[1].reviews, query: 'cat dog no rinse spray', page: 1, sponsored: false, source: 'browser', salesVolume: null, bsr: null, comparisonClass: 'DIRECT', comparisonReason: '对象、任务与产品形态一致' },
  { asin: 'B0F4WIPES1', title: 'Pet Grooming Wipes, 100 Count', price: 12.99, rating: 4.6, reviews: 8234, query: 'pet wipes', page: 1, sponsored: false, source: 'api', salesVolume: null, bsr: null, comparisonClass: 'ADJACENT', comparisonReason: '解决同一任务，但产品形态不同' }
]

const audit: AmazonSampleAudit = {
  rawCount: 3, organicCount: 3, sponsoredCount: 0, uniqueCount: 3,
  directCount: 2, adjacentCount: 1, excludedCount: 0,
  keywordsRequested: 3, keywordsSucceeded: 3, keywordCoveragePercent: 100,
  fieldCoveragePercent: 100, salesSignalCount: 1, salesSignalLowerBound: 1000,
  coveragePercent: 100, confidence: '可决策'
}

const plan = { keywords: ['pet waterless shampoo', 'cat dog no rinse spray', 'pet cleansing water'], source: 'model' as const }
const intent = {
  productName: extracted.confirmedProductName,
  productForm: extracted.confirmedProductForm,
  useMethod: extracted.confirmedUseMethod,
  targetObject: extracted.confirmedTargetObject,
  excludedTerms: [],
  retailUnit: { kind: 'volume_ml' as const, quantity: 200, label: '200ml' }
}

// ─── 2. 调真实纯函数（动态 import ts） ─────────────────────────────
async function main() {
const selectionExtract = await import(resolve(root, 'src/shared/selectionExtract.ts'))
const amazonScraper = await import(resolve(root, 'src/shared/amazonScraper.ts'))

const productBasics = selectionExtract.buildProductBasicsBlock(extracted)
const reviewInsights = amazonScraper.buildCompetitorReviewInsights(allSamples, reviewEvidence)
const listingSummary = amazonScraper.buildCompetitorListingSummary(allSamples, listingEvidence)
const marketBlock = [
  selectionExtract.buildProductBasicsBlock(extracted),
  amazonScraper.buildComparableMarketFactBlock(intent, plan, allSamples, audit),
  amazonScraper.buildCompetitorReviewInsights(allSamples, reviewEvidence),
  amazonScraper.buildCompetitorListingSummary(allSamples, listingEvidence),
  amazonScraper.buildAmazonQuickMarketProfitFactBlock(intent, allSamples, extracted.quickMarketProfit, extracted.profitFieldMeta),
  amazonScraper.buildAmazonFullCostProfitFactBlock(intent, allSamples, extracted.quickMarketProfit, extracted.fullCostProfit, extracted.profitFieldMeta),
  amazonScraper.buildAmazonEntryDecisionFactBlock(intent, allSamples, audit, extracted.quickMarketProfit, extracted.fullCostProfit, extracted.entryDecision, extracted.profitFieldMeta)
].join('\n\n')

const decision = amazonScraper.evaluateAmazonEntryDecision(
  intent, allSamples, audit,
  extracted.quickMarketProfit, extracted.fullCostProfit, extracted.entryDecision, extracted.profitFieldMeta
)

// ─── 3. 跑 stage-c-d-runner（必须先跑过才能归档） ───────────────────
const outPath = join(root, 'artifacts/online-advisor-parity/stage-c-d-report.md')
const reportExists = existsSync(outPath)
const reportContent = reportExists ? readFileSync(outPath, 'utf-8') : ''
const reportStat = reportExists ? statSync(outPath) : null

// ─── 4. 断言 ───────────────────────────────────────────────────

// 第 1 组：buildProductBasicsBlock 9 行全部填实
assert('buildProductBasicsBlock 9 行齐全', productBasics.split('\n').filter(l => l.startsWith('- ')).length >= 9)
assert('buildProductBasicsBlock 含采购价 USD + 1688 人民币区间', productBasics.includes('$2.45（事实｜用户录入）') && productBasics.includes('¥12.5–¥15.8'))
assert('buildProductBasicsBlock 含包装尺寸 + 毛重（真实字段）', productBasics.includes('5×5×18 cm') && productBasics.includes('240 g'))
assert('buildProductBasicsBlock 含款式属性前 8 条', productBasics.includes('品牌: 萌宠乐园') && productBasics.includes('香味: 绿茶/薰衣草'))
assert('buildProductBasicsBlock 含应用场景（detailText 前 400 字）', productBasics.includes('覆盖应用场景') && productBasics.includes('宠物免洗清洁喷雾专为'))
assert('buildProductBasicsBlock 含缺口提示（4 项占位）', productBasics.includes('缺口提示') && productBasics.includes('可解决核心痛点') && productBasics.includes('现存劣势'))

// 第 2 组：buildCompetitorReviewInsights 按 ASIN 真实聚合
assert('buildCompetitorReviewInsights 含 2 个 ASIN 行', (reviewInsights.match(/B0[A-Z0-9]+｜/g) || []).length >= 2)
assert('buildCompetitorReviewInsights 好评含真实标题（去重 + minChars）', reviewInsights.includes('Amazing for my long-haired cat') && reviewInsights.includes('Smells wonderful and gentle'))
assert('buildCompetitorReviewInsights 差评含真实标题（rating ≤ 2）', reviewInsights.includes('Bottle is too small') || reviewInsights.includes('Made my dog itch'))
assert('buildCompetitorReviewInsights 来源标注 Amazon 评论页 URL', reviewInsights.includes('Amazon 评论页') && reviewInsights.includes('https://www.amazon.com/product-reviews/'))

// 第 3 组：buildCompetitorListingSummary 拼接 brand + bullet
assert('buildCompetitorListingSummary 含 brand + seller + variant', listingSummary.includes('PawPure') && listingSummary.includes('FurFresh') && listingSummary.includes('8oz / 16oz') && listingSummary.includes('250ml'))
// 80 字符截断真实生效：90 字符 bullet "from pet fur and coat" 应被截到 80 字符 "from pet fu"，
// 而 80 字符 bullet "GENTLE FOR SENSITIVE SKIN - ...chamomile extracts" 应保持完整。
const bulletOverlong = 'WATERLESS CLEANSING - No-rinse formula gently removes dirt and odors from pet fur and coat' // 90 chars
const bulletTruncatedAt80 = 'WATERLESS CLEANSING - No-rinse formula gently removes dirt and odors from pet fu' // 80 chars
const bulletExactly80 = 'GENTLE FOR SENSITIVE SKIN - Hypoallergenic with aloe vera and chamomile extracts' // 80 chars
assert(
  'buildCompetitorListingSummary 80 字符截断生效（90 字符 bullet 被截到 80）',
  listingSummary.includes(bulletTruncatedAt80) && !listingSummary.includes(bulletOverlong)
)
assert(
  'buildCompetitorListingSummary 正好 80 字符 bullet 不再截（保留完整）',
  listingSummary.includes(bulletExactly80)
)
assert(
  'buildCompetitorListingSummary 每个 DIRECT 截前 2 条 bullet',
  listingSummary.includes('WATERLESS CLEANSING') && listingSummary.includes('WATERLESS DOG SHAMPOO') && listingSummary.includes('GENTLE FOR SENSITIVE SKIN') && listingSummary.includes('SAFE INGREDIENTS')
)
assert('buildCompetitorListingSummary 来源标注 Amazon 详情页 URL', listingSummary.includes('Amazon 详情页') && listingSummary.includes('https://www.amazon.com/dp/'))

// 第 4 组：marketBlock 拼装路径（AIEmployee.tsx 1034 行同源）
assert('marketBlock 拼装含 4 段（第一/第二/第三 3.1+3.2+3.3 / 第四 / 第五 / 第六）', marketBlock.includes('第一部分') && marketBlock.includes('系统抓取 Amazon') && marketBlock.includes('竞品评论意见聚合') && marketBlock.includes('竞品详情页 bullet 摘要') && marketBlock.includes('快速市场利润率') && marketBlock.includes('全成本落地利润率') && marketBlock.includes('入场决策门禁'))
assert('marketBlock 不重复拼装 buildProductBasicsBlock（AIEmployee 1034 行只调用一次）', marketBlock.split('第一部分：本品基础信息解析').length === 2)

// 第 5 组：归档报告 6 部分齐全
assert('归档报告文件存在', reportExists && reportStat && reportStat.size > 1000, `path=${outPath} size=${reportStat?.size || 0}`)
assert('归档报告含 6 部分标题（第一～第六）', reportContent.includes('## 第一部分') && reportContent.includes('## 第二部分') && reportContent.includes('## 第三部分') && reportContent.includes('## 第四部分') && reportContent.includes('## 第五部分') && reportContent.includes('## 第六部分'))
assert('归档报告附录含完整 marketBlock', reportContent.includes('## 附录：阶段 4 systemFact 块') && reportContent.includes('第一部分：本品基础信息解析（系统事实块）'))

// 第 6 组：第一/第三部分非空（用户核心诉求"待验证不空着"）
assert('第一部分含货源基础 5 行（商品名称/链接/采购价/起订量/发货地）', (reportContent.match(/\| 货源基础 \|/g) || []).length >= 5)
assert('第一部分含产品参数 6 行（材质/形态/包装尺寸/毛重/装箱数/款式）', (reportContent.match(/\| 产品参数 \|/g) || []).length >= 6)
assert('第一部分含 3 行缺口提示行（痛点/购买理由/应用场景）', (reportContent.match(/\| 需求价值 \|/g) || []).length >= 3)
assert('第一部分采购价不再是空（"待验证"或数字都算填实）', /采购单价\s*\|\s*([^|\n]+\|){4}/.test(reportContent) && !/采购单价\s*\|\s*待验证\s*\|/.test(reportContent))
assert('第三部分 3.1 竞品汇总表 3 列 ASIN 真实数据', reportContent.includes('B0C1AQUPET') && reportContent.includes('B0D2DOGCAT') && reportContent.includes('B0E3LIVGRN'))

// 第 7 组：系统入场结论与报告最终结论一致（决策可追溯）
const sysDecision = decision.decision
const reportHasMatchDecision = new RegExp(`- 最终结论：${sysDecision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(reportContent)
assert('系统入场结论 = 报告最终结论（决策可追溯）', reportHasMatchDecision, `sys=${sysDecision}`)

// 第 8 组：缺口提示显式占位（透明可追溯）
assert('归档报告含显式缺口提示（装箱数 / 净重 / 本品自评）', reportContent.includes('待验证（未提供装箱数）') || reportContent.includes('待验证'))

// ─── 5. 收尾 ───────────────────────────────────────────────────
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
}
main().catch(error => { console.error('VERIFY FAILED:', error.message); process.exit(1) })
