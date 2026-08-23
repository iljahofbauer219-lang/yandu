#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildAmazonSearchIntent,
  buildAmazonFullCostProfitFactBlock,
  buildAmazonEntryDecisionFactBlock,
  buildAmazonQuickMarketProfitFactBlock,
  amazonProfitDecisionEvidenceIssues,
  buildComparableMarketFactBlock,
  classifyAmazonSamples,
  meetsAmazonResearchSampleBaseline,
  normalizeAmazonKeywordPlan,
  sanitizeAmazonMarketClaims,
  evaluateAmazonEntryDecision,
  validateAmazonEntryDecisionClaim,
  validateAmazonMarketClaims,
  type AmazonMarketSample
} from '../src/shared/amazonScraper'

let checks = 0
let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  checks += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

const intent = buildAmazonSearchIntent({ confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗', attributes: ['净含量：30ml'] })
const plan = normalizeAmazonKeywordPlan(intent, ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
const queries = plan.keywords
const samples: AmazonMarketSample[] = []
for (let index = 0; index < 36; index += 1) {
  samples.push({ asin: `DIRECT${String(index).padStart(3, '0')}`, title: `Waterless Pet Shampoo No Rinse Body Cleanser 30ml for Dogs and Cats ${index}`, price: 10 + index, rating: 4 + index % 6 / 10, reviews: 100 + index * 10, query: queries[index % 3], page: index % 2 + 1, sponsored: false, source: 'api' })
}
for (let index = 0; index < 6; index += 1) {
  samples.push({ asin: `SPONSORED${index}`, title: `Waterless Pet Shampoo Sponsored Result ${index}`, price: 12, rating: 4.5, reviews: 9999, query: queries[index % 3], page: index % 2 + 1, sponsored: true, source: 'api' })
}
for (let index = 0; index < 3; index += 1) {
  samples.push({ asin: `WIPE${index}`, title: `Pet Grooming Wipes for Dog and Cat Body Cleaning ${index}`, price: 8, rating: 4.8, reviews: 8000, query: queries[index], page: 1, sponsored: false, source: 'api' })
  samples.push({ asin: `BRUSH${index}`, title: `Pet Grooming Cleaning Brush for Dogs ${index}`, price: 6, rating: 4.7, reviews: 7000, query: queries[index], page: 1, sponsored: false, source: 'api' })
}
const complete = classifyAmazonSamples(intent, samples, { keywordsRequested: 3, keywordsSucceeded: 3 })
assert('完整样本记录自然位与赞助位', complete.audit.rawCount === 48 && complete.audit.organicCount === 42 && complete.audit.sponsoredCount === 6)
assert('纯赞助位不进入ASIN去重和竞品统计', complete.audit.uniqueCount === 42 && complete.samples.every(item => !item.sponsored))
assert('三组检索词全部成功', complete.audit.keywordsRequested === 3 && complete.audit.keywordsSucceeded === 3 && complete.audit.keywordCoveragePercent === 100)
assert('36个DIRECT达到决策样本线', complete.audit.directCount === 36 && complete.audit.confidence === '可决策')
assert('DIRECT核心字段完整率100%', complete.audit.fieldCoveragePercent === 100)
assert('综合样本完整率100%', complete.audit.coveragePercent === 100)
assert('完整样本通过研究样本基线', meetsAmazonResearchSampleBaseline(complete.audit))

const fact = buildComparableMarketFactBlock(intent, plan, complete.samples, complete.audit)
assert('事实块显示自然位与赞助位排除', fact.includes('自然位 42') && fact.includes('赞助位排除 6'))
assert('事实块显示样本完整率与检索词成功率', fact.includes('样本完整率：100%') && fact.includes('检索词成功 3/3'))
assert('标准化价格输出P25/中位/P75', fact.includes('DIRECT 标准化零售价（按本品零售单位 30ml）') && fact.includes('P25 $18.75') && fact.includes('中位价 $27.50') && fact.includes('P75 $36.25'), fact.match(/DIRECT 标准化零售价[^\n]*/)?.[0] || '')
assert('评分输出中位数', fact.includes('DIRECT 评分中位'))
assert('评论输出中位和P75', fact.includes('DIRECT 评论量：中位') && fact.includes('P75'))
assert('证据等级和抓取窗口限制进入事实块', fact.includes('证据等级：事实') && fact.includes('不等同完整市场'))

const normalizedIntent = buildAmazonSearchIntent({ confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗', attributes: ['净含量：30ml'] })
const normalizedSamples = classifyAmazonSamples(normalizedIntent, [
  { asin: 'UNIT000001', title: 'Waterless Pet Shampoo No Rinse Cleanser 30ml for Dogs and Cats', price: 10, rating: 4.2, reviews: 100 },
  { asin: 'UNIT000002', title: '2 Pack Waterless Pet Shampoo No Rinse Cleanser 30ml for Dogs and Cats', price: 16, rating: 4.3, reviews: 110 },
  { asin: 'UNIT000003', title: 'Waterless Pet Shampoo No Rinse Cleanser 60ml for Dogs and Cats', price: 20, rating: 4.4, reviews: 120 },
  { asin: 'UNIT000004', title: 'Waterless Pet Shampoo No Rinse Cleanser for Dogs and Cats', price: 9, rating: 4.5, reviews: 130 }
], { keywordsRequested: 3, keywordsSucceeded: 3 })
const normalizedFact = buildComparableMarketFactBlock(normalizedIntent, plan, normalizedSamples.samples, normalizedSamples.audit)
assert('容量和套装按30ml零售单位标准化', normalizedFact.includes('P25 $9.00') && normalizedFact.includes('中位价 $10.00') && normalizedFact.includes('P75 $10.00') && normalizedFact.includes('均价 $9.33'), normalizedFact.match(/DIRECT 标准化零售价[^\n]*/)?.[0] || '')
assert('容量缺失的DIRECT不混入标准化价格基准', normalizedFact.includes('有效 3/4；1 个DIRECT因容量/套装信息缺失或单位不一致未纳入'))
const missingUnitIntent = buildAmazonSearchIntent({ confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗' })
const missingUnitFact = buildComparableMarketFactBlock(missingUnitIntent, plan, normalizedSamples.samples, normalizedSamples.audit)
assert('本品零售单位缺失时不输出P25价格结论', missingUnitFact.includes('DIRECT 价格基准：待验证') && !missingUnitFact.includes('DIRECT 标准化零售价'))
const quickProfitFact = buildAmazonQuickMarketProfitFactBlock(normalizedIntent, normalizedSamples.samples, {
  purchaseCostUsd: 2,
  referralFeeRate: 15,
  fbaFulfillmentFeeUsd: 3,
  returnLossRate: 4,
  advertisingRate: 20,
  couponCostUsd: 1
})
assert('快速利润按标准化售价逐项扣除', quickProfitFact.includes('| P25（30ml） | $9.00 | $2.00 | $1.35 | $3.00 | $0.36 | $1.80 | $1.00 | -$0.51 | -5.7% |'), quickProfitFact)
assert('快速利润明确不等于全成本利润', quickProfitFact.includes('不含国内物流、头程、关税、清关、入仓、仓储及固定成本') && quickProfitFact.includes('不能视为全成本落地利润率'))
const incompleteQuickProfitFact = buildAmazonQuickMarketProfitFactBlock(normalizedIntent, normalizedSamples.samples, { purchaseCostUsd: 2, referralFeeRate: 15 })
assert('快速利润参数不完整时拒绝伪精确金额', incompleteQuickProfitFact.includes('快速市场利润率：待验证') && incompleteQuickProfitFact.includes('FBA履约费（USD）') && !incompleteQuickProfitFact.includes('| P25（30ml） |'))
const quickProfitInput = { purchaseCostUsd: 2, referralFeeRate: 15, fbaFulfillmentFeeUsd: 3, returnLossRate: 4, advertisingRate: 20, couponCostUsd: 1 }
const fullCostInput = {
  packagingQcUsd: { low: 0.3, base: 0.4, high: 0.5 },
  domesticFreightUsd: { low: 0.2, base: 0.3, high: 0.4 },
  firstLegFreightUsd: { low: 0.8, base: 1, high: 1.2 },
  dutyUsd: { low: 0.1, base: 0.2, high: 0.3 },
  customsClearanceUsd: { low: 0.1, base: 0.1, high: 0.2 },
  inboundUsd: { low: 0.2, base: 0.3, high: 0.4 },
  storageUsd: { low: 0.05, base: 0.1, high: 0.1 }
}
const fullCostFact = buildAmazonFullCostProfitFactBlock(normalizedIntent, normalizedSamples.samples, quickProfitInput, fullCostInput)
assert('全成本利润按售价与低基准高成本配对复算', fullCostFact.includes('| 悲观（高成本） | $9.00 | $9.51 | $3.10 | -$3.61 | -40.1% |') && fullCostFact.includes('| 基准（基准成本） | $10.00 | $9.90 | $2.40 | -$2.30 | -23.0% |') && fullCostFact.includes('| 乐观（低成本） | $10.00 | $9.90 | $1.75 | -$1.65 | -16.5% |'), fullCostFact)
assert('全成本报告列出所有区间成本并标记分析假设', fullCostFact.includes('包装/质检 $0.30 / $0.40 / $0.50') && fullCostFact.includes('国内物流 $0.20 / $0.30 / $0.40') && fullCostFact.includes('分析假设｜用户录入'))
const incompleteFullCostFact = buildAmazonFullCostProfitFactBlock(normalizedIntent, normalizedSamples.samples, quickProfitInput, { ...fullCostInput, inboundUsd: { low: 0.2, base: 0.3 } })
assert('全成本任一区间缺失时拒绝落地利润表', incompleteFullCostFact.includes('全成本落地利润率：待验证') && incompleteFullCostFact.includes('入仓') && !incompleteFullCostFact.includes('| 悲观（高成本） |'))
const unorderedFullCostFact = buildAmazonFullCostProfitFactBlock(normalizedIntent, normalizedSamples.samples, quickProfitInput, { ...fullCostInput, dutyUsd: { low: 0.4, base: 0.2, high: 0.3 } })
assert('全成本区间顺序错误时拒绝落地利润表', unorderedFullCostFact.includes('全成本落地利润率：待验证') && unorderedFullCostFact.includes('关税（低/基准/高顺序）') && !unorderedFullCostFact.includes('| 悲观（高成本） |'))

const marketWithSignals = classifyAmazonSamples(intent, samples.map(sample => ({ ...sample, salesVolume: sample.sponsored ? undefined : '100 bought in past month' })), { keywordsRequested: 3, keywordsSucceeded: 3 })
const entryInputs = { targetContributionMargin: 10, differentiationEvidence: '样品对比编号 SAMPLE-01：低敏无香配方。', complianceIpEvidence: '官方检索记录 COM-01：标签与商标待归档，未见硬风险。' }
const goDecision = evaluateAmazonEntryDecision(intent, marketWithSignals.samples, marketWithSignals.audit, quickProfitInput, fullCostInput, entryInputs)
assert('阶段5仅在全成本下行非负、证据和硬门禁齐全时建议入场', goDecision.decision === '✅ 建议入场' && (goDecision.downsideProfit || 0) >= 0 && (goDecision.baseMargin || 0) >= 10, JSON.stringify(goDecision))
const noGoDecision = evaluateAmazonEntryDecision(intent, marketWithSignals.samples, marketWithSignals.audit, quickProfitInput, { ...fullCostInput, storageUsd: { low: 0.05, base: 0.1, high: 5 } }, entryInputs)
assert('阶段5悲观利润为负时不建议入场', noGoDecision.decision === '❌ 不建议入场' && noGoDecision.reasons.some(item => item.includes('悲观情景')), JSON.stringify(noGoDecision))
const missingTargetDecision = evaluateAmazonEntryDecision(intent, marketWithSignals.samples, marketWithSignals.audit, quickProfitInput, fullCostInput, { ...entryInputs, targetContributionMargin: undefined })
assert('阶段5不假设公司利润门槛', missingTargetDecision.decision === '❓ 数据不足，不能判定' && missingTargetDecision.reasons.some(item => item.includes('目标贡献利润率')), JSON.stringify(missingTargetDecision))
const conditionalDecision = evaluateAmazonEntryDecision(intent, marketWithSignals.samples, marketWithSignals.audit, quickProfitInput, fullCostInput, { targetContributionMargin: 10 })
assert('阶段5缺少差异化或合规IP依据仅条件谨慎入场', conditionalDecision.decision === '⚠️ 有条件谨慎入场' && conditionalDecision.reasons.some(item => item.includes('差异化')), JSON.stringify(conditionalDecision))
const decisionFact = buildAmazonEntryDecisionFactBlock(intent, marketWithSignals.samples, marketWithSignals.audit, quickProfitInput, fullCostInput, entryInputs)
assert('阶段5事实块固定系统结论并禁止模型上调', decisionFact.includes('系统入场结论：✅ 建议入场') && decisionFact.includes('不得因样本数量、模型评分或销售话术自行上调结论'))
assert('阶段5拦截模型改写系统入场结论', validateAmazonEntryDecisionClaim('## 最终结论\n⚠️ 有条件谨慎入场', '✅ 建议入场').length === 1 && validateAmazonEntryDecisionClaim('## 最终结论\n✅ 建议入场', '✅ 建议入场').length === 0)
const prefilledEvidence = Object.fromEntries([
  'purchaseCostUsd', 'referralFeeRate', 'fbaFulfillmentFeeUsd', 'returnLossRate', 'advertisingRate', 'couponCostUsd',
  'packagingQcUsd.low', 'packagingQcUsd.base', 'packagingQcUsd.high',
  'domesticFreightUsd.low', 'domesticFreightUsd.base', 'domesticFreightUsd.high',
  'firstLegFreightUsd.low', 'firstLegFreightUsd.base', 'firstLegFreightUsd.high',
  'dutyUsd.low', 'dutyUsd.base', 'dutyUsd.high',
  'customsClearanceUsd.low', 'customsClearanceUsd.base', 'customsClearanceUsd.high',
  'inboundUsd.low', 'inboundUsd.base', 'inboundUsd.high', 'storageUsd.low', 'storageUsd.base', 'storageUsd.high',
  'targetContributionMargin', 'differentiationEvidence', 'complianceIpEvidence'
].map(key => [key, { decisionEligible: key !== 'fbaFulfillmentFeeUsd' && key !== 'firstLegFreightUsd.base' && key !== 'differentiationEvidence' && key !== 'complianceIpEvidence', origin: key === 'fbaFulfillmentFeeUsd' || key === 'firstLegFreightUsd.base' ? '暂缺填零' : '系统预设' }]))
assert('阶段5识别预填字段的不可决策状态', amazonProfitDecisionEvidenceIssues(prefilledEvidence).some(item => item.includes('FBA履约费')) && amazonProfitDecisionEvidenceIssues(prefilledEvidence).some(item => item.includes('头程（基准）')))
const prefilledDecision = evaluateAmazonEntryDecision(intent, marketWithSignals.samples, marketWithSignals.audit, quickProfitInput, fullCostInput, entryInputs, prefilledEvidence)
assert('阶段5阻止暂缺成本和待核验依据触发建议入场', prefilledDecision.decision === '❓ 数据不足，不能判定' && prefilledDecision.reasons.some(item => item.includes('暂缺填零')))
const prefilledQuickFact = buildAmazonQuickMarketProfitFactBlock(intent, marketWithSignals.samples, quickProfitInput, prefilledEvidence)
assert('快速利润不使用候选费用伪造复算结果', prefilledQuickFact.includes('快速市场利润率：待验证') && !prefilledQuickFact.includes('| P25（30ml） |'))
const prefilledFullFact = buildAmazonFullCostProfitFactBlock(intent, marketWithSignals.samples, quickProfitInput, fullCostInput, prefilledEvidence)
assert('全成本利润不使用暂缺填零伪造落地利润', prefilledFullFact.includes('全成本落地利润率：待验证') && !prefilledFullFact.includes('| 悲观（高成本） |'))

const incompleteSamples = samples.slice(0, 15).map((sample, index) => ({ ...sample, query: queries[index % 2], rating: null, reviews: null }))
const incomplete = classifyAmazonSamples(intent, incompleteSamples, { keywordsRequested: 3, keywordsSucceeded: 2 })
assert('15个DIRECT且仅2组词成功为中等置信度', incomplete.audit.directCount === 15 && incomplete.audit.confidence === '中等')
assert('字段缺失降低字段覆盖率', incomplete.audit.fieldCoveragePercent === 33)
assert('综合完整率按数量60%+词20%+字段20%加权', incomplete.audit.coveragePercent === 50, String(incomplete.audit.coveragePercent))
assert('缺少一组检索词或字段覆盖不足时不通过研究样本基线', !meetsAmazonResearchSampleBaseline(incomplete.audit))

const low = classifyAmazonSamples(intent, samples.slice(0, 3), { keywordsRequested: 3, keywordsSucceeded: 1 })
const badReport = [
  '# 测试报告',
  '- TOP50均价：$19.99',
  '- 月销量：12,000件',
  '## 最终结论',
  '✅ 建议入场'
].join('\n')
const issues = validateAmazonMarketClaims(badReport, low.audit)
assert('低置信度阻止伪TOP50数值', issues.some(issue => issue.includes('TOP50')))
assert('未抓取销量阻止精确销量数值', issues.some(issue => issue.includes('无证据数值')))
assert('研究样本基线不足阻止建议入场', issues.some(issue => issue.includes('研究样本基线未通过')))
const baselineWithoutSales = classifyAmazonSamples(intent, samples.slice(0, 15), { keywordsRequested: 3, keywordsSucceeded: 3 })
assert('样本基线通过但无购买信号时仍阻止建议入场', meetsAmazonResearchSampleBaseline(baselineWithoutSales.audit) && validateAmazonMarketClaims('✅ 建议入场', baselineWithoutSales.audit).some(issue => issue.includes('购买信号')))
const compliantReport = '- TOP50均价：待验证\n- 月销量：U，待验证\n❓ 数据不足，不能判定'
assert('明确待验证和数据不足结论允许通过', validateAmazonMarketClaims(compliantReport, low.audit).length === 0)
const methodologyAndOperations = '- 数据源：目标叶子类目TOP50、至少3个购买意图关键词\n- 补货条件：首月销量≥200件，ACOS≤20%'
assert('TOP50方法说明和补货阈值不误判为市场事实', validateAmazonMarketClaims(methodologyAndOperations, low.audit).length === 0)
const riskReviewThreshold = "| 风险预警 | 同质化加剧、Vet's Best推小容量、FBA政策变更 | 月销量增速<10%持续2月 | 立即复盘 |"
assert('风险预警中的未来复盘阈值不误判为已抓取销量趋势', validateAmazonMarketClaims(riskReviewThreshold, low.audit).length === 0)
const shortTermTestTarget = '| 短期（0–3月） | 补齐包装数据、小批量测试、切入Pet Shampoos类目 | 获取FBA费用、首月销量>100 | 待验证 |'
assert('短期计划中的首月销量目标不误判为历史销量事实', validateAmazonMarketClaims(shortTermTestTarget, low.audit).length === 0)
const estimatedMarketFacts = '- TOP50月销量：头部≈5,000件（外部估算）\n- 月销售额：约$1.1M（分析假设）\n- BSR/类目排名：#12（模型估算）'
const estimatedMarketIssues = validateAmazonMarketClaims(estimatedMarketFacts, complete.audit)
assert('估算或假设标签不能放行未抓取市场数值', estimatedMarketIssues.some(issue => issue.includes('TOP50')) && estimatedMarketIssues.some(issue => issue.includes('无证据数值')))
const sanitizedMarket = sanitizeAmazonMarketClaims(`${estimatedMarketFacts}\n\n| ASIN | 标题 | 月销量/销售额 | BSR/类目排名 | 评分/评论 |\n|---|---|---|---|---|\n| B012345678 | Sample | ≈1,200 / $19,000 | #12 | 4.5 / 500 |`)
assert('确定性市场降级仅清除未抓取指标', validateAmazonMarketClaims(sanitizedMarket, complete.audit).length === 0 && sanitizedMarket.includes('4.5 / 500') && !sanitizedMarket.includes('≈1,200'))
const explicitLimitation = '| 2 | DIRECT样本价格/评论 | 事实 | Amazon搜索页 | 2026-08-10 | 非完整TOP50 |'
assert('非完整TOP50限制说明不再误报', validateAmazonMarketClaims(explicitLimitation, complete.audit).length === 0)
const explicitCategoryLimitation = '| 2 | DIRECT样本价格/评分/评论 | 事实 | Amazon搜索页 | 2026-08-10 | 非完整类目TOP50 |'
assert('非完整类目TOP50限制说明不再误报', validateAmazonMarketClaims(explicitCategoryLimitation, complete.audit).length === 0)

const root = process.env.LISTING_REPO_ROOT || join(__dirname, '..')
const main = readFileSync(join(root, 'src/main/main.ts'), 'utf8')
const browser = readFileSync(join(root, 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const renderer = readFileSync(join(root, 'src/renderer/AIEmployee.tsx'), 'utf8')
const css = readFileSync(join(root, 'src/renderer/ai-employee.css'), 'utf8')
assert('API按配置页数循环抓取', main.includes('page <= settings.pages') && main.includes("url.searchParams.set('page', String(page))"))
assert('API跨页按ASIN去重并受最大样本数限制', main.includes('known.has(asin)') && main.includes('all.length >= settings.maxSamples'))
assert('API缓存读取配置的缓存时长', main.includes('settings.cacheHours * 3600 * 1000') && main.includes('cacheHit: true'))
assert('保存或清除配置会清空旧缓存', (main.match(/amazonDataSourceCache\.clear\(\)/g) || []).length >= 2)
assert('浏览器备用抓取使用相同页数/样本数/缓存时长', browser.includes('options: { pages?: number; maxSamples?: number; cacheHours?: number }') && browser.includes('page <= pages') && browser.includes('all.length < maxSamples'))
assert('渲染层把成功检索词数送入完整率计算', renderer.includes('keywordsSucceeded += 1') && renderer.includes('keywordsRequested: plan.keywords.length'))
assert('界面显示自然位、赞助位和三项覆盖率', renderer.includes('自然位') && renderer.includes('赞助位') && renderer.includes('样本完整率') && renderer.includes('核心字段覆盖'))
assert('报告返回后执行市场质量门禁', renderer.includes('validateAmazonMarketClaims(content, currentMarketAudit.audit)'))
assert('初次校验失败会自动修正一次', renderer.includes('【报告自动质量修正】') && renderer.includes('qualityIssues = validateReport(candidateContent)'))
assert('样本完整率有独立可见样式', css.includes('.ai-employee-market-audit-coverage'))

console.log(`RESULT  ${checks - failures}/${checks} passed`)
process.exit(failures === 0 ? 0 : 1)
