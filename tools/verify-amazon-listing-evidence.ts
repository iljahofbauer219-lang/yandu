#!/usr/bin/env node
import { createSelectionReportPayload, validateSelectionReportPayload } from '../src/shared/selectionReportPayload'
import type { AmazonListingEvidence, AmazonReviewEvidence, ClassifiedAmazonMarketSample } from '../src/shared/amazonScraper'

let failures = 0
function assert(label: string, ok: boolean): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

const samples: ClassifiedAmazonMarketSample[] = Array.from({ length: 5 }, (_, index) => ({
  asin: `B0E${String(index).padStart(7, '0')}`,
  title: `Pet Bitter Apple Spray ${index}`,
  price: 12 + index,
  rating: 4.2,
  reviews: 100 + index,
  comparisonClass: 'DIRECT',
  comparisonReason: '同一核心用途、同一喷雾形态、同一猫狗对象'
}))
const listingEvidence: AmazonListingEvidence[] = samples.map((sample, index) => ({
  asin: sample.asin,
  url: `https://www.amazon.com/dp/${sample.asin}`,
  capturedAt: '2026-08-18T08:00:00.000Z',
  source: 'browser',
  title: sample.title,
  brand: `Brand ${index}`,
  price: 14.99 + index,
  rating: 4.6,
  reviews: 300 + index,
  bsr: `#${index + 1} in Pet Supplies`,
  badges: ["Amazon's Choice"],
  bulletPoints: ['Bitter taste spray for dogs and cats', 'Easy no-chew training application'],
  coupon: 'Save 10%',
  subscribeSave: null,
  variantSummary: 'Size: 8 fl oz',
  seller: 'Amazon.com',
  operations: ['优惠券：Save 10%', '变体：Size: 8 fl oz', "徽标：Amazon's Choice"]
}))
const reviewEvidence: AmazonReviewEvidence[] = samples.slice(0, 5).map((sample, index) => ({
  asin: sample.asin,
  url: `https://www.amazon.com/product-reviews/${sample.asin}?pageNumber=1`,
  capturedAt: '2026-08-18T08:00:00.000Z',
  source: 'browser',
  snippets: [{ rating: 4, title: `Review title ${index}`, body: `Visible review body ${index}` }]
}))

const payload = createSelectionReportPayload({
  info: { title: '宠物苦苹果喷雾', url: 'https://detail.1688.com/offer/1.html', confirmedProductName: '宠物苦苹果喷雾', confirmedProductForm: '喷雾' },
  targetPlatform: 'Amazon美国站',
  samples,
  listingEvidence,
  reviewEvidence
})
const stores = payload.sections.flatMap(section => section.tables).find(table => table.id === 'top-stores')
assert('详情页证据事实包结构通过校验', validateSelectionReportPayload(payload).length === 0)
assert('头部竞店至少回填五个DIRECT样本', (stores?.rows.length || 0) === 5)
assert('每行回填品牌、价格、评分评论', Boolean(stores?.rows.every(row => /^Brand /.test(row[0]) && /^\$/.test(row[2]) && /^4\.6\/30\d$/.test(row[3]))))
assert('每行回填流量线索、差异化卖点、运营动作', Boolean(stores?.rows.every(row => row[4].includes('Pet Supplies') && row[5].includes('Bitter taste') && row[6].includes('优惠券'))))
assert('每行保留详情页URL与采集日期', Boolean(stores?.rows.every(row => row[7].includes('https://www.amazon.com/dp/') && row[7].includes('2026-08-18'))))
assert('评论页样本保留原文、URL与采集日期', Boolean(stores?.rows.slice(0, 5).every(row => row[7].includes('https://www.amazon.com/product-reviews/') && row[7].includes('Review title'))))
const core = payload.sections.flatMap(section => section.tables).find(table => table.id === 'core-competitors')
assert('核心竞品表展示评论原文样本但不外推结论', Boolean(core?.rows.some(row => row.some(cell => cell.includes('评论样本：Review title')) && row.includes('详情页卖点与评论页原文样本；不得外推为高频结论'))))
if (failures) process.exitCode = 1
