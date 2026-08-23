#!/usr/bin/env node
/**
 * 阶段 3+：Amazon 详情页 Item Weight / Package Dimensions 解析 + FBA Size Tier 推断回归。
 * 直接调用 helper，不依赖 jsdom；保证证据来源、计量单位和档位都符合 Amazon US 2024-09 规则。
 */
import { AMAZON_LISTING_EVIDENCE_SCRIPT, determineAmazonSizeTier, parseAmazonItemWeightGrams, parseAmazonPackageDimensionsCm, type AmazonListingEvidence } from '../src/shared/amazonScraper'

let failures = 0
const assert = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ─── 1. 重量单位换算 ─────────────────────────────────────────────
assert('ounces → 克', parseAmazonItemWeightGrams('4 ounces') === 113)
assert('pounds → 克', parseAmazonItemWeightGrams('1.2 pounds') === 544)
assert('grams 直接读取', parseAmazonItemWeightGrams('250 grams') === 250)
assert('kilograms → 克', parseAmazonItemWeightGrams('0.5 kilograms') === 500)
assert('千分位逗号 oz', parseAmazonItemWeightGrams('1,500 oz') === 42524)
assert('空字符串返回 null', parseAmazonItemWeightGrams('') === null)
assert('非法文本返回 null', parseAmazonItemWeightGrams('约 250 克') === null)
assert('零或负数返回 null', parseAmazonItemWeightGrams('0 oz') === null)

// ─── 2. 尺寸单位换算 ─────────────────────────────────────────────
const dim1 = parseAmazonPackageDimensionsCm('8.5 x 6.5 x 2.5 inches')
assert('inches → 厘米（L×W×H）', dim1?.length === 21.59 && dim1.width === 16.51 && dim1.height === 6.35, JSON.stringify(dim1))
const dim2 = parseAmazonPackageDimensionsCm('10 × 8 × 3 cm')
assert('cm 直接读取', dim2?.length === 10 && dim2.width === 8 && dim2.height === 3, JSON.stringify(dim2))
const dim3 = parseAmazonPackageDimensionsCm('4.7 x 3.2 x 0.6 inches')
assert('小尺寸换算', dim3?.length === 11.94 && dim3.height === 1.52, JSON.stringify(dim3))
assert('无法解析时返回 null', parseAmazonPackageDimensionsCm('平装') === null)

// ─── 3. FBA Size Tier 推断 ───────────────────────────────────────
assert('SmallStandard ≤4 oz + 小尺寸', determineAmazonSizeTier(100, { length: 10, width: 6, height: 1 }) === 'SmallStandard')
assert('SmallStandard 4-6 oz', determineAmazonSizeTier(150, { length: 10, width: 6, height: 1 }) === 'SmallStandard')
assert('LargeStandard ≤1 lb + ≤18×14×8 in', determineAmazonSizeTier(400, { length: 30, width: 20, height: 5 }) === 'LargeStandard')
assert('LargeStandard 1-1.5 lb', determineAmazonSizeTier(600, { length: 35, width: 25, height: 5 }) === 'LargeStandard')
assert('LargeBulky >1 lb + 超过 LargeStandard 尺寸', determineAmazonSizeTier(2000, { length: 80, width: 60, height: 40 }) === 'LargeBulky')
assert('ExtraLarge >70 lb', determineAmazonSizeTier(35000, { length: 60, width: 50, height: 30 }) === 'ExtraLarge')
assert('缺重量返回 null', determineAmazonSizeTier(null, { length: 10, width: 6, height: 1 }) === null)
assert('超尺寸 LargeStandard 不命中', determineAmazonSizeTier(400, { length: 80, width: 60, height: 40 }) === null)

// ─── 4. 注入脚本包含新 helper ───────────────────────────────────
const script = AMAZON_LISTING_EVIDENCE_SCRIPT
assert('AMAZON_LISTING_EVIDENCE_SCRIPT 包含 sizeTierGuess 字段', script.includes('sizeTierGuess'))
assert('AMAZON_LISTING_EVIDENCE_SCRIPT 抓取 itemWeightGrams', script.includes('itemWeightGrams'))
assert('AMAZON_LISTING_EVIDENCE_SCRIPT 抓取 packageDimensionsCm', script.includes('packageDimensionsCm'))
assert('AMAZON_LISTING_EVIDENCE_SCRIPT 包含 Item Weight 关键词', script.includes('Item\\s*Weight'))
assert('AMAZON_LISTING_EVIDENCE_SCRIPT 包含 Package Dimensions 关键词', script.includes('Package\\s*Dimensions'))

// ─── 5. 类型契约：AmazonListingEvidence 新字段必须出现在接口 ───
const evidenceShape: AmazonListingEvidence = {
  asin: 'B0E00000001',
  url: 'https://www.amazon.com/dp/B0E00000001',
  capturedAt: '2026-08-18T00:00:00.000Z',
  source: 'browser',
  badges: [],
  bulletPoints: [],
  operations: [],
  itemWeightGrams: 200,
  packageDimensionsCm: { length: 10, width: 8, height: 3 },
  sizeTierGuess: 'LargeStandard'
}
assert('证据对象支持 itemWeightGrams/packageDimensionsCm/sizeTierGuess', evidenceShape.itemWeightGrams === 200 && evidenceShape.packageDimensionsCm?.length === 10 && evidenceShape.sizeTierGuess === 'LargeStandard')

if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nALL PASS')
