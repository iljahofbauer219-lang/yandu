#!/usr/bin/env node
import { parseSelectionReportEnrichment, selectionReportEnrichmentPrompt } from '../src/shared/selectionReportEnrichment'
import { createSelectionReportPayload } from '../src/shared/selectionReportPayload'
import { renderSelectionReportMarkdown, validateRenderedSelectionReport } from '../src/shared/selectionReportRenderer'

let failures = 0
function assert(label: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }

const payload = createSelectionReportPayload({
  info: { title: '宠物免洗擦浴精华', confirmedProductName: '宠物免洗擦浴精华', url: 'https://detail.1688.com/offer/phase6.html' },
  targetPlatform: 'Amazon美国站',
  samples: [{ asin: 'B0TEST0001', title: 'Waterless Pet Cleanser', price: 14.99, rating: 4.6, reviews: 300, comparisonClass: 'DIRECT', comparisonReason: '同一核心用途、形态和对象' }],
  listingEvidence: [{ asin: 'B0TEST0001', url: 'https://www.amazon.com/dp/B0TEST0001', capturedAt: '2026-08-18T08:00:00.000Z', source: 'browser', title: 'Waterless Pet Cleanser', brand: 'Test Brand', price: 14.99, rating: 4.6, reviews: 300, bsr: '#1 in Pet Supplies', badges: ["Amazon's Choice"], bulletPoints: ['No-rinse liquid cleanser for dogs and cats'], coupon: 'Save 10%', subscribeSave: null, variantSummary: 'Size: 8 fl oz', seller: 'Amazon.com', operations: ['优惠券：Save 10%'] }],
  decision: '❓ 数据不足，不能判定'
})
const accepted = parseSelectionReportEnrichment(JSON.stringify({
  hypotheses: ['液体免洗擦浴的便携小规格可能需要通过样品反馈确认。'],
  validationTasks: ['抽取同类液体免洗护理商品的规格、价格和包装卖点，形成对比清单。'],
  listingInsights: [{ asin: 'B0TEST0001', observation: '页面突出免洗液体护理与优惠券要素。', learning: '验证小规格便携组合是否值得纳入测试。' }],
  improvementInsights: [{ direction: '规格/SKU拓展', proposal: '验证8盎司便携规格与小规格组合的测试方案。', asins: ['B0TEST0001'] }]
}), 'deepseek-chat', ['B0TEST0001'])
assert('受控JSON补充可解析', Boolean(accepted?.hypotheses.length && accepted.validationTasks.length))
assert('补充来源模型被记录', accepted?.sourceModelId === 'deepseek-chat')
assert('只接受已采集ASIN的页面要素归纳', accepted?.listingInsights.length === 1 && accepted.listingInsights[0].asin === 'B0TEST0001')
assert('改良建议只接受DIRECT详情页白名单ASIN', accepted?.improvementInsights.length === 1 && accepted.improvementInsights[0].direction === '规格/SKU拓展')
assert('未知ASIN页面归纳被拒绝', parseSelectionReportEnrichment(JSON.stringify({ hypotheses: [], validationTasks: [], listingInsights: [{ asin: 'B0UNKNOWN00', observation: '页面要素', learning: '验证方向' }] }), 'deepseek-chat', ['B0TEST0001']) === null)
assert('自由Markdown补充被拒绝', parseSelectionReportEnrichment('## 新报告\n| a | b |', 'deepseek-chat') === null)
assert('越权入场结论被拒绝', parseSelectionReportEnrichment(JSON.stringify({ hypotheses: ['建议入场'], validationTasks: [] })) === null)
assert('跨平台词汇被拒绝', parseSelectionReportEnrichment(JSON.stringify({ hypotheses: ['Amazon 页面显示竞争较少'], validationTasks: [] })) === null)
assert('只读补充提示锁定JSON和待验证', selectionReportEnrichmentPrompt(payload).includes('只返回合法 JSON') && selectionReportEnrichmentPrompt(payload).includes('待验证'))
const rendered = renderSelectionReportMarkdown(payload, accepted)
assert('归纳在头部竞店表保留原始证据并附加待验证借鉴方向', rendered.includes('详情页 https://www.amazon.com/dp/B0TEST0001') && rendered.includes('页面要素归纳（待验证）') && rendered.includes('验证小规格便携组合'))
assert('6.1改良表回填受控改良方案但成本和效果仍待验证', rendered.includes('页面要素归纳（待验证）：验证8盎司便携规格与小规格组合的测试方案。') && rendered.includes('DIRECT详情页：B0TEST0001') && rendered.includes('待小批量验证'))
assert('补充只进入报告结论与待办', rendered.includes('受控分析补充') && rendered.includes('分析假设（待验证）'))
assert('补充后仍通过六部分11表合同', validateRenderedSelectionReport(rendered).length === 0)
if (failures) process.exitCode = 1
