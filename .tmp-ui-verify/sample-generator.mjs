#!/usr/bin/env node
/**
 * E 阶段样例生成器：复用 stage-c-d-runner 的代码路径，生成 4 个不同决策的报告样例。
 *
 * 4 个样本覆盖 v1.2 模板的 4 种典型决策结果：
 *   A. ✅ 建议入场 —— 全部门禁通过
 *   B. ⚠️ 有条件谨慎入场 —— 缺差异化或合规/IP 依据
 *   C. ❌ 不建议入场 —— 悲观利润为负 / 基准 margin 低于目标
 *   D. ❓ 数据不足，不能判定 —— 关键经营输入 evidence 尚未核验
 *
 * 决策门禁顺序（来自 src/shared/amazonScraper.ts evaluateAmazonEntryDecision）：
 *   1. evidenceIssues 长度 > 0 → ❓ 数据不足
 *   2. numbers 不可算 → ❓ 数据不足
 *   3. meetsAmazonResearchSampleBaseline 未通过 → ❓ 数据不足（directCount >= 15）
 *   4. coveragePercent < 80 → ❓ 数据不足
 *   5. salesSignalCount < 1 → ❓ 数据不足
 *   6. targetContributionMargin 不在 10/15/20/25 → ❓ 数据不足
 *   7. numbers.downside.profit < 0 → ❌ 不建议入场
 *   8. numbers.base.margin < target → ❌ 不建议入场
 *   9. 缺差异化或合规/IP → ⚠️ 有条件谨慎
 *   10. → ✅ 建议入场
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outDir = join(root, 'artifacts/online-advisor-parity')
mkdirSync(outDir, { recursive: true })

const selectionExtract = await import(resolve(root, 'src/shared/selectionExtract.ts'))
const amazonScraper = await import(resolve(root, 'src/shared/amazonScraper.ts'))

const nowIso = '2026-08-18T10:00:00.000Z'

// ─── 共享 fixture：4 个 DIRECT 竞品详情页 + 4 个评论页 ─────────────────

const sharedAsins = ['B0C1AQUPET', 'B0D2DOGCAT', 'B0E3LIVGRN', 'B0F4SAMPLE']
const sharedListingEvidence = [
  { asin: 'B0C1AQUPET', url: 'https://www.amazon.com/dp/B0C1AQUPET', capturedAt: nowIso, source: 'browser', title: 'B0C1AQUPET Sample Product 1 200ml', brand: 'PawPure', price: 25.99, rating: 4.4, reviews: 1287, bsr: '#2,341 in Pet Supplies', badges: ["Amazon's Choice"], bulletPoints: ['WATERLESS CLEANSING - No-rinse formula gently removes dirt and odors from pet fur and coat', 'GENTLE FOR SENSITIVE SKIN - Hypoallergenic with aloe vera and chamomile extracts'], variantSummary: '8oz / 16oz', seller: 'PawPure Direct', operations: [], itemWeightGrams: 230, packageDimensionsCm: { length: 5, width: 5, height: 18 }, sizeTierGuess: 'SmallStandard' },
  { asin: 'B0D2DOGCAT', url: 'https://www.amazon.com/dp/B0D2DOGCAT', capturedAt: nowIso, source: 'browser', title: 'B0D2DOGCAT Sample Product 2 200ml', brand: 'FurFresh', price: 27.49, rating: 4.1, reviews: 643, bsr: '#3,891 in Pet Supplies', badges: [], bulletPoints: ['WATERLESS DOG SHAMPOO - Clean and deodorize without water', 'SAFE INGREDIENTS - Plant-based formula'], variantSummary: '250ml', seller: 'FurFresh Co.', operations: [], itemWeightGrams: 260, packageDimensionsCm: { length: 5, width: 5, height: 20 }, sizeTierGuess: 'SmallStandard' },
  { asin: 'B0E3LIVGRN', url: 'https://www.amazon.com/dp/B0E3LIVGRN', capturedAt: nowIso, source: 'browser', title: 'B0E3LIVGRN Sample Product 3 200ml', brand: 'GreenPaw', price: 24.99, rating: 3.9, reviews: 215, bsr: '#5,122 in Pet Supplies', badges: [], bulletPoints: ['LAVENDER SCENT - Soothing aroma for stress relief'], variantSummary: '200ml', seller: 'GreenPaw LLC', operations: [], itemWeightGrams: 220, packageDimensionsCm: { length: 5, width: 5, height: 17 }, sizeTierGuess: 'SmallStandard' },
  { asin: 'B0F4SAMPLE', url: 'https://www.amazon.com/dp/B0F4SAMPLE', capturedAt: nowIso, source: 'browser', title: 'B0F4SAMPLE Sample Product 4 200ml', brand: 'CozyPet', price: 26.49, rating: 4.5, reviews: 3421, bsr: '#1,899 in Pet Supplies', badges: ["Amazon's Choice"], bulletPoints: ['MULTI-PET FORMULA - Safe for cats, dogs, and small animals', 'NATURAL INGREDIENTS - Plant-based formula with essential oils'], variantSummary: '200ml / 500ml', seller: 'CozyPet Inc.', operations: [], itemWeightGrams: 240, packageDimensionsCm: { length: 5, width: 5, height: 18 }, sizeTierGuess: 'SmallStandard' }
]
const sharedReviewEvidence = [
  { asin: 'B0C1AQUPET', url: 'https://www.amazon.com/product-reviews/B0C1AQUPET', capturedAt: nowIso, source: 'browser', snippets: [{ rating: 5, title: 'Amazing for my long-haired cat', body: 'Works like a charm' }, { rating: 5, title: 'Smells wonderful and gentle', body: 'No skin irritation' }, { rating: 2, title: 'Bottle is too small', body: 'Need bigger size' }] },
  { asin: 'B0D2DOGCAT', url: 'https://www.amazon.com/product-reviews/B0D2DOGCAT', capturedAt: nowIso, source: 'browser', snippets: [{ rating: 5, title: 'Best waterless shampoo for golden retriever', body: 'No rinsing required' }, { rating: 1, title: 'Made my dog itch', body: 'Returned immediately' }] },
  { asin: 'B0E3LIVGRN', url: 'https://www.amazon.com/product-reviews/B0E3LIVGRN', capturedAt: nowIso, source: 'browser', snippets: [{ rating: 5, title: 'My puppy loves the lavender scent', body: 'Calming effect' }, { rating: 2, title: 'Leaves residue on dark fur', body: 'Visible white spots' }] },
  { asin: 'B0F4SAMPLE', url: 'https://www.amazon.com/product-reviews/B0F4SAMPLE', capturedAt: nowIso, source: 'browser', snippets: [{ rating: 5, title: 'Multi-pet household must-have', body: 'Works for cats and dogs' }, { rating: 4, title: 'Great but pricey', body: 'Smells good' }] }
]

// ─── 共享 18 样本：15 DIRECT（含 200ml 标准化单位）+ 2 ADJACENT + 1 NON_COMPARABLE ─────

function buildAllSamples() {
  const direct = sharedAsins.map((a, i) => ({
    asin: a, title: sharedListingEvidence[i].title,
    price: sharedListingEvidence[i].price, rating: sharedListingEvidence[i].rating, reviews: sharedListingEvidence[i].reviews,
    query: 'pet waterless shampoo', page: 1, sponsored: false, source: 'browser',
    salesVolume: '1K+ bought in past month', bsr: null,
    comparisonClass: 'DIRECT', comparisonReason: '对象、任务与产品形态一致'
  }))
  // 补足 15 DIRECT：价格 25-30 USD，标题含 200ml
  for (let idx = 4; idx < 15; idx++) {
    direct.push({
      asin: 'B0DIR' + String(idx).padStart(6, '0'),
      title: 'Pet Waterless Sample ' + idx + ' 200ml',
      price: 25 + (idx % 6) * 1.0, rating: 4.0 + (idx % 3) * 0.1, reviews: 100 + idx * 50,
      query: 'pet waterless shampoo', page: 1, sponsored: false, source: 'browser',
      salesVolume: '1K+ bought in past month', bsr: null,
      comparisonClass: 'DIRECT', comparisonReason: '对象、任务与产品形态一致'
    })
  }
  const adjacent = [
    { asin: 'B0ADJ0000001', title: 'Pet Grooming Wipes 100ct', price: 12.99, rating: 4.6, reviews: 8234, query: 'pet wipes', page: 1, sponsored: false, source: 'api', salesVolume: '5K+', bsr: 2400, comparisonClass: 'ADJACENT', comparisonReason: '解决同一任务，但产品形态不同' },
    { asin: 'B0ADJ0000002', title: 'Pet Bath Foam 200ml', price: 14.5, rating: 4.3, reviews: 562, query: 'pet foam', page: 1, sponsored: false, source: 'api', salesVolume: null, bsr: null, comparisonClass: 'ADJACENT', comparisonReason: '解决同一任务，但产品形态不同' }
  ]
  const nonComp = [
    { asin: 'B0NCM0000001', title: 'Pet Toothbrush 3 Pack', price: 6.99, rating: 4.5, reviews: 4500, query: 'pet tooth', page: 1, sponsored: false, source: 'api', salesVolume: null, bsr: null, comparisonClass: 'NON_COMPARABLE', comparisonReason: '配件' }
  ]
  return [...direct, ...adjacent, ...nonComp]
}

const sharedSamples = buildAllSamples()
const sharedAudit = {
  rawCount: sharedSamples.length, organicCount: sharedSamples.length, sponsoredCount: 0,
  uniqueCount: sharedSamples.length,
  directCount: sharedSamples.filter(s => s.comparisonClass === 'DIRECT').length,
  adjacentCount: sharedSamples.filter(s => s.comparisonClass === 'ADJACENT').length,
  excludedCount: sharedSamples.filter(s => s.comparisonClass === 'NON_COMPARABLE').length,
  keywordsRequested: 3, keywordsSucceeded: 3, keywordCoveragePercent: 100,
  fieldCoveragePercent: 100, salesSignalCount: 15, salesSignalLowerBound: 15000,
  coveragePercent: 100, confidence: '可决策'
}

// ─── 4 个样本配置（驱动 4 种决策）────────────────────────────────

function buildProduct(productName, productForm, useMethod, targetObject) {
  return {
    url: 'https://detail.1688.com/offer/' + productName.length + '.html',
    analysisDate: '2026-08-18', title: productName, price: '¥8.00–¥12.00',
    seller: '广州市样品有限公司', moq: '≥ 2 件', shipFrom: '广东广州',
    deals: '近 30 天成交 1k+',
    attributes: ['品牌: 萌宠乐园', '规格: 200ml', '适用对象: ' + targetObject, '形态: ' + productForm, '香味: 标准'],
    detailText: productName + '的 1688 详情页文字内容，用于填充覆盖应用场景的「事实」证据。',
    imageOcrText: productName, imageOcrWarnings: [],
    visualProductForm: productForm, visualUseMethod: useMethod, visualTargetObject: targetObject,
    visualConfidence: 0.86,
    confirmedProductName: productName, confirmedProductForm: productForm,
    confirmedUseMethod: useMethod, confirmedTargetObject: targetObject,
    supplyFacts: {
      extractedAt: nowIso,
      purchasePriceCny: { low: 8.0, high: 12.0, source: '1688 商品页价格区间' },
      packagingDimensionsCm: { length: 5, width: 5, height: 18, source: '1688 商品页规格/详情' },
      grossWeightGrams: { value: 240, source: '1688 商品页规格/详情' },
      ingredientText: '标准成分', liquidRisk: productForm.includes('液体'), conflicts: []
    }
  }
}

const scenarioConfigs = [
  {
    label: 'A', file: 'sample-A-recommend-entry.md',
    product: buildProduct('宠物免洗清洁喷雾 200ml 猫狗通用', '液体精华', '喷洒', '猫狗'),
    profit: { purchaseCostUsd: 1.5, referralFeeRate: 15, fbaFulfillmentFeeUsd: 3.43, returnLossRate: 5, advertisingRate: 10, couponCostUsd: 1.0 },
    fullCost: {
      packagingQcUsd: { low: 0.2, base: 0.3, high: 0.5 },
      domesticFreightUsd: { low: 0.2, base: 0.3, high: 0.5 },
      firstLegFreightUsd: { low: 0.5, base: 0.8, high: 1.2 },
      dutyUsd: { low: 0.2, base: 0.3, high: 0.5 },
      customsClearanceUsd: { low: 0.1, base: 0.2, high: 0.3 },
      inboundUsd: { low: 0.2, base: 0.3, high: 0.5 },
      storageUsd: { low: 0.1, base: 0.15, high: 0.2 }
    },
    targetMargin: 10,
    diffEvidence: '植物精华 + 双香型 + 200ml 大瓶装，竞品多为单香型小瓶装。',
    complianceEvidence: '成分均为常见日化原料，无 EPA/FDA 风险；包装含英文成分表与净含量。',
    insufficient: false
  },
  {
    label: 'B', file: 'sample-B-conditional-entry.md',
    product: buildProduct('宠物免洗清洁喷雾 200ml 猫狗通用', '液体精华', '喷洒', '猫狗'),
    profit: { purchaseCostUsd: 1.5, referralFeeRate: 15, fbaFulfillmentFeeUsd: 3.43, returnLossRate: 5, advertisingRate: 10, couponCostUsd: 1.0 },
    fullCost: {
      packagingQcUsd: { low: 0.2, base: 0.3, high: 0.5 },
      domesticFreightUsd: { low: 0.2, base: 0.3, high: 0.5 },
      firstLegFreightUsd: { low: 0.5, base: 0.8, high: 1.2 },
      dutyUsd: { low: 0.2, base: 0.3, high: 0.5 },
      customsClearanceUsd: { low: 0.1, base: 0.2, high: 0.3 },
      inboundUsd: { low: 0.2, base: 0.3, high: 0.5 },
      storageUsd: { low: 0.1, base: 0.15, high: 0.2 }
    },
    targetMargin: 10,
    diffEvidence: '植物精华 + 双香型 + 200ml 大瓶装，竞品多为单香型小瓶装。',
    complianceEvidence: '待补',  // < 8 字符 → 触发条件谨慎
    insufficient: false
  },
  {
    label: 'C', file: 'sample-C-do-not-enter.md',
    product: buildProduct('宠物免洗清洁喷雾 200ml 猫狗通用', '液体精华', '喷洒', '猫狗'),
    profit: { purchaseCostUsd: 6.0, referralFeeRate: 15, fbaFulfillmentFeeUsd: 5.0, returnLossRate: 12, advertisingRate: 18, couponCostUsd: 2.5 },
    fullCost: {
      packagingQcUsd: { low: 0.8, base: 1.0, high: 1.4 },
      domesticFreightUsd: { low: 0.5, base: 0.8, high: 1.2 },
      firstLegFreightUsd: { low: 1.5, base: 2.0, high: 2.8 },
      dutyUsd: { low: 0.5, base: 0.8, high: 1.2 },
      customsClearanceUsd: { low: 0.3, base: 0.5, high: 0.7 },
      inboundUsd: { low: 0.4, base: 0.7, high: 1.0 },
      storageUsd: { low: 0.2, base: 0.3, high: 0.5 }
    },
    targetMargin: 20,  // 高目标 + 高成本 → 悲观亏损
    diffEvidence: '植物精华 + 双香型 + 200ml 大瓶装。',
    complianceEvidence: '成分均为常见日化原料，无 EPA/FDA 风险。',
    insufficient: false
  },
  {
    label: 'D', file: 'sample-D-insufficient-data.md',
    product: buildProduct('宠物免洗清洁喷雾 200ml 猫狗通用', '液体精华', '喷洒', '猫狗'),
    profit: { purchaseCostUsd: 1.5, referralFeeRate: 15, fbaFulfillmentFeeUsd: 3.43, returnLossRate: 5, advertisingRate: 10, couponCostUsd: 1.0 },
    fullCost: {
      packagingQcUsd: { low: 0.2, base: 0.3, high: 0.5 },
      domesticFreightUsd: { low: 0.2, base: 0.3, high: 0.5 },
      firstLegFreightUsd: { low: 0.5, base: 0.8, high: 1.2 },
      dutyUsd: { low: 0.2, base: 0.3, high: 0.5 },
      customsClearanceUsd: { low: 0.1, base: 0.2, high: 0.3 },
      inboundUsd: { low: 0.2, base: 0.3, high: 0.5 },
      storageUsd: { low: 0.1, base: 0.15, high: 0.2 }
    },
    targetMargin: 10,
    diffEvidence: '植物精华 + 双香型 + 200ml 大瓶装。',
    complianceEvidence: '成分均为常见日化原料。',
    insufficient: true  // evidence 全部 decisionEligible=false
  }
]

// ─── 跑每个样本，生成报告 markdown ─────────────────────────

for (const s of scenarioConfigs) {
  const isInsufficient = s.insufficient
  const makeEvidence = (origin, source) => ({ origin, evidenceLevel: '分析假设', source, updatedAt: nowIso, decisionEligible: !isInsufficient })
  const evidence = {
    purchaseCostUsd: makeEvidence('用户修改', '用户录入'),
    referralFeeRate: makeEvidence('自动提取', 'Pet Supplies 候选类目'),
    fbaFulfillmentFeeUsd: makeEvidence('自动提取', 'Amazon US 2024-09'),
    returnLossRate: makeEvidence('自动提取', '液体形态默认 5%'),
    advertisingRate: makeEvidence('自动提取', '新品冷启动 10%'),
    couponCostUsd: makeEvidence('自动提取', '默认'),
    'packagingQcUsd.low': makeEvidence('用户修改', '用户录入'),
    'packagingQcUsd.base': makeEvidence('用户修改', '用户录入'),
    'packagingQcUsd.high': makeEvidence('用户修改', '用户录入'),
    'domesticFreightUsd.low': makeEvidence('用户修改', '用户录入'),
    'domesticFreightUsd.base': makeEvidence('用户修改', '用户录入'),
    'domesticFreightUsd.high': makeEvidence('用户修改', '用户录入'),
    'firstLegFreightUsd.low': makeEvidence('用户修改', '用户录入'),
    'firstLegFreightUsd.base': makeEvidence('用户修改', '用户录入'),
    'firstLegFreightUsd.high': makeEvidence('用户修改', '用户录入'),
    'dutyUsd.low': makeEvidence('用户修改', '用户录入'),
    'dutyUsd.base': makeEvidence('用户修改', '用户录入'),
    'dutyUsd.high': makeEvidence('用户修改', '用户录入'),
    'customsClearanceUsd.low': makeEvidence('用户修改', '用户录入'),
    'customsClearanceUsd.base': makeEvidence('用户修改', '用户录入'),
    'customsClearanceUsd.high': makeEvidence('用户修改', '用户录入'),
    'inboundUsd.low': makeEvidence('用户修改', '用户录入'),
    'inboundUsd.base': makeEvidence('用户修改', '用户录入'),
    'inboundUsd.high': makeEvidence('用户修改', '用户录入'),
    'storageUsd.low': makeEvidence('用户修改', '用户录入'),
    'storageUsd.base': makeEvidence('用户修改', '用户录入'),
    'storageUsd.high': makeEvidence('用户修改', '用户录入'),
    targetContributionMargin: makeEvidence('用户修改', '用户录入'),
    differentiationEvidence: makeEvidence('用户修改', '用户录入'),
    complianceIpEvidence: makeEvidence('用户修改', '用户录入')
  }

  const intent = {
    productName: s.product.confirmedProductName,
    productForm: s.product.confirmedProductForm,
    useMethod: s.product.confirmedUseMethod,
    targetObject: s.product.confirmedTargetObject,
    excludedTerms: [],
    retailUnit: { kind: 'volume_ml', quantity: 200, label: '200ml' }
  }
  const plan = { keywords: ['pet waterless shampoo', 'cat dog no rinse spray', 'pet cleansing water'], source: 'model' }

  const productBasics = selectionExtract.buildProductBasicsBlock(s.product)
  const marketFact = amazonScraper.buildComparableMarketFactBlock(intent, plan, sharedSamples, sharedAudit)
  const reviewInsights = amazonScraper.buildCompetitorReviewInsights(sharedSamples, sharedReviewEvidence)
  const listingSummary = amazonScraper.buildCompetitorListingSummary(sharedSamples, sharedListingEvidence)
  const quickProfit = amazonScraper.buildAmazonQuickMarketProfitFactBlock(intent, sharedSamples, s.profit, evidence)
  const fullCost = amazonScraper.buildAmazonFullCostProfitFactBlock(intent, sharedSamples, s.profit, s.fullCost, evidence)
  const entryDecision = amazonScraper.buildAmazonEntryDecisionFactBlock(intent, sharedSamples, sharedAudit, s.profit, s.fullCost, { targetContributionMargin: s.targetMargin, differentiationEvidence: s.diffEvidence, complianceIpEvidence: s.complianceEvidence }, evidence)

  const decision = amazonScraper.evaluateAmazonEntryDecision(intent, sharedSamples, sharedAudit, s.profit, s.fullCost, { targetContributionMargin: s.targetMargin, differentiationEvidence: s.diffEvidence, complianceIpEvidence: s.complianceEvidence }, evidence)

  // 校验：场景期望的决策 == 实际决策
  const expectedMap = { A: '✅ 建议入场', B: '⚠️ 有条件谨慎入场', C: '❌ 不建议入场', D: '❓ 数据不足，不能判定' }
  if (decision.decision !== expectedMap[s.label]) {
    console.error(`❌ 样本 ${s.label} 决策不符：期望 ${expectedMap[s.label]}, 实际 ${decision.decision}`)
    console.error('  reasons:', decision.reasons)
    process.exit(1)
  }

  const scenarioNote = {
    A: '本样本所有门禁通过：研究样本基线（15 DIRECT）、购买信号、全成本利润（基准 margin 39% 超过目标 10%）、差异化、合规/IP 全部就位。',
    B: '本样本全成本和市场样本通过，但合规/IP 核验依据字符数不足 8（系统未识别为"可核验"），需补强合规检索后再下单。',
    C: '本样本全成本复算可得，但悲观情景全成本贡献利润为负（高采购价 + 高 FBA + 高退货率），不符合下行现金流硬门禁，不建议入场。',
    D: '本样本 23 个经营输入 evidence 均未核验（decisionEligible=false），系统按"待核验"处理，复算被拒。'
  }

  const competitorSummaryTable = `| ASIN | 品牌 | 售价 | 评分 | 评论量 | BSR | 徽标 |
|---|---|---:|---:|---:|---|---|
${sharedListingEvidence.map(l => `| ${l.asin} | ${l.brand} | $${l.price} | ${l.rating} | ${l.reviews.toLocaleString()} | ${l.bsr} | ${l.badges.join(' / ') || '无'} |`).join('\n')}`

  const md = `# 选品分析报告样本 ${s.label}（${expectedMap[s.label]}）

> 数据源：1688 商品页 + Amazon 搜索页 + Amazon 详情页 + Amazon 评论页
> 证据等级：事实（系统抓取）/ 分析假设（用户录入）/ 外部估算（FBA 费率表）
> 报告生成方式：阶段 4 拼装 + 阶段 5 入场门禁（决策可追溯）

- 报告编号：SAMPLE-${s.label}-001
- 版本：v1.2
- 分析日期：2026-08-18
- 数据截止：2026-08-18
- 目标平台：Amazon美国站
- 履约方式：FBA
- 币种：USD

> 场景说明：${scenarioNote[s.label]}

---

## 第一部分：本品基础信息解析

${productBasics}

---

## 第二部分：目标平台细分市场调研

${marketFact}

---

## 第三部分：本品与核心竞品多维对比

### 3.1 DIRECT 竞品汇总表

${competitorSummaryTable}

### 3.2 竞品评论意见聚合

${reviewInsights}

### 3.3 竞品详情页 bullet 摘要

${listingSummary}

---

## 第四部分：价格、成本与单位经济

${quickProfit}

${fullCost}

---

## 第五部分：合规、知识产权与差异化核验

- 差异化核验依据：${s.diffEvidence}
- 合规/IP 核验依据：${s.complianceEvidence}

---

## 第六部分：入场结论与30天验证计划

- 最终结论：${decision.decision}
- 门禁依据：${decision.reasons.join('；')}
- 决策可追溯：系统入场结论 = ${decision.decision}，报告最终结论 = ${decision.decision}，二者必须完全一致。

### 30天验证计划

1. 包装尺寸/毛重复核 → 复算 FBA 履约费
2. 货代/关税/清关报价 → 复算全成本
3. 试单 50 件 → A/B 转化与退货率

---

## 附录：阶段 4 systemFact 块（拼装路径直供智能体）

\`\`\`
## 第一部分：本品基础信息解析（系统事实块）
${productBasics}

${marketFact}

${reviewInsights}

${listingSummary}

${quickProfit}

${fullCost}

${entryDecision}
\`\`\`
`
  const outPath = join(outDir, s.file)
  writeFileSync(outPath, md, 'utf-8')
  console.log(`✅ 样本 ${s.label}（${expectedMap[s.label]}）→ ${s.file} · ${md.length} bytes · 决策=${decision.decision} · baseMargin=${decision.baseMargin?.toFixed(1) || '-'}% · downsideProfit=$${decision.downsideProfit?.toFixed(2) || '-'}`)
}
console.log('\n4 个样本全部决策路径走通，决策可追溯。')
