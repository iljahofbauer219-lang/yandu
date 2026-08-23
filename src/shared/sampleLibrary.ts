/**
 * 报告样例库（G 阶段新增）。
 *
 * 数据源：artifacts/online-advisor-parity/sample-{A,B,C,D}-*.md + .docx
 * 目的：在桌面应用内提供样例库在线预览（左侧 4 卡片 + 右侧渲染）。
 *
 * 设计原则：
 *   1. 纯函数：从工件目录读样例，不依赖 React/Electron
 *   2. 决策可追溯：样例元数据中的"系统入场结论"与 markdown 报告中的"报告最终结论"必须完全一致
 *   3. 4 样例全覆盖 4 种决策：✅ 建议入场 / ⚠️ 有条件谨慎入场 / ❌ 不建议入场 / ❓ 数据不足
 *   4. 路径解析兼容 dev/build 两种环境（开发期走 cwd，build 后走 process.resourcesPath）
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

// ── 1. 决策枚举与视觉令牌 ────────────────────────────────────────────

export type SampleLetter = 'A' | 'B' | 'C' | 'D'

export type SampleDecision =
  | '✅ 建议入场'
  | '⚠️ 有条件谨慎入场'
  | '❌ 不建议入场'
  | '❓ 数据不足，不能判定'

export interface SampleDecisionToken {
  /** 决策徽章底色（用于卡片左侧色条 + 徽章背景） */
  accentColor: string
  /** 决策徽章深色（用于文字） */
  textColor: string
  /** 决策徽章背景（淡色，alpha 14） */
  bgColor: string
  /** 适合深色/浅色双主题的中性文字色（与背景对比度 ≥ 4.5） */
  fgColor: string
}

export const SAMPLE_DECISION_TOKENS: Record<SampleDecision, SampleDecisionToken> = {
  '✅ 建议入场': { accentColor: '#10b981', textColor: '#065f46', bgColor: 'rgba(16,185,129,0.14)', fgColor: '#047857' },
  '⚠️ 有条件谨慎入场': { accentColor: '#f59e0b', textColor: '#92400e', bgColor: 'rgba(245,158,11,0.14)', fgColor: '#b45309' },
  '❌ 不建议入场': { accentColor: '#ef4444', textColor: '#991b1b', bgColor: 'rgba(239,68,68,0.14)', fgColor: '#b91c1c' },
  '❓ 数据不足，不能判定': { accentColor: '#6b7280', textColor: '#374151', bgColor: 'rgba(107,114,128,0.14)', fgColor: '#4b5563' }
}

// ── 2. 4 样例元数据（与 sample-generator.mjs 强一致）──────────────────

export interface SampleMeta {
  letter: SampleLetter
  decision: SampleDecision
  title: string
  subtitle: string
  /** 一句话概括：什么参数触发了这个决策 */
  reason: string
  /** 关键数字摘要（直接显示在卡片上） */
  keyMetrics: {
    baseMargin: number | null      // base 情景毛利率（%）
    downsideProfit: number | null  // downside 情景每件利润（USD）
    directCount: number | null
    coveragePercent: number | null
  }
  /** 工件目录中的 markdown 文件名 */
  markdownFile: string
  /** 工件目录中的 .docx 文件名 */
  docxFile: string
  /** 工件目录绝对路径（dev 与 build 兼容） */
  artifactDir: string
  /** markdown 绝对路径 */
  markdownPath: string
  /** .docx 绝对路径 */
  docxPath: string
  /** 文件大小（字节），运行时检测 */
  markdownSize: number
  docxSize: number
  /** 标签：按决策门禁分组的失败原因 */
  failedGates: string[]
}

