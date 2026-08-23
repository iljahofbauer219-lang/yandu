/**
 * J.7 阶段：15 工具全量回归
 *
 * 挑选覆盖 J/I/H/G 阶段关键交付物的 15 个 verify 工具，统一跑一遍并汇总结果。
 * 退出码：全 pass → 0；任一 fail → 1
 */

import { spawnSync } from 'node:child_process'
import { basename, extname } from 'node:path'

const ROOT = process.cwd()
const TSX = ['npx', 'tsx']
const NODE = ['node']

type ToolSpec = { path: string; runner: 'tsx' | 'node'; reason: string }

// 15 工具精选：覆盖 J/I/H/G 阶段核心交付物
const TOOLS: ToolSpec[] = [
  // J 阶段
  { path: 'tools/verify-j-stage.ts', runner: 'tsx', reason: 'J 阶段守卫运行监控 + 失败重试（104 断言）' },

  // I 阶段
  { path: 'tools/verify-amazon-fba-fee-estimate.ts', runner: 'tsx', reason: 'I.5 阶段 FBA 费用估算' },
  { path: 'tools/verify-amazon-completeness-stage5.ts', runner: 'tsx', reason: 'I.5 阶段完整性 stage5' },
  { path: 'tools/verify-amazon-completeness-ui-stage5.cjs', runner: 'node', reason: 'I.5 阶段完整性 UI stage5' },
  { path: 'tools/verify-batch-operations-phase7.ts', runner: 'tsx', reason: 'I.7 阶段批量操作 phase7' },
  { path: 'tools/verify-batch-operations-ui-phase7.cjs', runner: 'node', reason: 'I.7 阶段批量操作 UI phase7' },

  // H 阶段
  { path: 'tools/verify-amazon-comparability-stage4.ts', runner: 'tsx', reason: 'H 阶段 comparability stage4' },
  { path: 'tools/verify-amazon-comparability-ui-stage4.cjs', runner: 'node', reason: 'H 阶段 comparability UI stage4' },
  { path: 'tools/verify-amazon-live-ui-stage7.cjs', runner: 'node', reason: 'H 阶段 live UI stage7' },
  { path: 'tools/verify-captured-real-report-ui-stage8.cjs', runner: 'node', reason: 'H 阶段 real report UI stage8' },

  // G 阶段
  { path: 'tools/verify-amazon-competitor-evidence.ts', runner: 'tsx', reason: 'G 阶段 competitor evidence' },
  { path: 'tools/verify-amazon-evidence-inference.ts', runner: 'tsx', reason: 'G 阶段 evidence inference' },
  { path: 'tools/verify-amazon-listing-evidence.ts', runner: 'tsx', reason: 'G 阶段 listing evidence' },
  { path: 'tools/verify-four-layer-quality-phase5.ts', runner: 'tsx', reason: 'G 阶段 four-layer quality' },
  { path: 'tools/verify-ai-employee-prompt-integration.ts', runner: 'tsx', reason: 'AI Employee prompt integration' }
]

interface Result {
  name: string
  runner: 'tsx' | 'node'
  reason: string
  pass: boolean
  exitCode: number
  durationMs: number
  stdoutTail: string
  stderrTail: string
}

function parsePassFail(stdout: string): { pass?: number; fail?: number } {
  // 兼容多种格式：「PASS X / FAIL Y」「✓ X 项」 等
  const passMatch = stdout.match(/PASS\s*(\d+)\s*\/\s*FAIL\s*(\d+)/i)
  if (passMatch) return { pass: Number(passMatch[1]), fail: Number(passMatch[2]) }
  const onlyPass = stdout.match(/(\d+)\s*项.*?通过|全部通过|✅/g)
  if (onlyPass && onlyPass.length > 0) return { pass: 1, fail: 0 }
  return {}
}

const results: Result[] = []
let totalPass = 0
let totalFail = 0

console.log('══════════════════════════════════════════════════════════════')
console.log('  J.7 阶段：15 工具全量回归')
console.log('══════════════════════════════════════════════════════════════')
console.log('')

for (const tool of TOOLS) {
  const name = basename(tool.path, extname(tool.path))
  const runner = tool.runner === 'tsx' ? TSX : NODE
  const start = Date.now()
  const proc = spawnSync(runner[0], [...runner.slice(1), tool.path], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const durationMs = Date.now() - start
  const stdout = proc.stdout ?? ''
  const stderr = proc.stderr ?? ''
  const exitCode = proc.status ?? -1
  const pass = exitCode === 0
  const { pass: pCount, fail: fCount } = parsePassFail(stdout)
  if (pCount !== undefined) totalPass += pCount
  if (fCount !== undefined) totalFail += fCount

  results.push({
    name,
    runner: tool.runner,
    reason: tool.reason,
    pass,
    exitCode,
    durationMs,
    stdoutTail: stdout.trim().split('\n').slice(-5).join('\n'),
    stderrTail: stderr.trim().split('\n').slice(-3).join('\n')
  })
}

const passed = results.filter(r => r.pass).length
const failed = results.length - passed

for (const r of results) {
  const mark = r.pass ? '✅' : '❌'
  const sec = (r.durationMs / 1000).toFixed(1)
  const detail = r.pass ? `${sec}s` : `exit=${r.exitCode} ${sec}s`
  console.log(`${mark} ${r.name.padEnd(45)} ${detail}`)
  console.log(`    └─ ${r.reason}`)
}

console.log('')
console.log('══════════════════════════════════════════════════════════════')
console.log(`  J.7 阶段 15 工具回归：PASS ${passed} / FAIL ${failed}`)
console.log(`  总耗时：${(results.reduce((a, r) => a + r.durationMs, 0) / 1000).toFixed(1)}s`)
if (totalPass > 0 || totalFail > 0) {
  console.log(`  累计断言：PASS ${totalPass} / FAIL ${totalFail}`)
}
if (failed > 0) {
  console.log('')
  console.log('  ❌ 失败工具详情：')
  for (const r of results.filter(x => !x.pass)) {
    console.log(`     - ${r.name} (exit=${r.exitCode})`)
    if (r.stdoutTail) console.log(`       stdout tail:\n${r.stdoutTail.split('\n').map(l => '         ' + l).join('\n')}`)
    if (r.stderrTail) console.log(`       stderr tail:\n${r.stderrTail.split('\n').map(l => '         ' + l).join('\n')}`)
  }
  process.exit(1)
}
console.log('  ✅ J 阶段全量回归通过')
process.exit(0)
