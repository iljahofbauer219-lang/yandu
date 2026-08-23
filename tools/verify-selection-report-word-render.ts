#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createSelectionReportPayload } from '../src/shared/selectionReportPayload'
import { renderSelectionReportMarkdown } from '../src/shared/selectionReportRenderer'
import { renderMarkdownForWord, wordDocumentCss } from '../src/shared/wordExport'

const outputDir = path.resolve('output/word-qa')
fs.mkdirSync(outputDir, { recursive: true })

const payload = createSelectionReportPayload({
  info: {
    title: '宠物苦苹果喷雾',
    confirmedProductName: '宠物苦苹果喷雾',
    url: 'https://detail.1688.com/offer/1.html',
    attributes: ['规格：30ml | 单瓶'],
    supplyFacts: { extractedAt: '2026-08-18', liquidRisk: true, conflicts: [] }
  },
  targetPlatform: 'Amazon美国站',
  decision: '❓ 数据不足，不能判定'
})
payload.sections[0].tables[0].rows[0][2] = '30ml | 单瓶'
const markdown = renderSelectionReportMarkdown(payload)
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${wordDocumentCss}</style></head><body><h1>宠物苦苹果喷雾 · Amazon美国站选品分析报告</h1>${renderMarkdownForWord(markdown)}</body></html>`
const wordPath = path.join(outputDir, 'selection-report-table-qa.doc')
fs.writeFileSync(wordPath, `\uFEFF${html}`, 'utf8')

const tables = (html.match(/<table/g) || []).length
if (tables !== 11 || !html.includes('border:1.5pt solid #000000') || !html.includes('30ml | 单瓶')) {
  throw new Error('Word HTML structure verification failed')
}
console.log(JSON.stringify({ wordPath, tables, literalPipePreserved: true, blackBorders: true }, null, 2))