const SAMPLE_DEFINITIONS: Array<{
  letter: SampleLetter
  decision: SampleDecision
  title: string
  subtitle: string
  reason: string
  keyMetrics: { baseMargin: number | null; downsideProfit: number | null; directCount: number | null; coveragePercent: number | null }
  markdownFile: string
  docxFile: string
  failedGates: string[]
}> = [
  {
    letter: 'A',
    decision: '✅ 建议入场',
    title: '宠物免洗清洁喷雾 200ml',
    subtitle: '✅ 建议入场 · 高利润高覆盖',
    reason: '15 DIRECT + 毛利 39.3% + 悲观 profit $8.57，证据完整率高',
    keyMetrics: { baseMargin: 39.3, downsideProfit: 8.57, directCount: 15, coveragePercent: 100 },
    markdownFile: 'sample-A-recommend-entry.md',
    docxFile: 'sample-A-recommend-entry.docx',
    failedGates: []
  },
  {
    letter: 'B',
    decision: '⚠️ 有条件谨慎入场',
    title: '宠物免洗清洁喷雾 200ml',
    subtitle: '⚠️ 有条件谨慎入场 · 合规证据偏短',
    reason: 'complianceIpEvidence 字符 < 8 触发"有条件"门禁，需补强合规依据',
    keyMetrics: { baseMargin: 35.2, downsideProfit: 7.91, directCount: 15, coveragePercent: 100 },
    markdownFile: 'sample-B-conditional-entry.md',
    docxFile: 'sample-B-conditional-entry.docx',
    failedGates: ['complianceIpEvidence ≥ 8 字符']
  },
  {
    letter: 'C',
    decision: '❌ 不建议入场',
    title: '宠物免洗清洁喷雾 200ml',
    subtitle: '❌ 不建议入场 · 成本结构过重',
    reason: 'base 毛利 -17.6% + 悲观 profit -$8.00，定价不足以覆盖全成本',
    keyMetrics: { baseMargin: -17.6, downsideProfit: -8.0, directCount: 15, coveragePercent: 100 },
    markdownFile: 'sample-C-do-not-enter.md',
    docxFile: 'sample-C-do-not-enter.docx',
    failedGates: ['numbers.base.margin ≥ target', 'numbers.downside.profit ≥ 0']
  },
  {
    letter: 'D',
    decision: '❓ 数据不足，不能判定',
    title: '宠物免洗清洁喷雾 200ml',
    subtitle: '❓ 数据不足 · 23 evidence 全未核验',
    reason: '23 evidence 字段 decisionEligible=false，无法进入决策门禁',
    keyMetrics: { baseMargin: null, downsideProfit: null, directCount: null, coveragePercent: null },
    markdownFile: 'sample-D-insufficient-data.md',
    docxFile: 'sample-D-insufficient-data.docx',
    failedGates: ['23 evidence 全部 decisionEligible=true']
  }
]

// ── 3. 路径解析（dev + build 兼容）─────────────────────────────────

/**
 * 解析报告样例库工件目录的绝对路径。
 *
 * 优先级：
 *   1. <cwd>/artifacts/online-advisor-parity/         （开发期，Vite + Electron 同目录）
 *   2. <__dirname>/../../../artifacts/online-advisor-parity/   （从 src/shared 出发往上 3 级到 repo root）
 *   3. <resourcesPath>/artifacts/online-advisor-parity/         （Electron 打包后）
 */
export function resolveArtifactDir(): string {
  const candidates: string[] = []

  // 1. cwd 相对
  candidates.push(resolve(process.cwd(), 'artifacts', 'online-advisor-parity'))

  // 2. 从 src/shared 出发（tsx verify 工具用 fileURLToPath）
  // CJS / tsx 都注入 __dirname；这里用作 src/shared 路径定位
  const here = typeof __dirname === 'string' ? __dirname : process.cwd()
  // src/shared -> src -> repo root
  candidates.push(resolve(here, '..', '..', 'artifacts', 'online-advisor-parity'))
  // build 后 src/shared 可能更深，多加一级兼容
  candidates.push(resolve(here, '..', '..', '..', 'artifacts', 'online-advisor-parity'))
  candidates.push(resolve(here, '..', '..', '..', '..', 'artifacts', 'online-advisor-parity'))

  // 3. Electron 打包后 resourcesPath（Node 类型没有，运行时由 Electron 注入）
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    candidates.push(resolve(resourcesPath, 'artifacts', 'online-advisor-parity'))
  }

  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // 返回第一个候选（即使不存在）让上层拿到稳定路径
  return candidates[0]
}

// ── 4. 列表 / 加载 API ──────────────────────────────────────────────

export function listSampleLetters(): SampleLetter[] {
  return ['A', 'B', 'C', 'D']
}

export function loadSampleLibrary(): SampleMeta[] {
  const artifactDir = resolveArtifactDir()
  return SAMPLE_DEFINITIONS.map(def => {
    const markdownPath = join(artifactDir, def.markdownFile)
    const docxPath = join(artifactDir, def.docxFile)
    const markdownSize = existsSync(markdownPath) ? statSync(markdownPath).size : 0
    const docxSize = existsSync(docxPath) ? statSync(docxPath).size : 0
    return {
      ...def,
      artifactDir,
      markdownPath,
      docxPath,
      markdownSize,
      docxSize
    }
  })
}

export interface LoadedSample {
  ok: true
  meta: SampleMeta
  content: string
}

export interface LoadError {
  ok: false
  error: string
  meta: SampleMeta
}

export function loadSampleMarkdown(letter: SampleLetter): LoadedSample | LoadError {
  const lib = loadSampleLibrary()
  const meta = lib.find(s => s.letter === letter)
  if (!meta) return { ok: false, error: `未知样例: ${letter}`, meta: { ...lib[0], markdownSize: 0, docxSize: 0 } }
  if (!existsSync(meta.markdownPath)) {
    return { ok: false, error: `报告 markdown 缺失: ${meta.markdownPath}`, meta }
  }
  try {
    const content = readFileSync(meta.markdownPath, 'utf-8')
    return { ok: true, meta, content }
  } catch (err) {
    return { ok: false, error: `读取失败: ${(err as Error).message}`, meta }
  }
}

