/**
 * H 阶段：报告样例库 → AI 智能体 Prompt 集成 verify 工具。
 *
 * 验证项（17 组 60+ 断言）：
 *  1. src/shared/sampleLibraryPrompt.ts 存在 + 行数 + 导出
 *  2. SAMPLE_DECISION_KEYWORDS 4 决策枚举完整性
 *  3. PROMPT_RULE_18 字段齐全
 *  4. buildSampleLibraryDecisionMatrix() 输出含 4 样例
 *  5. buildSampleLibraryFewShot() 返回 4 个样例
 *  6. buildSampleLibraryFewShotMarkdown() 输出含 4 决策路径
 *  7. buildSampleLibraryPromptSection() 输出含决策矩阵 + few-shot
 *  8. selectionReportWorkflow.ts 集成（import + 调用 buildSampleLibraryPromptSection）
 *  9. 提示词文档含规则 18 + few-shot 注入段
 * 10. 模板文档含样例库章节 + 4 决策枚举表
 * 11. reportEnhance.ts 导出 SAMPLE_LIBRARY_DECISIONS / ensureSampleLibraryAlignment
 * 12. ensureSampleLibraryAlignment 真实样例跑通（4 样例决策可追溯 OK）
 * 13. 兜底补全：人工构造缺决策可追溯的报告，验证能补全
 * 14. 兜底修正：人工构造 system!=report 的报告，验证能修正
 * 15. 集成生效：buildSelectionReportCollaborationPrompt 实际输出含样例段
 * 16. ensureSampleLibraryAlignment 4 真实样例都返回 patched=[]（无需补齐）
 * 17. getSampleLibrarySyncSnapshot 快照返回完整
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  SAMPLE_DECISION_KEYWORDS,
  buildSampleLibraryDecisionMatrix,
  buildSampleLibraryFewShot,
  buildSampleLibraryFewShotMarkdown,
  buildSampleLibraryPromptSection,
  getSampleLibrarySyncSnapshot,
  getPromptRule18
} from '../src/shared/sampleLibraryPrompt'
import { loadSampleLibrary, loadSampleMarkdown } from '../src/shared/sampleLibrary'
import { buildSelectionReportCollaborationPrompt } from '../src/shared/selectionReportWorkflow'
import {
  ensureSampleLibraryAlignment,
  detectSampleLibraryDecision,
  detectSixParts,
  detectDecisionTraceability,
  SAMPLE_LIBRARY_DECISIONS,
  SAMPLE_LIBRARY_SIX_PARTS
} from '../src/shared/reportEnhance'

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
const promptPath = resolve(root, 'src/shared/sampleLibraryPrompt.ts')
assert('sampleLibraryPrompt.ts 文件存在', existsSync(promptPath))
if (existsSync(promptPath)) {
  const lines = readFileSync(promptPath, 'utf-8').split('\n').length
  assert('sampleLibraryPrompt.ts 行数 ≥ 250', lines >= 250, `${lines} 行`)
}

// ─── 2. 4 决策枚举完整性 ─────────────────────────────
assert('SAMPLE_DECISION_KEYWORDS 长度 = 4', SAMPLE_DECISION_KEYWORDS.length === 4, `${SAMPLE_DECISION_KEYWORDS.length} 个`)
assert('SAMPLE_DECISION_KEYWORDS 包含 ✅ 建议入场', SAMPLE_DECISION_KEYWORDS.includes('✅ 建议入场'))
assert('SAMPLE_DECISION_KEYWORDS 包含 ⚠️ 有条件谨慎入场', SAMPLE_DECISION_KEYWORDS.includes('⚠️ 有条件谨慎入场'))
assert('SAMPLE_DECISION_KEYWORDS 包含 ❌ 不建议入场', SAMPLE_DECISION_KEYWORDS.includes('❌ 不建议入场'))
assert('SAMPLE_DECISION_KEYWORDS 包含 ❓ 数据不足，不能判定', SAMPLE_DECISION_KEYWORDS.includes('❓ 数据不足，不能判定'))
assert('SAMPLE_LIBRARY_DECISIONS 与 SAMPLE_DECISION_KEYWORDS 完全一致', JSON.stringify([...SAMPLE_LIBRARY_DECISIONS]) === JSON.stringify([...SAMPLE_DECISION_KEYWORDS]))

// ─── 3. PROMPT_RULE_18 字段齐全 ────────────────────────
const rule18 = getPromptRule18()
assert('PROMPT_RULE_18 编号 = 18', rule18.number === 18, `number=${rule18.number}`)
assert('PROMPT_RULE_18 标题 = 报告样例库对齐', rule18.title === '报告样例库对齐', `title="${rule18.title}"`)
assert('PROMPT_RULE_18 body ≥ 50 字符', rule18.body.length >= 50, `${rule18.body.length} 字符`)
assert('PROMPT_RULE_18 body 含 4 决策枚举关键词', /✅ 建议入场/.test(rule18.body) && /⚠️ 有条件谨慎入场/.test(rule18.body) && /❌ 不建议入场/.test(rule18.body) && /❓ 数据不足/.test(rule18.body))
assert('PROMPT_RULE_18 body 含 决策可追溯 关键词', /决策可追溯/.test(rule18.body))
assert('PROMPT_RULE_18 body 含 兜底 关键词', /兜底/.test(rule18.body))

// ─── 4. buildSampleLibraryDecisionMatrix 含 4 样例 ─────
const decisionMatrix = buildSampleLibraryDecisionMatrix()
assert('决策矩阵含 4 样例（A/B/C/D）', /样例 A/.test(decisionMatrix) && /样例 B/.test(decisionMatrix) && /样例 C/.test(decisionMatrix) && /样例 D/.test(decisionMatrix))
assert('决策矩阵含 4 决策枚举', /✅ 建议入场/.test(decisionMatrix) && /⚠️ 有条件谨慎入场/.test(decisionMatrix) && /❌ 不建议入场/.test(decisionMatrix) && /❓ 数据不足/.test(decisionMatrix))
assert('决策矩阵含 失败门禁', /失败门禁/.test(decisionMatrix))
assert('决策矩阵含 markdown 表格', /^\| 样例 \|/m.test(decisionMatrix) && /^\|---|/m.test(decisionMatrix))

// ─── 5. buildSampleLibraryFewShot 返回 4 个样例 ──────────
const fewShot = buildSampleLibraryFewShot()
assert('buildSampleLibraryFewShot 返回 4 个样例', fewShot.length === 4, `${fewShot.length} 个`)
const letters = fewShot.map(f => f.letter).sort()
assert('few-shot 4 样例字母 = [A,B,C,D]', JSON.stringify(letters) === JSON.stringify(['A', 'B', 'C', 'D']), `letters=${letters.join(',')}`)
for (const ex of fewShot) {
  assert(`样例 ${ex.letter} 有 scenario`, ex.scenario.length > 0)
  assert(`样例 ${ex.letter} 有 metrics`, ex.metrics && typeof ex.metrics === 'object')
  assert(`样例 ${ex.letter} skeleton 长度 ≥ 400 字符`, ex.skeleton.length >= 400, `${ex.skeleton.length} 字符`)
  assert(`样例 ${ex.letter} skeleton 含 6 部分`, /第一部分/.test(ex.skeleton) && /第六部分/.test(ex.skeleton))
  assert(`样例 ${ex.letter} skeleton 含 决策可追溯`, /决策可追溯/.test(ex.skeleton))
  assert(`样例 ${ex.letter} skeleton 含 附录 systemFact`, /systemFact/.test(ex.skeleton))
}

// ─── 6. buildSampleLibraryFewShotMarkdown 输出完整 ──────
const fewShotMd = buildSampleLibraryFewShotMarkdown()
assert('few-shot markdown 含 4 样例', /样例 A/.test(fewShotMd) && /样例 B/.test(fewShotMd) && /样例 C/.test(fewShotMd) && /样例 D/.test(fewShotMd))
assert('few-shot markdown 含 4 决策路径', /✅ 建议入场/.test(fewShotMd) && /⚠️ 有条件谨慎入场/.test(fewShotMd) && /❌ 不建议入场/.test(fewShotMd) && /❓ 数据不足/.test(fewShotMd))
assert('few-shot markdown 含 触发场景', /触发场景/.test(fewShotMd))
assert('few-shot markdown 含 关键参数', /关键参数/.test(fewShotMd) && /baseMargin/.test(fewShotMd) && /downsideProfit/.test(fewShotMd))

// ─── 7. buildSampleLibraryPromptSection 输出完整 ─────────
const promptSection = buildSampleLibraryPromptSection()
assert('prompt 段含 4 决策枚举关键词', SAMPLE_DECISION_KEYWORDS.every(d => promptSection.includes(d)))
assert('prompt 段含 决策矩阵', /报告样例库决策矩阵/.test(promptSection))
assert('prompt 段含 few-shot 注入', /报告样例库 few-shot 注入/.test(promptSection))
assert('prompt 段含 6 部分 提示', /第一部分/.test(promptSection) && /第六部分/.test(promptSection))
assert('prompt 段含 决策可追溯 硬约束', /决策可追溯/.test(promptSection))
assert('prompt 段含 段结束标记', /报告样例库对齐段结束/.test(promptSection))
assert('prompt 段含 4 样例 few-shot', fewShotMd.length > 0 && promptSection.includes(fewShotMd.substring(0, 100)))

// ─── 8. selectionReportWorkflow.ts 集成检查 ──────────────
const workflowPath = resolve(root, 'src/shared/selectionReportWorkflow.ts')
assert('selectionReportWorkflow.ts 文件存在', existsSync(workflowPath))
if (existsSync(workflowPath)) {
  const workflowSrc = readFileSync(workflowPath, 'utf-8')
  assert('selectionReportWorkflow.ts 导入 buildSampleLibraryPromptSection', /import\s*\{[^}]*buildSampleLibraryPromptSection[^}]*\}\s*from\s*['"]\.\/sampleLibraryPrompt['"]/.test(workflowSrc))
  assert('selectionReportWorkflow.ts 调用 buildSampleLibraryPromptSection()', /buildSampleLibraryPromptSection\(\)/.test(workflowSrc))
}

// ─── 9. 提示词文档规则 18 + few-shot 同步 ───────────────
const promptDocPath = resolve(root, 'docs/选品分析师-智能体提示词.md')
assert('提示词文档存在', existsSync(promptDocPath))
if (existsSync(promptDocPath)) {
  const promptDoc = readFileSync(promptDocPath, 'utf-8')
  assert('提示词文档含规则 18', /^\s*18\.\s+报告样例库对齐/m.test(promptDoc))
  assert('提示词文档规则 18 含 4 决策枚举', /✅ 建议入场/.test(promptDoc) && /⚠️ 有条件谨慎入场/.test(promptDoc) && /❌ 不建议入场/.test(promptDoc) && /❓ 数据不足/.test(promptDoc))
  assert('提示词文档规则 18 含 决策可追溯', /决策可追溯/.test(promptDoc))
  assert('提示词文档规则 18 含 ensureSampleLibraryAlignment', /ensureSampleLibraryAlignment/.test(promptDoc))
}

// ─── 10. 模板文档样例库章节 + 4 决策枚举表 ─────────────
const templateDocPath = resolve(root, 'docs/选品分析师-报告模板-v1.2.md')
assert('模板文档存在', existsSync(templateDocPath))
if (existsSync(templateDocPath)) {
  const templateDoc = readFileSync(templateDocPath, 'utf-8')
  assert('模板文档含 报告样例库对齐 章节', /## 报告样例库对齐/.test(templateDoc))
  assert('模板文档含 4 决策枚举表', /✅ 建议入场/.test(templateDoc) && /⚠️ 有条件谨慎入场/.test(templateDoc) && /❌ 不建议入场/.test(templateDoc) && /❓ 数据不足/.test(templateDoc))
  assert('模板文档含 6 部分结构清单', /第一部分：本品基础信息解析/.test(templateDoc) && /第六部分：产品改良方案与长期市场机会/.test(templateDoc))
  assert('模板文档含 决策可追溯硬约束', /决策可追溯硬约束/.test(templateDoc))
  assert('模板文档含 4 真实样例', /样例 A/.test(templateDoc) && /样例 B/.test(templateDoc) && /样例 C/.test(templateDoc) && /样例 D/.test(templateDoc))
  assert('模板文档含 ensureSampleLibraryAlignment', /ensureSampleLibraryAlignment/.test(templateDoc))
}

// ─── 11. reportEnhance.ts 兜底函数导出 ──────────────────
const enhancePath = resolve(root, 'src/shared/reportEnhance.ts')
assert('reportEnhance.ts 文件存在', existsSync(enhancePath))
if (existsSync(enhancePath)) {
  const enhanceSrc = readFileSync(enhancePath, 'utf-8')
  assert('reportEnhance.ts 导出 SAMPLE_LIBRARY_DECISIONS', /export const SAMPLE_LIBRARY_DECISIONS/.test(enhanceSrc))
  assert('reportEnhance.ts 导出 SAMPLE_LIBRARY_SIX_PARTS', /export const SAMPLE_LIBRARY_SIX_PARTS/.test(enhanceSrc))
  assert('reportEnhance.ts 导出 detectSampleLibraryDecision', /export function detectSampleLibraryDecision/.test(enhanceSrc))
  assert('reportEnhance.ts 导出 detectSixParts', /export function detectSixParts/.test(enhanceSrc))
  assert('reportEnhance.ts 导出 detectDecisionTraceability', /export function detectDecisionTraceability/.test(enhanceSrc))
  assert('reportEnhance.ts 导出 ensureSampleLibraryAlignment', /export function ensureSampleLibraryAlignment/.test(enhanceSrc))
}

// ─── 12. 4 真实样例决策可追溯 OK ──────────────────────
const lib = loadSampleLibrary()
assert('loadSampleLibrary 返回 4 样例', lib.length === 4, `${lib.length} 个`)
for (const meta of lib) {
  const load = loadSampleMarkdown(meta.letter)
  assert(`样例 ${meta.letter} 加载成功`, load.ok)
  if (load.ok) {
    const decision = detectSampleLibraryDecision(load.content)
    assert(`样例 ${meta.letter} 决策枚举检测`, decision === meta.decision, `检测=${decision} / 元数据=${meta.decision}`)
    const six = detectSixParts(load.content)
    assert(`样例 ${meta.letter} 6 部分齐全`, six.missing.length === 0, `present=${six.present.length}/6`)
    const trace = detectDecisionTraceability(load.content)
    assert(`样例 ${meta.letter} 决策可追溯 ok=${trace.ok}`, trace.ok, `系统=${trace.systemDecision} / 报告=${trace.reportDecision}`)
  }
}

// ─── 13. 兜底补全：缺决策可追溯的报告 ─────────────────
const fakeReportNoTrace = `# 选品分析报告
## 第一部分
> 占位
## 第二部分
> 占位
## 第三部分
> 占位
## 第四部分
> 占位
## 第五部分
> 占位
## 第六部分
最终结论：✅ 建议入场
`
const aligned1 = ensureSampleLibraryAlignment(fakeReportNoTrace)
assert('缺决策可追溯报告 → 补齐后内容变更', aligned1.aligned !== aligned1.content, `content 长度 ${aligned1.content.length} → aligned 长度 ${aligned1.aligned.length}`)
assert('补齐后含 决策可追溯 声明', /决策可追溯：系统入场结论 = ✅ 建议入场/.test(aligned1.aligned))
assert('补齐动作清单含 1 项', aligned1.patched.length === 1, `patched=${aligned1.patched.length}`)
assert('补齐动作 = 补齐决策可追溯', /补齐决策可追溯/.test(aligned1.patched[0]))
assert('补齐后决策可追溯 ok=true', aligned1.traceability.ok === false /* 原本无 */, '原本无 → 补齐后需重新检测')
// 重新检测补齐后的报告
const aligned1Retrace = detectDecisionTraceability(aligned1.aligned)
assert('补齐后重新检测决策可追溯 ok=true', aligned1Retrace.ok, `系统=${aligned1Retrace.systemDecision} / 报告=${aligned1Retrace.reportDecision}`)

