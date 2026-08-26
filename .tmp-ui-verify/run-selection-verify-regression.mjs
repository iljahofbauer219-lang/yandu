#!/usr/bin/env node
/**
 * 14 个 selection-related verify 工具全量回归。
 * 直接调用 ./node_modules/.bin/tsx 执行每个 verify-*.ts 工具。
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
  'verify-selection-report-template.ts'
]

let pass = 0
let fail = 0
const failures = []
const totalAssertions = { pass: 0, fail: 0 }
for (const file of tools) {
  const full = join(root, 'tools', file)
  const res = spawnSync(tsx, [full], { encoding: 'utf-8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  if (res.status === 0) {
    pass += 1
    const lines = (res.stdout || '').trim().split('\n')
    const last = lines[lines.length - 1] || 'OK'
    const passCount = (res.stdout || '').match(/(\d+)\s*PASS/g)?.length || 0
    const allPass = /ALL PASS/.test(res.stdout || '')
    console.log(`✅ ${file} · ${allPass ? last : lines.filter(l => /PASS/.test(l)).length + ' PASS'}`)
  } else {
    fail += 1
    failures.push(file)
    console.log(`❌ ${file}\n${res.stdout}\n${res.stderr}`)
  }
}
console.log('\n──────────────────────────────────────')
console.log(`工具：PASS ${pass}/${tools.length}  FAIL ${fail}`)
if (fail) {
  console.log('失败：', failures.join(', '))
  process.exit(1)
}
