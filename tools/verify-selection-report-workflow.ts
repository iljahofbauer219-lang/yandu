#!/usr/bin/env node
import { buildSelectionReportCollaborationPrompt, SELECTION_REPORT_AGENT_ROLES, selectionReportTemplateInstruction } from '../src/shared/selectionReportWorkflow'
import { SELECTION_REPORT_REQUIRED_TABLE_COUNT, SELECTION_REPORT_TEMPLATE } from '../src/shared/selectionReportTemplate'

let failures = 0
function assert(label: string, ok: boolean): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

const contract = selectionReportTemplateInstruction()
const prompt = buildSelectionReportCollaborationPrompt('商品名称：测试喷雾\nDIRECT样本：待验证', 'Amazon美国站')
assert('调研员职责锁定可比性规则', SELECTION_REPORT_AGENT_ROLES.researcher.responsibility.includes('同一核心用途 + 同一形态 + 同一对象'))
assert('调研员禁止以替代样本冒充直接竞品', SELECTION_REPORT_AGENT_ROLES.researcher.forbidden.includes('ADJACENT'))
assert('分析师禁止修改商品身份和平台', SELECTION_REPORT_AGENT_ROLES.analyst.forbidden.includes('商品身份、目标平台'))
assert('格式指令包含全部六大部分', SELECTION_REPORT_TEMPLATE.every(section => contract.includes(`## ${section.title}`)))
assert('格式指令包含全部11张表', SELECTION_REPORT_TEMPLATE.flatMap(section => section.tables).length === SELECTION_REPORT_REQUIRED_TABLE_COUNT && SELECTION_REPORT_TEMPLATE.flatMap(section => section.tables).every(table => contract.includes(table.title)))
assert('协同提示锁定Amazon平台', prompt.includes('目标平台（系统锁定）：Amazon美国站'))
assert('协同提示明确直接输出完整报告而非路径', prompt.includes('不得只返回修改说明、/tmp路径或摘要'))
assert('协同提示要求未知字段保留待验证', prompt.includes('字段填“待验证”'))
assert('协同提示要求Word黑色边框', prompt.includes('表格边框为黑色'))

if (failures) process.exitCode = 1
