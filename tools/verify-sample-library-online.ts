#!/usr/bin/env node
/**
 * G 阶段：报告样例库在线预览 verify 工具。
 *
 * 验证样例库在桌面应用内能正确加载 + 渲染：
 *   1. 纯函数 src/shared/sampleLibrary.ts 存在 + ≥ 250 行
 *   2. 纯函数 loadSampleLibrary 返回 4 个样例元数据
 *   3. 4 个样例的 markdown 都能成功加载（content 长度 > 5KB）
 *   4. 4 个样例的 .docx 都能成功加载（size > 5KB）
 *   5. 4 样例的决策枚举 = 4 种期望决策（A✅/B⚠️/C❌/D❓）
 *   6. 决策可追溯：每个样例的元数据决策 = 报告声明中的系统入场结论
 *   7. 6 部分齐全：每个样例报告都包含第一部分...第六部分
 *   8. 附录 systemFact 块：每个样例报告都含"附录"段
 *   9. 元数据解析：extractReportMetadata 能正确解析 H1/H2/表格/段落
 *   10. 路径解析：resolveArtifactDir 返回存在的目录
 *   11. 页面文件存在：src/renderer/SampleLibrary.tsx ≥ 200 行
 *   12. 样式文件存在：src/renderer/sample-library.css ≥ 200 行
 *   13. App.tsx 已加入口：'ai-sample-library' + '报告样例库' 卡片
 *   14. main.ts IPC：'ai-sample-library:open-docx' + 'ai-sample-library:list'
 *   15. preload 已暴露：sampleLibrary.list + sampleLibrary.openDocx
 *   16. global.d.ts 类型契约：sampleLibrary 已加入 aiEmployee
 *   17. 报告样例库文档补充 G 阶段章节 + ≥ 250 行
 *   18. 决策硬约束：assertDecisionConsistency 对 4 样例都返回 ok
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function main() {
  // ─── 1. 纯函数存在 + 行数 ───────────────────────────────────────
  const sampleLibPath = resolve(root, 'src/shared/sampleLibrary.ts')
  assert('src/shared/sampleLibrary.ts 存在', existsSync(sampleLibPath))
  if (!existsSync(sampleLibPath)) {
    console.log(`${failures} FAILURES`)
    process.exit(1)
  }
  const sampleLibContent = readFileSync(sampleLibPath, 'utf-8')
  const sampleLibLines = sampleLibContent.split('\n').length
  assert('sampleLibrary.ts 行数 ≥ 250', sampleLibLines >= 250, `实际 ${sampleLibLines} 行`)

  // 动态 import 纯函数
  const { loadSampleLibrary, loadSampleMarkdown, extractReportMetadata, assertDecisionConsistency, resolveArtifactDir, listSampleLetters } = await import('../src/shared/sampleLibrary.ts')

  // ─── 2. 列表 / 字母顺序 ──────────────────────────────────────────
  const letters = listSampleLetters()
  assert('listSampleLetters 返回 4 个字母', letters.length === 4, `实际 ${letters.length}`)
  assert('字母顺序 A/B/C/D', JSON.stringify(letters) === JSON.stringify(['A', 'B', 'C', 'D']))

  // ─── 3. 4 样例元数据 ─────────────────────────────────────────────
  const lib = loadSampleLibrary()
  assert('loadSampleLibrary 返回 4 样例', lib.length === 4, `实际 ${lib.length}`)
  const expectedDecisions = ['✅ 建议入场', '⚠️ 有条件谨慎入场', '❌ 不建议入场', '❓ 数据不足，不能判定']
  lib.forEach((meta, idx) => {
    assert(`样例 ${meta.letter} 决策 = ${expectedDecisions[idx]}`, meta.decision === expectedDecisions[idx], `实际 ${meta.decision}`)
  })

  // ─── 4. 路径解析 ────────────────────────────────────────────────
  const artifactDir = resolveArtifactDir()
  assert('resolveArtifactDir 返回存在目录', existsSync(artifactDir), artifactDir)
  assert('artifactDir 包含 sample-A', existsSync(resolve(artifactDir, 'sample-A-recommend-entry.md')))

  // ─── 5. 4 markdown 加载 ──────────────────────────────────────────
  for (const letter of letters) {
    const result = loadSampleMarkdown(letter)
    if (!result.ok) {
      assert(`样例 ${letter} markdown 加载成功`, false, result.error)
      continue
    }
    assert(`样例 ${letter} markdown 加载成功`, true, `长度 ${result.content.length} 字符`)
    assert(`样例 ${letter} markdown 长度 ≥ 5000`, result.content.length >= 5000, `实际 ${result.content.length}`)

    // ─── 6. 决策可追溯 ──────────────────────────────────────────
    const consistency = assertDecisionConsistency(result.meta, result.content)
    assert(`样例 ${letter} 决策可追溯 (系统 = 报告)`, consistency.ok, consistency.ok ? '' : consistency.reason)

    // ─── 7. 6 部分齐全 ──────────────────────────────────────────
    const meta = extractReportMetadata(result.content)
    assert(`样例 ${letter} H1 标题存在`, meta.h1Title !== null, meta.h1Title ?? '(空)')
    assert(`样例 ${letter} H2 数量 ≥ 5`, meta.h2Count >= 5, `实际 ${meta.h2Count}`)
    assert(`样例 ${letter} 表格数量 ≥ 1`, meta.tableCount >= 1, `实际 ${meta.tableCount}`)
    assert(`样例 ${letter} 含附录 systemFact 块`, meta.hasAppendix)
    assert(`样例 ${letter} 6 部分齐全 (第一..第六)`, meta.hasSixParts, meta.sixParts.join(' / '))
    assert(`样例 ${letter} 含"系统入场结论 = 报告最终结论"链路`, meta.hasDecisionTraceability, meta.decisionLine ?? '(空)')
  }

  // ─── 8. .docx 4 份存在 + ≥ 5KB ───────────────────────────────────
  for (const meta of lib) {
    assert(`样例 ${meta.letter} .docx 存在`, existsSync(meta.docxPath), meta.docxPath)
    assert(`样例 ${meta.letter} .docx 大小 ≥ 5KB`, meta.docxSize >= 5 * 1024, `${(meta.docxSize / 1024).toFixed(1)} KB`)
  }

  // ─── 9. markdown 文件大小 ─────────────────────────────────────────
  for (const meta of lib) {
    assert(`样例 ${meta.letter} markdown 存在`, existsSync(meta.markdownPath))
    const stat = statSync(meta.markdownPath)
    assert(`样例 ${meta.letter} markdown 大小 ≥ 5KB`, stat.size >= 5 * 1024, `${(stat.size / 1024).toFixed(1)} KB`)
  }

  // ─── 10. 关键参数（从样例库元数据读，不从 markdown 提取） ───────────
  // 原因：markdown 报告里只展示门禁链路表，没有 baseMargin/downsideProfit 字段；
  //       这些数字在样例库元数据（keyMetrics）中已结构化维护。
  const sampleA = lib.find(m => m.letter === 'A')!
  assert('样例 A baseMargin ≥ 30', sampleA.keyMetrics.baseMargin !== null && sampleA.keyMetrics.baseMargin >= 30, `元数据 ${sampleA.keyMetrics.baseMargin}%`)
  assert('样例 A downsideProfit > 0', sampleA.keyMetrics.downsideProfit !== null && sampleA.keyMetrics.downsideProfit > 0, `元数据 $${sampleA.keyMetrics.downsideProfit}`)
  const sampleC = lib.find(m => m.letter === 'C')!
  assert('样例 C baseMargin < 0（验证极端场景）', sampleC.keyMetrics.baseMargin !== null && sampleC.keyMetrics.baseMargin < 0, `元数据 ${sampleC.keyMetrics.baseMargin}%`)
  const sampleD = lib.find(m => m.letter === 'D')!
  assert('样例 D 数据不足（baseMargin=null）', sampleD.keyMetrics.baseMargin === null, `元数据 ${sampleD.keyMetrics.baseMargin}%`)

  // ─── 11. 页面文件存在 + 行数 ─────────────────────────────────────
  const pagePath = resolve(root, 'src/renderer/SampleLibrary.tsx')
  assert('src/renderer/SampleLibrary.tsx 存在', existsSync(pagePath))
  const pageContent = readFileSync(pagePath, 'utf-8')
  const pageLines = pageContent.split('\n').length
  assert('SampleLibrary.tsx 行数 ≥ 200', pageLines >= 200, `实际 ${pageLines}`)

  // ─── 12. 样式文件存在 + 行数 ─────────────────────────────────────
  const cssPath = resolve(root, 'src/renderer/sample-library.css')
  assert('src/renderer/sample-library.css 存在', existsSync(cssPath))
  const cssContent = readFileSync(cssPath, 'utf-8')
  const cssLines = cssContent.split('\n').length
  assert('sample-library.css 行数 ≥ 200', cssLines >= 200, `实际 ${cssLines}`)

  // ─── 13. App.tsx 入口 ───────────────────────────────────────────
  const appPath = resolve(root, 'src/renderer/App.tsx')
  const appContent = readFileSync(appPath, 'utf-8')
  assert('App.tsx 包含 ai-sample-library 页面类型', appContent.includes("'ai-sample-library'"))
  assert('App.tsx 包含 SampleLibrary 组件导入', appContent.includes("import SampleLibrary from './SampleLibrary'"))
  assert('App.tsx 包含 报告样例库 卡片', appContent.includes('报告样例库'))
  assert('App.tsx 包含菜单权限 menu.advisor', /'ai-sample-library':\s*'menu\.advisor'/.test(appContent))
  assert('App.tsx 包含 page === \'ai-sample-library\' 路由', appContent.includes("page==='ai-sample-library'"))

  // ─── 14. main.ts IPC ────────────────────────────────────────────
  const mainPath = resolve(root, 'src/main/main.ts')
  const mainContent = readFileSync(mainPath, 'utf-8')
  assert('main.ts 包含 ai-sample-library:open-docx handler', mainContent.includes("'ai-sample-library:open-docx'"))
  assert('main.ts 包含 ai-sample-library:list handler', mainContent.includes("'ai-sample-library:list'"))
  assert('main.ts 调起 shell.openPath', mainContent.includes('shell.openPath'))
  assert('main.ts 导入 loadSampleLibrary', mainContent.includes("import { loadSampleLibrary } from '../shared/sampleLibrary'"))

  // ─── 15. preload.ts 暴露 ────────────────────────────────────────
  const preloadPath = resolve(root, 'src/preload/preload.ts')
  const preloadContent = readFileSync(preloadPath, 'utf-8')
  assert('preload.ts 暴露 sampleLibrary.list', /sampleLibrary:[\s\S]*?list:[\s\S]*?invoke\('ai-sample-library:list'/.test(preloadContent))
  assert('preload.ts 暴露 sampleLibrary.openDocx', preloadContent.includes("invoke('ai-sample-library:open-docx'"))

  // ─── 16. global.d.ts 类型契约 ────────────────────────────────────
  const globalPath = resolve(root, 'src/renderer/global.d.ts')
  const globalContent = readFileSync(globalPath, 'utf-8')
  assert('global.d.ts 包含 sampleLibrary 类型', globalContent.includes('sampleLibrary:'))
  assert('global.d.ts 包含 openDocx 类型', /openDocx\([^)]*\{[^}]*filePath:[^}]*string[^}]*\}/.test(globalContent))
  assert('global.d.ts 包含 list 类型', /list\(\)/.test(globalContent))

  // ─── 17. 报告样例库文档 ──────────────────────────────────────────
  const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
  assert('docs/选品分析师-报告样例库.md 存在', existsSync(docPath))
  if (existsSync(docPath)) {
    const docContent = readFileSync(docPath, 'utf-8')
    const docLines = docContent.split('\n').length
    assert('样例库文档行数 ≥ 250', docLines >= 250, `实际 ${docLines}`)
    assert('样例库文档含 G 阶段章节', /G 阶段|G 阶段新增|样例库在线预览/.test(docContent))
  }

  // ─── 18. 决策可追溯：跨 4 样例硬约束 ────────────────────────────
  for (const letter of letters) {
    const result = loadSampleMarkdown(letter)
    if (!result.ok) continue
    const meta = lib.find(s => s.letter === letter)!
    const consistency = assertDecisionConsistency(meta, result.content)
    assert(`硬约束: 样例 ${letter} 系统决策 = 报告结论`, consistency.ok)
  }

  // ── 总结 ──
  console.log('')
  if (failures === 0) {
    console.log('✅ ALL PASS · G 阶段报告样例库在线预览链路完整')
  } else {
    console.log(`❌ ${failures} FAILURES`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('FATAL', err)
  process.exit(1)
})
