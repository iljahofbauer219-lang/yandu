#!/usr/bin/env node
import { createSelectionReportPayload } from '../src/shared/selectionReportPayload'
import { renderSelectionReportFallback, renderSelectionReportMarkdown, validateRenderedSelectionReport } from '../src/shared/selectionReportRenderer'
import { renderMarkdownForWord } from '../src/shared/wordExport'

let failures = 0
function assert(label: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }
const payload = createSelectionReportPayload({
  info: { title: '宠物苦苹果喷雾', confirmedProductName: '宠物苦苹果喷雾', url: 'https://detail.1688.com/offer/1.html', attributes: ['规格：30ml | 单瓶'], supplyFacts: { extractedAt: '2026-08-17', liquidRisk: true, conflicts: [] } },
  targetPlatform: 'Amazon美国站', decision: '❓ 数据不足，不能判定'
})
payload.sections[0].tables[0].rows[0][2] = '30ml | 单瓶'
const markdown = renderSelectionReportMarkdown(payload)
assert('确定性渲染输出Amazon标题', markdown.startsWith('# 宠物苦苹果喷雾 · Amazon美国站选品分析报告'))
assert('确定性渲染通过六部分11表格式合同', validateRenderedSelectionReport(markdown).length === 0)
assert('待验证字段仍在固定表中', markdown.includes('| 待验证 |'))
assert('单元格竖线已转义，不破坏表格', markdown.includes('30ml \\| 单瓶'))
const wordHtml = renderMarkdownForWord(markdown)
assert('Word转换生成原生HTML表格', (wordHtml.match(/<table/g) || []).length === 11)
assert('Word表格边框为黑色', wordHtml.includes('border:1.5pt solid #000000'))
assert('Word保留单元格内竖线且不新增列', wordHtml.includes('30ml | 单瓶') && !wordHtml.includes('<td style="border:1.5pt solid #000000;padding:7px 8px;vertical-align:top;text-align:left">单瓶</td>'))
const fallback = renderSelectionReportFallback('宠物苦苹果喷雾', 'Amazon美国站')
assert('上游异常仍交付固定模板预备报告', fallback.startsWith('# 宠物苦苹果喷雾 · Amazon美国站选品分析报告') && validateRenderedSelectionReport(fallback).length === 0)
if (failures) process.exitCode = 1
