#!/usr/bin/env node
/**
 * E 阶段样例库覆盖度 verify 工具：断言 4 个决策样本齐全 + 样例库文档结构完整。
 *
 * 验证项分 6 组：
 *   1. 4 个样例文件存在（每个 ≥ 5KB）
 *   2. 每个样例 6 部分齐全（第一～第六部分标题 + 附录 systemFact 块）
 *   3. 4 个样例覆盖 4 种决策（✅/⚠️/❌/❓）
 *   4. 每个样例决策可追溯（系统入场结论 = 报告最终结论）
 *   5. 样例库文档存在且 ≥ 200 行
 *   6. 样例库标注齐全（决策矩阵 / 4 种决策全覆盖 / evidence 等级 / 决策门禁表 / 代码定位）
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

const samples = [
  { label: 'A', file: 'sample-A-recommend-entry.md', expectedDecision: '✅ 建议入场' },
  { label: 'B', file: 'sample-B-conditional-entry.md', expectedDecision: '⚠️ 有条件谨慎入场' },
  { label: 'C', file: 'sample-C-do-not-enter.md', expectedDecision: '❌ 不建议入场' },
  { label: 'D', file: 'sample-D-insufficient-data.md', expectedDecision: '❓ 数据不足，不能判定' }
]

const libraryPath = join(root, 'docs/选品分析师-报告样例库.md')
const libraryExists = existsSync(libraryPath)
const libraryContent = libraryExists ? readFileSync(libraryPath, 'utf-8') : ''
const libraryLines = libraryContent.split('\n')

// ─── 1. 4 个样例文件存在 + 体积合理 ─────────────────────────
for (const s of samples) {
  const p = join(root, 'artifacts/online-advisor-parity', s.file)
  const exists = existsSync(p)
  const stat = exists ? statSync(p) : null
  const size = stat?.size || 0
  assert(`样例 ${s.label}（${s.expectedDecision}）文件存在 · ≥5KB`, exists && size >= 5000, `path=${s.file} size=${size}`)
}

// ─── 2. 每个样例 6 部分齐全 + 附录 systemFact 块 ─────────────
for (const s of samples) {
  const p = join(root, 'artifacts/online-advisor-parity', s.file)
  const content = existsSync(p) ? readFileSync(p, 'utf-8') : ''
  const has6Parts = content.includes('## 第一部分') && content.includes('## 第二部分') && content.includes('## 第三部分') && content.includes('## 第四部分') && content.includes('## 第五部分') && content.includes('## 第六部分')
  assert(`样例 ${s.label} 含 6 部分标题（第一～第六）`, has6Parts)
  assert(`样例 ${s.label} 含附录 systemFact 块`, content.includes('## 附录') && content.includes('第一部分：本品基础信息解析（系统事实块）') && content.includes('系统抓取 Amazon'))
}

// ─── 3. 4 个样例覆盖 4 种决策 ──────────────────────────────
for (const s of samples) {
  const p = join(root, 'artifacts/online-advisor-parity', s.file)
  const content = existsSync(p) ? readFileSync(p, 'utf-8') : ''
  assert(`样例 ${s.label} 最终结论 = ${s.expectedDecision}`, content.includes(`最终结论：${s.expectedDecision}`))
}

// ─── 4. 每个样例决策可追溯（系统入场结论 = 报告最终结论） ─────────
for (const s of samples) {
  const p = join(root, 'artifacts/online-advisor-parity', s.file)
  const content = existsSync(p) ? readFileSync(p, 'utf-8') : ''
  // 必须包含"系统入场结论 = X，报告最终结论 = X"格式
  const pattern = new RegExp(`系统入场结论\\s*=\\s*${s.expectedDecision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[，,].*报告最终结论\\s*=\\s*${s.expectedDecision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  assert(`样例 ${s.label} 决策可追溯（系统 = 报告）`, pattern.test(content))
}

// ─── 5. 样例库文档存在且 ≥ 200 行 ─────────────────────────
assert('样例库 docs/选品分析师-报告样例库.md 存在', libraryExists, `path=docs/选品分析师-报告样例库.md`)
assert('样例库文档 ≥ 200 行', libraryLines.length >= 200, `lines=${libraryLines.length}`)

// ─── 6. 样例库标注齐全 ─────────────────────────────────
assert('样例库含 4 种决策的样例决策矩阵', libraryContent.includes('| 样例 | 决策 |') && libraryContent.includes('sample-A-recommend-entry.md') && libraryContent.includes('sample-B-conditional-entry.md') && libraryContent.includes('sample-C-do-not-enter.md') && libraryContent.includes('sample-D-insufficient-data.md'))
assert('样例库含决策门禁表（10 门禁）', libraryContent.includes('## 决策门禁') && libraryContent.includes('evidence 字段全部') && libraryContent.includes('targetContributionMargin') && libraryContent.includes('合规/IP 核验依据'))
assert('样例库含 evidence 等级分类（事实/外部估算/分析假设）', libraryContent.includes('事实') && libraryContent.includes('外部估算') && libraryContent.includes('分析假设'))
assert('样例库含代码定位（evaluateAmazonEntryDecision / buildCompetitorListingSummary / buildProductBasicsBlock）', libraryContent.includes('evaluateAmazonEntryDecision') && libraryContent.includes('buildCompetitorListingSummary') && libraryContent.includes('buildProductBasicsBlock'))
assert('样例库含样例生成器使用说明', libraryContent.includes('sample-generator.mjs') && libraryContent.includes('verify-report-sample-coverage.ts'))

// ─── 7. 4 个样例的 DIRECT 数据不空（用户核心诉求"待验证不空着"） ─────
for (const s of samples) {
  const p = join(root, 'artifacts/online-advisor-parity', s.file)
  const content = existsSync(p) ? readFileSync(p, 'utf-8') : ''
  // 第一部分应含 5+ 行货源基础（商品名称/链接/采购价/起订量/发货地）
  const hasFirstPart = content.includes('商品名称') && content.includes('商品链接') && content.includes('采购价') && content.includes('起订量') && content.includes('发货地')
  assert(`样例 ${s.label} 第一部分货源基础 5 行齐全`, hasFirstPart)
  // 第三部分 3.1 应含 ≥ 3 个真实 ASIN
  const hasAsinTable = content.includes('| ASIN |') && content.includes('B0C1AQUPET') && content.includes('B0D2DOGCAT') && content.includes('B0E3LIVGRN')
  assert(`样例 ${s.label} 第三部分 3.1 含 3 个 ASIN 真实数据`, hasAsinTable)
}

// ─── 收尾 ─────────────────────────────────────────────
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
