#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { SELECTION_REPORT_REQUIRED_TABLE_COUNT, SELECTION_REPORT_TEMPLATE, SELECTION_REPORT_TEMPLATE_REFERENCE, validateSelectionReportTemplate } from '../src/shared/selectionReportTemplate'

let failures = 0
function assert(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

assert('模板参考文件已锁定', SELECTION_REPORT_TEMPLATE_REFERENCE.fileName === '跨境AI选品调研员·标准分析报告.docx')
assert('模板参考文件SHA-256已锁定', /^[a-f0-9]{64}$/.test(SELECTION_REPORT_TEMPLATE_REFERENCE.sha256))
const referenceDocx = process.env.SELECTION_TEMPLATE_DOCX
if (referenceDocx && existsSync(referenceDocx)) {
  const actualSha256 = createHash('sha256').update(readFileSync(referenceDocx)).digest('hex')
  assert('当前参考DOCX与锁定指纹一致', actualSha256 === SELECTION_REPORT_TEMPLATE_REFERENCE.sha256, actualSha256)
}
assert('固定六大部分', SELECTION_REPORT_TEMPLATE.length === 6)
assert('固定十一张表', SELECTION_REPORT_REQUIRED_TABLE_COUNT === 11)
assert('所有表格均有标题与列定义', SELECTION_REPORT_TEMPLATE.every(section => section.tables.every(table => table.title && table.columns.length >= 2)))

const complete = SELECTION_REPORT_TEMPLATE.map(section => [
  `## ${section.title}`,
  ...section.tables.flatMap(table => [
    `### ${table.title}`,
    `| ${table.columns.join(' | ')} |`,
    `| ${table.columns.map(() => '---').join(' | ')} |`,
    `| ${table.columns.map(() => '待验证').join(' | ')} |`
  ])
].join('\n')).join('\n\n')
assert('完整模板报告通过格式合同', validateSelectionReportTemplate(complete).length === 0)

const wrongHeader = complete.replace('| 信息分类 | 明细项 | 本品数据 | 备注 |', '| 信息分类 | 明细项 | 本品数据 | 说明 |')
assert('表头被模型改写时明确失败', validateSelectionReportTemplate(wrongHeader).some(item => item.includes('本品基础信息表')))
const missingPart = complete.replace('## 第六部分：产品改良方案与长期市场机会', '## 第六部分：改良')
assert('章节被模型改写时明确失败', validateSelectionReportTemplate(missingPart).some(item => item.includes('第六部分')))

if (failures) process.exitCode = 1
