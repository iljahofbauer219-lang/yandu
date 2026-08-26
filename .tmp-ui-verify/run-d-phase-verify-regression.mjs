#!/usr/bin/env node
/**
 * I 阶段全量回归：14 个 selection-related verify 工具 + 1 个 stage-c 端到端 + 1 个 sample-coverage + 1 个 word-export + 1 个 sample-library + 1 个 prompt-integration + 1 个 sample-library-kb-ingest = 20 个。
 * 直接调用 ./node_modules/.bin/tsx 执行每个 verify-*.ts 工具，统计 PASS/FAIL。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const tsx = join(root, 'node_modules/.bin/tsx')
const tools = [
  'verify-amazon-comparability-stage4.ts',
  'verify-amazon-competitor-evidence.ts',
  'verify-amazon-completeness-stage5.ts',
  'verify-amazon-evidence-inference.ts',
  'verify-amazon-fba-fee-estimate.ts',
  'verify-amazon-listing-dimensions.ts',
  'verify-amazon-listing-evidence.ts',
  'verify-omkarcloud-fallback.ts',
  'verify-selection-extract.ts',
  'verify-selection-report-consensus.ts',
  'verify-selection-report-enrichment.ts',
  'verify-selection-report-payload.ts',
  'verify-selection-report-renderer.ts',
  'verify-selection-report-template.ts',
  'verify-ai-employee-stage-c.ts', // D 阶段新增端到端 verify
  'verify-report-sample-coverage.ts', // E 阶段新增样例库覆盖度 verify
  'verify-report-word-export.ts', // F 阶段新增报告 Word 导出链路 verify
  'verify-sample-library-online.ts', // G 阶段新增报告样例库在线预览 verify
  'verify-ai-employee-prompt-integration.ts', // H 阶段新增报告样例库 → AI 智能体 Prompt 集成 verify
  'verify-sample-library-kb-ingest.ts' // I 阶段新增报告样例库 → RAGFlow 知识库入库 verify
]

let pass = 0
let fail = 0
const failures = []
const allOutputs = []
for (const file of tools) {
  const full = join(root, 'tools', file)
  const res = spawnSync(tsx, [full], { encoding: 'utf-8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  if (res.status === 0) {
    pass += 1
    const stdout = res.stdout || ''
    const lines = stdout.trim().split('\n')
    const last = lines[lines.length - 1] || 'OK'
    const allPass = /ALL PASS/.test(stdout)
    // 解析总断言数：从最后一行 ALL PASS 或 PASS 计数
    const passCount = (stdout.match(/^PASS\s/gm) || []).length
    const allPassTools = allPass ? last : `${passCount} PASS`
    console.log(`✅ ${file} · ${allPassTools}`)
    allOutputs.push({ file, stdout, pass: passCount })
  } else {
    fail += 1
    failures.push(file)
    console.log(`❌ ${file}`)
    const errLines = ((res.stdout || '') + '\n' + (res.stderr || '')).trim().split('\n').slice(-20).join('\n')
    console.log(errLines)
    allOutputs.push({ file, stdout: res.stdout, stderr: res.stderr, pass: 0 })
  }
}
console.log('\n──────────────────────────────────────')
console.log(`工具：PASS ${pass}/${tools.length}  FAIL ${fail}`)
if (fail) {
  console.log('失败：', failures.join(', '))
  process.exit(1)
}
// 统计总断言数
const totalPass = allOutputs.reduce((sum, o) => sum + (o.pass || 0), 0)
console.log(`总断言：${totalPass} PASS · 0 FAIL`)
console.log('ALL VERIFY TOOLS PASS · 0 退化')