// ── 5. 报告元数据解析（供 UI 摘要 / verify 工具使用）────────────────

export interface ReportExtractedMetadata {
  h1Title: string | null
  h2Count: number
  h3Count: number
  paragraphCount: number
  tableCount: number
  listItemCount: number
  linkCount: number
  hasAppendix: boolean
  hasSixParts: boolean
  sixParts: string[]  // 第一部分 ... 第六部分
  decisionLine: string | null
  hasDecisionTraceability: boolean
  /** 提取的 baseMargin / downsideProfit（仅在 report 中显式存在时） */
  baseMargin: number | null
  downsideProfit: number | null
}

export function extractReportMetadata(content: string): ReportExtractedMetadata {
  const lines = content.split('\n')
  const h1Title = (lines.find(l => l.startsWith('# ')) ?? '').replace(/^#\s+/, '').trim() || null
  const h2Count = lines.filter(l => /^##\s+/.test(l)).length
  const h3Count = lines.filter(l => /^###\s+/.test(l)).length
  // 段落：以空行分隔的非标题/非列表段
  const blocks = content.split(/\n\s*\n/)
  const paragraphCount = blocks.filter(b => {
    const t = b.trim()
    if (!t) return false
    if (/^#{1,6}\s/.test(t)) return false
    if (/^[-*]\s/.test(t)) return false
    if (/^\d+\.\s/.test(t)) return false
    if (/^>\s/.test(t)) return false
    if (/^\|/.test(t)) return false
    if (/^---/.test(t)) return false
    return true
  }).length
  const tableCount = blocks.filter(b => /^\|.*\|/m.test(b) && /\|[\s-:|]+\|/m.test(b)).length
  const listItemCount = lines.filter(l => /^[-*]\s/.test(l) || /^\d+\.\s/.test(l)).length
  const linkCount = (content.match(/\[[^\]]+\]\([^)]+\)/g) || []).length
  const hasAppendix = /^##\s+附录/m.test(content)
  // 六部分检测
  const sixParts: string[] = []
  for (let i = 1; i <= 6; i += 1) {
    const re = new RegExp(`^##\\s+第${'一二三四五六'[i - 1]}部分`, 'm')
    if (re.test(content)) sixParts.push(`第${'一二三四五六'[i - 1]}部分`)
  }
  const hasSixParts = sixParts.length === 6
  // 决策可追溯（lookahead 让 systemDecision 包含到「，报告最终结论」之前的所有内容，兼容 4 决策枚举中的中文逗号）
  const TRACEABILITY_RE = /系统入场结论\s*=\s*([\s\S]+?)(?=[，,]\s*报告最终结论)[，,]\s*报告最终结论\s*=\s*([\s\S]+?)(?=[，,。.;；\n]|$)/
  const hasDecisionTraceability = TRACEABILITY_RE.test(content)
  const decisionMatch = content.match(TRACEABILITY_RE)
  const decisionLine = decisionMatch
    ? `系统入场结论 = ${decisionMatch[1].trim().replace(/[，,。.;；]+$/, '')}，报告最终结论 = ${decisionMatch[2].trim().replace(/[，,。.;；]+$/, '')}`
    : null
  // 提取 baseMargin / downsideProfit
  const baseMarginMatch = content.match(/base\s*(?:margin|毛利(?:率)?)[\s:：=]+(-?\d+(?:\.\d+)?)\s*%?/i)
  const downsideMatch = content.match(/downside[^\d\-]*([-\d.]+)/i)
  const baseMargin = baseMarginMatch ? Number(baseMarginMatch[1]) : null
  const downsideProfit = downsideMatch ? Number(downsideMatch[1]) : null

  return {
    h1Title,
    h2Count,
    h3Count,
    paragraphCount,
    tableCount,
    listItemCount,
    linkCount,
    hasAppendix,
    hasSixParts,
    sixParts,
    decisionLine,
    hasDecisionTraceability,
    baseMargin,
    downsideProfit
  }
}

// ── 6. 决策一致性硬约束（供 verify 工具用）──────────────────────────

export function assertDecisionConsistency(meta: SampleMeta, content: string): { ok: true } | { ok: false; reason: string } {
  const extracted = extractReportMetadata(content)
  if (!extracted.decisionLine) {
    return { ok: false, reason: '报告缺少"系统入场结论 = 报告最终结论"链路声明' }
  }
  if (!extracted.decisionLine.includes(meta.decision)) {
    return { ok: false, reason: `元数据决策 ${meta.decision} 与报告声明不一致: ${extracted.decisionLine}` }
  }
  return { ok: true }
}
