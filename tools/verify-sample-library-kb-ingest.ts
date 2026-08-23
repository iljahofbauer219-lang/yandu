/**
 * I 阶段：报告样例库 → RAGFlow 知识库入库 verify 工具。
 *
 * 验证项（12 组 100+ 断言）：
 *  1. src/shared/sampleLibraryKbIngest.ts 存在 + 行数 ≥ 150 + 导出
 *  2. SAMPLE_LIBRARY_KB_TARGET 字段齐全（agentKey / kbName / description / categoryRoot）
 *  3. 6 文档清单完整（4 样例 + 2 辅助）
 *  4. 4 真实样例 + 2 辅助文档物理存在（size > 0）
 *  5. 决策门禁 + 可追溯文档内容含 4 决策枚举
 *  6. Ingestor 服务存在 + 行数 ≥ 150 + 导出 describeTarget / preview / ingest
 *  7. describeTarget() 静态方法返回智能体名 + 库名
 *  8. preview() / ingest() 公共 API 形态（参数 + 返回值类型）
 *  9. main.ts 含 3 个 IPC handlers（describe / preview / ingest）
 * 10. preload 暴露 sampleLibraryKb.{describe,preview,ingest}
 * 11. global.d.ts 类型契约 sampleLibraryKb.{describe,preview,ingest}
 * 12. SampleLibrary.tsx 桌面入口：按钮 + 目标 KB 信息 + 结果面板
 * 13. 文档同步：报告样例库文档含 I 阶段章节 + 入库目标表 + 6 文档清单
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SAMPLE_LIBRARY_KB_TARGET,
  buildSampleLibraryKbIngestPlan,
  summarizeSampleLibraryKbIngestPlan,
  getSampleLibraryKbSyncSnapshot
} from '../src/shared/sampleLibraryKbIngest'
import { SampleLibraryKbIngestor } from '../src/main/services/SampleLibraryKbIngestor'

const root = process.cwd()
let pass = 0
let fail = 0
const failures: string[] = []

function assert(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1
    console.log(`PASS  ${name}${detail ? `（${detail}）` : ''}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`FAIL  ${name}${detail ? `（${detail}）` : ''}`)
  }
}

// ─── 1. 纯函数文件存在 + 行数 + 导出 ─────────────────────
const ingestPath = resolve(root, 'src/shared/sampleLibraryKbIngest.ts')
assert('sampleLibraryKbIngest.ts 文件存在', existsSync(ingestPath))
if (existsSync(ingestPath)) {
  const lines = readFileSync(ingestPath, 'utf-8').split('\n').length
  assert('sampleLibraryKbIngest.ts 行数 ≥ 150', lines >= 150, `${lines} 行`)
  const src = readFileSync(ingestPath, 'utf-8')
  assert('导出 SAMPLE_LIBRARY_KB_TARGET', /export const SAMPLE_LIBRARY_KB_TARGET/.test(src))
  assert('导出 SampleLibraryKbLeafCategory 类型', /export type SampleLibraryKbLeafCategory/.test(src))
  assert('导出 SampleLibraryKbDoc 接口', /export interface SampleLibraryKbDoc/.test(src))
  assert('导出 resolveSampleLibraryArtifactDir', /export function resolveSampleLibraryArtifactDir/.test(src))
  assert('导出 buildSampleLibraryKbIngestPlan', /export function buildSampleLibraryKbIngestPlan/.test(src))
  assert('导出 summarizeSampleLibraryKbIngestPlan', /export function summarizeSampleLibraryKbIngestPlan/.test(src))
  assert('导出 SampleLibraryKbIngestResult 接口', /export interface SampleLibraryKbIngestResult/.test(src))
  assert('导出 getSampleLibraryKbSyncSnapshot', /export function getSampleLibraryKbSyncSnapshot/.test(src))
}

// ─── 2. SAMPLE_LIBRARY_KB_TARGET 字段齐全 ──────────────
assert('agentKey = sourcing', SAMPLE_LIBRARY_KB_TARGET.agentKey === 'sourcing', `agentKey=${SAMPLE_LIBRARY_KB_TARGET.agentKey}`)
assert('kbName = 选品分析师知识库', SAMPLE_LIBRARY_KB_TARGET.kbName === '选品分析师知识库', `kbName=${SAMPLE_LIBRARY_KB_TARGET.kbName}`)
assert('description 含 4 真实样例', /4 真实样例/.test(SAMPLE_LIBRARY_KB_TARGET.description), `description=${SAMPLE_LIBRARY_KB_TARGET.description}`)
assert('description 含 决策门禁', /决策门禁/.test(SAMPLE_LIBRARY_KB_TARGET.description))
assert('description 含 决策可追溯', /决策可追溯/.test(SAMPLE_LIBRARY_KB_TARGET.description))
assert('categoryRoot = 报告样例库', SAMPLE_LIBRARY_KB_TARGET.categoryRoot === '报告样例库', `categoryRoot=${SAMPLE_LIBRARY_KB_TARGET.categoryRoot}`)

// ─── 3. 6 文档清单完整 ───────────────────────────────
const plan = buildSampleLibraryKbIngestPlan()
assert('入库计划 = 6 文档', plan.length === 6, `${plan.length} 个`)
const byCategory: Record<string, number> = {}
for (const doc of plan) byCategory[doc.category] = (byCategory[doc.category] ?? 0) + 1
assert('含 报告样例库/A', byCategory['报告样例库/A'] === 1)
assert('含 报告样例库/B', byCategory['报告样例库/B'] === 1)
assert('含 报告样例库/C', byCategory['报告样例库/C'] === 1)
assert('含 报告样例库/D', byCategory['报告样例库/D'] === 1)
assert('含 报告样例库/决策门禁', byCategory['报告样例库/决策门禁'] === 1)
assert('含 报告样例库/可追溯约束', byCategory['报告样例库/可追溯约束'] === 1)

const letterMap: Record<string, string> = {}
for (const doc of plan) {
  if (doc.meta.letter) letterMap[doc.meta.letter] = doc.name
}
assert('样例 A = sample-A-recommend-entry.md', letterMap.A === 'sample-A-recommend-entry.md')
assert('样例 B = sample-B-conditional-entry.md', letterMap.B === 'sample-B-conditional-entry.md')
assert('样例 C = sample-C-do-not-enter.md', letterMap.C === 'sample-C-do-not-enter.md')
assert('样例 D = sample-D-insufficient-data.md', letterMap.D === 'sample-D-insufficient-data.md')

const kinds: Record<string, number> = { sample: 0, gates: 0, traceability: 0 }
for (const doc of plan) kinds[doc.meta.kind] += 1
assert('sample 数 = 4', kinds.sample === 4, `sample=${kinds.sample}`)
assert('gates 数 = 1', kinds.gates === 1, `gates=${kinds.gates}`)
assert('traceability 数 = 1', kinds.traceability === 1, `traceability=${kinds.traceability}`)

// ─── 4. 4 真实样例 + 2 辅助文档物理存在（size > 0） ──
let allDocsExist = true
let totalBytes = 0
const missingDocs: string[] = []
for (const doc of plan) {
  if (doc.meta.size === 0) {
    allDocsExist = false
    missingDocs.push(doc.name)
  }
  totalBytes += doc.meta.size
}
assert('所有 6 文档 size > 0', allDocsExist, missingDocs.length > 0 ? `缺失: ${missingDocs.join(', ')}` : `totalBytes=${totalBytes}`)
assert('总字节数 ≥ 30KB', totalBytes >= 30 * 1024, `totalBytes=${totalBytes}`)

// ─── 5. 决策门禁 + 可追溯文档内容含 4 决策枚举 ──
const gatesDoc = readFileSync(resolve(root, 'artifacts/online-advisor-parity/sample-library-decision-gates.md'), 'utf-8')
assert('决策门禁文档含 ✅ 建议入场', /✅ 建议入场/.test(gatesDoc))
assert('决策门禁文档含 ⚠️ 有条件谨慎入场', /⚠️ 有条件谨慎入场/.test(gatesDoc))
assert('决策门禁文档含 ❌ 不建议入场', /❌ 不建议入场/.test(gatesDoc))
assert('决策门禁文档含 ❓ 数据不足', /❓ 数据不足/.test(gatesDoc))
assert('决策门禁文档含 触发条件', /触发条件/.test(gatesDoc))
assert('决策门禁文档含 失败门禁', /失败门禁/.test(gatesDoc))

const traceDoc = readFileSync(resolve(root, 'artifacts/online-advisor-parity/sample-library-traceability-rule.md'), 'utf-8')
assert('可追溯文档含 ✅ 建议入场', /✅ 建议入场/.test(traceDoc))
assert('可追溯文档含 ⚠️ 有条件谨慎入场', /⚠️ 有条件谨慎入场/.test(traceDoc))
assert('可追溯文档含 ❌ 不建议入场', /❌ 不建议入场/.test(traceDoc))
assert('可追溯文档含 ❓ 数据不足', /❓ 数据不足/.test(traceDoc))
assert('可追溯文档含 决策可追溯 硬约束', /决策可追溯/.test(traceDoc))
assert('可追溯文档含 系统=报告', /系统入场结论.*报告最终结论/.test(traceDoc))
assert('可追溯文档含 兜底', /兜底/.test(traceDoc))

// ─── 6. Ingestor 服务存在 + 行数 + 导出 ──────────────
const ingestorPath = resolve(root, 'src/main/services/SampleLibraryKbIngestor.ts')
assert('SampleLibraryKbIngestor.ts 文件存在', existsSync(ingestorPath))
if (existsSync(ingestorPath)) {
  const lines = readFileSync(ingestorPath, 'utf-8').split('\n').length
  assert('SampleLibraryKbIngestor.ts 行数 ≥ 150', lines >= 150, `${lines} 行`)
  const src = readFileSync(ingestorPath, 'utf-8')
  assert('导出 SampleLibraryKbIngestor 类', /export class SampleLibraryKbIngestor/.test(src))
  assert('类内含 preview 方法', /async preview\(\)/.test(src))
  assert('类内含 ingest 方法', /async ingest\(/.test(src))
  assert('类内含 ensureCategories 私有方法', /private async ensureCategories/.test(src))
  assert('类内含 describeTarget 静态方法', /static describeTarget/.test(src))
  assert('ingest 方法含 errors 聚合', /errors.push/.test(src))
  assert('ingest 方法含 skipped 跳过逻辑', /skipped\.push/.test(src))
  assert('ingest 方法含 uploaded 上传逻辑', /uploaded\.push/.test(src))
  assert('ingest 方法含 parsed 解析逻辑', /parsed\.push/.test(src))
  assert('ingest 方法含 assignDocs 分类补齐', /assignDocs/.test(src))
}

// ─── 7. describeTarget() 静态方法返回结构 ────────────
const target = SampleLibraryKbIngestor.describeTarget()
assert('describeTarget().agentName = 选品分析师', target.agentName === '选品分析师', `agentName=${target.agentName}`)
assert('describeTarget().agentRole 含 1688', /1688/.test(target.agentRole))
assert('describeTarget().kbName = 选品分析师知识库', target.kbName === '选品分析师知识库')
assert('describeTarget().categoryRoot = 报告样例库', target.categoryRoot === '报告样例库')
assert('describeTarget().description 非空', target.description.length > 0)

// ─── 8. preview() / ingest() API 形态（不实际执行） ─
const ingestorSrc = readFileSync(resolve(root, 'src/main/services/SampleLibraryKbIngestor.ts'), 'utf-8')
assert('preview() 返回 kb/plan/summary', /async preview[\s\S]*?kb[\s\S]*?plan[\s\S]*?summary/.test(ingestorSrc))
assert('ingest() 接收 options: { parse?: boolean }', /ingest\(options:\s*\{\s*parse\?:\s*boolean/.test(ingestorSrc))
assert('ingest() 返回 SampleLibraryKbIngestResult', /Promise<SampleLibraryKbIngestResult>/.test(ingestorSrc))
assert('ingest() 调 ensureAgentKb', /ensureAgentKb/.test(ingestorSrc))
assert('ingest() 调 listDocs 去重', /listDocs/.test(ingestorSrc))
assert('ingest() 调 uploadDocs 上传', /uploadDocs/.test(ingestorSrc))
assert('ingest() 调 parseDocs 解析', /parseDocs/.test(ingestorSrc))
assert('ingest() 按 name 去重（existingByName）', /existingByName/.test(ingestorSrc))
assert('ingest() 单文件失败不影响其他（try/catch）', /try \{[\s\S]*?uploadDocs[\s\S]*?\} catch/.test(ingestorSrc))

// ─── 9. main.ts 含 3 个 IPC handlers ────────────────
const mainPath = resolve(root, 'src/main/main.ts')
assert('main.ts 文件存在', existsSync(mainPath))
if (existsSync(mainPath)) {
  const mainSrc = readFileSync(mainPath, 'utf-8')
  assert('main.ts 导入 SampleLibraryKbIngestor', /import \{ SampleLibraryKbIngestor \}/.test(mainSrc))
  assert('main.ts 注册 sample-library-kb:describe', /ipcMain\.handle\(['"]sample-library-kb:describe['"]/.test(mainSrc))
  assert('main.ts 注册 sample-library-kb:preview', /ipcMain\.handle\(['"]sample-library-kb:preview['"]/.test(mainSrc))
  assert('main.ts 注册 sample-library-kb:ingest', /ipcMain\.handle\(['"]sample-library-kb:ingest['"]/.test(mainSrc))
  assert('main.ts 调 SampleLibraryKbIngestor.describeTarget()', /SampleLibraryKbIngestor\.describeTarget\(\)/.test(mainSrc))
  assert('main.ts 调 sampleLibraryKbIngestor.preview()', /sampleLibraryKbIngestor\.preview\(\)/.test(mainSrc))
  assert('main.ts 调 sampleLibraryKbIngestor.ingest(options)', /sampleLibraryKbIngestor\.ingest\(options\)/.test(mainSrc))
}

// ─── 10. preload 暴露 sampleLibraryKb.{describe,preview,ingest} ─
const preloadPath = resolve(root, 'src/preload/preload.ts')
assert('preload.ts 文件存在', existsSync(preloadPath))
if (existsSync(preloadPath)) {
  const preloadSrc = readFileSync(preloadPath, 'utf-8')
  assert('preload 暴露 sampleLibraryKb.describe', /sampleLibraryKb:\s*\{[\s\S]*?describe:[\s\S]*?ipcRenderer\.invoke\(['"]sample-library-kb:describe['"]\)/.test(preloadSrc))
  assert('preload 暴露 sampleLibraryKb.preview', /sampleLibraryKb[\s\S]*?preview[\s\S]*?ipcRenderer\.invoke\(['"]sample-library-kb:preview['"]\)/.test(preloadSrc))
  assert('preload 暴露 sampleLibraryKb.ingest', /sampleLibraryKb[\s\S]*?ingest[\s\S]*?ipcRenderer\.invoke\(['"]sample-library-kb:ingest['"]/.test(preloadSrc))
}

// ─── 11. global.d.ts 类型契约 ────────────────────────
const globalPath = resolve(root, 'src/renderer/global.d.ts')
assert('global.d.ts 文件存在', existsSync(globalPath))
if (existsSync(globalPath)) {
  const globalSrc = readFileSync(globalPath, 'utf-8')
  assert('global.d.ts 含 sampleLibraryKb.describe 类型', /sampleLibraryKb:\s*\{[\s\S]*?describe\(\):\s*Promise</.test(globalSrc))
  assert('global.d.ts 含 sampleLibraryKb.preview 类型', /sampleLibraryKb[\s\S]*?preview\(\):\s*Promise</.test(globalSrc))
  assert('global.d.ts 含 sampleLibraryKb.ingest 类型', /sampleLibraryKb[\s\S]*?ingest\(options\?:\s*\{\s*parse\?:\s*boolean/.test(globalSrc))
}

// ─── 12. SampleLibrary.tsx 桌面入口 ──────────────────
const slPath = resolve(root, 'src/renderer/SampleLibrary.tsx')
assert('SampleLibrary.tsx 文件存在', existsSync(slPath))
if (existsSync(slPath)) {
  const slSrc = readFileSync(slPath, 'utf-8')
  const lines = slSrc.split('\n').length
  assert('SampleLibrary.tsx 行数 ≥ 320 (G 280 + I +40)', lines >= 320, `${lines} 行`)
  assert('SampleLibrary.tsx 定义 IngestStatus 类型', /type IngestStatus/.test(slSrc))
  assert('SampleLibrary.tsx 含 handleIngest 函数', /const handleIngest = async/.test(slSrc))
  assert('SampleLibrary.tsx 调 window.desktop.aiEmployee.sampleLibraryKb', /window\.desktop\?\.aiEmployee\?\.sampleLibraryKb/.test(slSrc))
  assert('SampleLibrary.tsx 调 api.describe()', /api\.describe\(\)/.test(slSrc))
  assert('SampleLibrary.tsx 调 api.preview()', /api\.preview\(\)/.test(slSrc))
  assert('SampleLibrary.tsx 调 api.ingest({parse:true})', /api\.ingest\(\{\s*parse:\s*true\s*\}\)/.test(slSrc))
  assert('SampleLibrary.tsx 含 一键入库到知识库 按钮文案', /一键入库到知识库/.test(slSrc))
  assert('SampleLibrary.tsx 含 targetLabel 状态', /targetLabel/.test(slSrc))
  assert('SampleLibrary.tsx 含 ingest 状态', /setIngest\(/.test(slSrc))
  assert('SampleLibrary.tsx 含 done 状态展示', /phase === 'done'/.test(slSrc))
  assert('SampleLibrary.tsx 含 error 状态展示', /phase === 'error'/.test(slSrc))
}

// CSS 也加上 ingest 按钮 + 结果面板
const cssPath = resolve(root, 'src/renderer/sample-library.css')
assert('sample-library.css 文件存在', existsSync(cssPath))
if (existsSync(cssPath)) {
  const cssSrc = readFileSync(cssPath, 'utf-8')
  const lines = cssSrc.split('\n').length
  assert('sample-library.css 行数 ≥ 360 (G 347 + I +13)', lines >= 360, `${lines} 行`)
  assert('CSS 含 .sample-library-ingest-btn', /\.sample-library-ingest-btn/.test(cssSrc))
  assert('CSS 含 .sample-library-ingest-result', /\.sample-library-ingest-result/.test(cssSrc))
  assert('CSS 含 .sample-library-ingest-result.ok', /\.sample-library-ingest-result\.ok/.test(cssSrc))
  assert('CSS 含 .sample-library-ingest-result.err', /\.sample-library-ingest-result\.err/.test(cssSrc))
  assert('CSS 含 .sample-library-ingest-info', /\.sample-library-ingest-info/.test(cssSrc))
}

// ─── 13. 文档同步：报告样例库文档含 I 阶段章节 ───────
const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
assert('报告样例库文档存在', existsSync(docPath))
if (existsSync(docPath)) {
  const docSrc = readFileSync(docPath, 'utf-8')
  const lines = docSrc.split('\n').length
  assert('报告样例库文档行数 ≥ 400 (G 340 + I +60)', lines >= 400, `${lines} 行`)
  assert('文档含 I 阶段章节', /^## I 阶段：报告样例库 → RAGFlow 知识库/m.test(docSrc))
  assert('文档含 入库目标 表', /### 1\. 入库目标/.test(docSrc))
  assert('文档含 入库文档清单 表', /### 2\. 入库文档清单/.test(docSrc))
  assert('文档含 6 文档清单', /sample-A-recommend-entry\.md/.test(docSrc) && /sample-B-conditional-entry\.md/.test(docSrc) && /sample-C-do-not-enter\.md/.test(docSrc) && /sample-D-insufficient-data\.md/.test(docSrc) && /sample-library-decision-gates\.md/.test(docSrc) && /sample-library-traceability-rule\.md/.test(docSrc))
  assert('文档含 架构 章节', /### 3\. 架构/.test(docSrc))
  assert('文档含 桌面入口 章节', /### 4\. 桌面入口/.test(docSrc))
  assert('文档含 双源同步 章节', /### 5\. 跨阶段双源同步/.test(docSrc))
  assert('文档含 验证 章节', /### 6\. 验证/.test(docSrc))
  assert('文档含 选品分析师 智能体名', /sourcing.*选品分析师/.test(docSrc))
  assert('文档含 报告样例库 分类根', /报告样例库/.test(docSrc))
  assert('文档含 sampleLibraryKbIngest.ts 路径', /sampleLibraryKbIngest\.ts/.test(docSrc))
  assert('文档含 SampleLibraryKbIngestor.ts 路径', /SampleLibraryKbIngestor\.ts/.test(docSrc))
  assert('文档含 幂等 关键词', /幂等/.test(docSrc))
  assert('文档含 一键入库 关键词', /一键入库/.test(docSrc))
}

// ─── 14. getSampleLibraryKbSyncSnapshot 快照完整 ─────
const snapshot = getSampleLibraryKbSyncSnapshot()
assert('snapshot.target.agentKey = sourcing', snapshot.target.agentKey === 'sourcing')
assert('snapshot.target.kbName = 选品分析师知识库', snapshot.target.kbName === '选品分析师知识库')
assert('snapshot.plan 长度 = 6', snapshot.plan.length === 6, `${snapshot.plan.length} 个`)
assert('snapshot.summary.totalDocs = 6', snapshot.summary.totalDocs === 6)
assert('snapshot.summary.totalBytes > 0', snapshot.summary.totalBytes > 0)
assert('snapshot.docCountByKind.sample = 4', snapshot.docCountByKind.sample === 4)
assert('snapshot.docCountByKind.gates = 1', snapshot.docCountByKind.gates === 1)
assert('snapshot.docCountByKind.traceability = 1', snapshot.docCountByKind.traceability === 1)
assert('summary.byCategory 含 6 叶子', Object.keys(snapshot.summary.byCategory).length === 6, `byCategory=${Object.keys(snapshot.summary.byCategory).join(',')}`)

// ─── 15. summarizeSampleLibraryKbIngestPlan 完整 ─────
const summary = summarizeSampleLibraryKbIngestPlan(plan)
assert('summary.agentKey = sourcing', summary.agentKey === 'sourcing')
assert('summary.kbName = 选品分析师知识库', summary.kbName === '选品分析师知识库')
assert('summary.categoryRoot = 报告样例库', summary.categoryRoot === '报告样例库')
assert('summary.totalDocs = 6', summary.totalDocs === 6)
assert('summary.totalBytes = plan 总和', summary.totalBytes === plan.reduce((s, d) => s + d.meta.size, 0))

// ─── 16. 边界：空文件（仅空字符串）───────────────
// 检查空文件不会被误判为 0 字节（实际 plan 物理文件都 ≥ 30KB）
assert('总字节数 ≠ 0（实际有内容）', totalBytes > 0, `totalBytes=${totalBytes}`)

// ─── 总结 ──────────────────────────────────────────
console.log('\n──────────────────────────────────────')
console.log(`断言：PASS ${pass}  FAIL ${fail}  总计 ${pass + fail}`)
if (fail === 0) {
  console.log('ALL PASS · I 阶段报告样例库 → RAGFlow 知识库入库 verify 通过 ✅')
} else {
  console.log(`FAILED：${failures.join('、')}`)
  process.exit(1)
}