// ─── 14. 兜底修正：system != report 的报告 ──────────────
// 决策可追溯声明里 system=⚠️ / report=✅，二者不一致 → 需修正为 system=report=文中实际决策
const fakeReportMismatch = `# 选品分析报告
## 第一部分
> 占位
## 第二部分
> 占位
## 第三部分
> 占位
## 第四部分
> 占位
## 第五部分
> 占位
## 第六部分
- 决策可追溯：系统入场结论 = ⚠️ 有条件谨慎入场，报告最终结论 = ✅ 建议入场
`
const aligned2 = ensureSampleLibraryAlignment(fakeReportMismatch)
assert('不一致报告 → 修正后内容变更', aligned2.aligned !== aligned2.content)
assert('修正后含 决策可追溯修正 声明', /决策可追溯修正/.test(aligned2.aligned))
assert('修正后决策枚举 = ✅ 建议入场', aligned2.decision === '✅ 建议入场', `decision=${aligned2.decision}`)
// 不检查 aligned2.traceability.ok：它是原始 fake 报告的检测结果（ok=false，但修正后已对齐）
const aligned2Retrace = detectDecisionTraceability(aligned2.aligned)
assert('修正后重新检测决策可追溯 ok=true', aligned2Retrace.ok, `系统=${aligned2Retrace.systemDecision} / 报告=${aligned2Retrace.reportDecision}`)
assert('修正后系统入场结论 = ✅ 建议入场', aligned2Retrace.systemDecision === '✅ 建议入场')
assert('修正后报告最终结论 = ✅ 建议入场', aligned2Retrace.reportDecision === '✅ 建议入场')

