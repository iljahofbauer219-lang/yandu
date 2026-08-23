#!/usr/bin/env node
import { createSelectionReportPayload, selectionReportPayloadFactBlock, validateSelectionReportPayload } from '../src/shared/selectionReportPayload'
import { SELECTION_REPORT_REQUIRED_TABLE_COUNT } from '../src/shared/selectionReportTemplate'

let failures = 0
function assert(label: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }

const payload = createSelectionReportPayload({
  info: { title: '宠物苦苹果喷雾', url: 'https://detail.1688.com/offer/1.html', confirmedProductName: '宠物苦苹果喷雾', confirmedProductForm: '喷雾', supplyFacts: { extractedAt: '2026-08-17', liquidRisk: true, conflicts: [], purchasePriceCny: { low: 6.5, high: 6.5, source: '1688 商品页价格' } }, quickMarketProfit: { purchaseCostUsd: 0.91, referralFeeRate: 15, advertisingRate: 10, couponCostUsd: 5, fbaFulfillmentFeeUsd: 0 }, entryDecision: { targetContributionMargin: 20 } },
  targetPlatform: 'Amazon美国站', keywords: ['pet bitter apple spray'], decision: '❓ 数据不足，不能判定'
})
assert('事实包生成全部11张表', payload.sections.flatMap(section => section.tables).length === SELECTION_REPORT_REQUIRED_TABLE_COUNT)
assert('事实包通过结构校验', validateSelectionReportPayload(payload).length === 0)
assert('未知FBA费用仍保留为待验证', payload.sections.flatMap(section => section.tables).find(table => table.id === 'profitability')?.rows.some(row => row.includes('待验证')) === true)
assert('事实包锁定Amazon平台和决策', payload.targetPlatform === 'Amazon美国站' && payload.decision === '❓ 数据不足，不能判定')
assert('事实包可作为只读JSON交接给模型', selectionReportPayloadFactBlock(payload).includes('结构化报告事实包（只读）') && selectionReportPayloadFactBlock(payload).includes('Amazon美国站'))
const corrupted = structuredClone(payload); corrupted.sections[0].tables[0].columns[0] = '错误列名'
assert('列名被改写时结构校验失败', validateSelectionReportPayload(corrupted).some(issue => issue.includes('表头不一致')))
if (failures) process.exitCode = 1
