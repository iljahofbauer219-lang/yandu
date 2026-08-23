#!/usr/bin/env node
import { rankSelectionReportCandidates, selectionReportConsensusInstruction } from '../src/shared/selectionReportConsensus'

let failures = 0
function assert(label: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }
const long = '# 测试报告\n\n' + '内容。'.repeat(80)
const ranked = rankSelectionReportCandidates([
  { modelId: 'qwen-plus', content: long, issues: ['缺表'] },
  { modelId: 'deepseek-chat', content: long, issues: [] },
  { modelId: 'ragflow-agent', content: long, issues: [] },
  { modelId: 'bad-path', content: '/tmp/report.md', issues: [] },
  { modelId: 'empty', content: '', issues: [] }
], ['ragflow-agent', 'deepseek-chat', 'qwen-plus'])
assert('空回复和本地路径回复不参与候选', !ranked.some(candidate => candidate.modelId === 'bad-path' || candidate.modelId === 'empty'))
assert('质量门禁问题更少的候选优先', ranked[0]?.modelId === 'ragflow-agent' && ranked[0]?.issues.length === 0)
assert('同分按发起模型优先级稳定排序', ranked[1]?.modelId === 'deepseek-chat')
assert('评审协议要求同一事实包与待验证', selectionReportConsensusInstruction().includes('同一份结构化报告事实包') && selectionReportConsensusInstruction().includes('待验证'))
if (failures) process.exitCode = 1