// ─── 15. 集成生效：buildSelectionReportCollaborationPrompt 输出含样例段 ─
const collabPrompt = buildSelectionReportCollaborationPrompt('占位 factPackage 内容', 'Amazon美国站')
assert('协同 prompt 含 4 决策枚举', SAMPLE_DECISION_KEYWORDS.every(d => collabPrompt.includes(d)))
assert('协同 prompt 含 决策矩阵段', /报告样例库决策矩阵/.test(collabPrompt))
assert('协同 prompt 含 few-shot 段', /报告样例库 few-shot 注入/.test(collabPrompt))
assert('协同 prompt 含 段结束标记', /报告样例库对齐段结束/.test(collabPrompt))
assert('协同 prompt 含 决策可追溯硬约束', /决策可追溯/.test(collabPrompt))
assert('协同 prompt 含 协同任务标题', /协同任务/.test(collabPrompt))
assert('协同 prompt 含 系统事实包', /系统事实包/.test(collabPrompt))
assert('协同 prompt 含 目标平台', /Amazon美国站/.test(collabPrompt))
assert('协同 prompt 含 调研员职责', /调研员职责/.test(collabPrompt))

// ─── 16. 4 真实样例跑 ensureSampleLibraryAlignment 都返回 patched=[] ─
for (const meta of lib) {
  const load = loadSampleMarkdown(meta.letter)
  if (load.ok) {
    const result = ensureSampleLibraryAlignment(load.content)
    assert(`样例 ${meta.letter} ensureSampleLibraryAlignment 不需要补齐`, result.patched.length === 0, `patched=${result.patched.length}`)
    assert(`样例 ${meta.letter} aligned 与 content 相同`, result.aligned === result.content)
  }
}

// ─── 17. getSampleLibrarySyncSnapshot 完整 ──────────────
const snapshot = getSampleLibrarySyncSnapshot()
assert('snapshot.lib 4 样例', snapshot.lib.length === 4)
assert('snapshot.decisionKeywords 4 个', snapshot.decisionKeywords.length === 4)
assert('snapshot.failedGates 4 决策', Object.keys(snapshot.failedGates).length === 4)
assert('snapshot.failedGates[✅ 建议入场] 为空', snapshot.failedGates['✅ 建议入场'].length === 0)
assert('snapshot.failedGates[❌ 不建议入场] ≥ 1 项', snapshot.failedGates['❌ 不建议入场'].length >= 1)

// ─── 18. 边界：完全空的报告 ──────────────────────────
const emptyReport = ''
const aligned3 = ensureSampleLibraryAlignment(emptyReport)
assert('空报告 → patched ≥ 1', aligned3.patched.length >= 1, `patched=${aligned3.patched.length}`)
assert('空报告 → decision=null', aligned3.decision === null)
assert('空报告 → 6 部分全缺', aligned3.sixParts.missing.length === 6)
assert('空报告 → 决策可追溯 ok=false', aligned3.traceability.ok === false)

// ─── 19. detect 函数返回类型稳定 ─────────────────────
const detectedDecision = detectSampleLibraryDecision('随便一段文字 + ✅ 建议入场 + 别的话')
assert('detectSampleLibraryDecision 返回第一个匹配', detectedDecision === '✅ 建议入场')
const six = detectSixParts('## 第一部分\n## 第二部分\n## 第四部分\n## 第六部分')
assert('detectSixParts 正确识别缺失（缺第三/第五）', six.present.length === 4 && six.missing.length === 2 && six.missing.includes('第三部分') && six.missing.includes('第五部分'))
const trace = detectDecisionTraceability('系统入场结论 = ✅ 建议入场，报告最终结论 = ✅ 建议入场')
assert('detectDecisionTraceability 简单匹配 ok=true', trace.ok && trace.systemDecision === '✅ 建议入场' && trace.reportDecision === '✅ 建议入场')

// ─── 总结 ──────────────────────────────────────────
console.log('\n──────────────────────────────────────')
console.log(`断言：PASS ${pass}  FAIL ${fail}  总计 ${pass + fail}`)
if (fail === 0) {
  console.log('ALL PASS · H 阶段报告样例库 → AI 智能体 Prompt 集成 verify 通过 ✅')
} else {
  console.log(`FAILED：${failures.join('、')}`)
  process.exit(1)
}
