/**
 * 报告样例库 → MaxKB 知识库入库计划（I 阶段新增，阶段 5 切到 MaxKB）。
 *
 * 目的：把 4 真实样例 + 决策门禁汇总 + 决策可追溯硬约束以 KB 文档形式归档到
 *   「选品分析师」MaxKB 知识库（agentKey='sourcing'），让所有 AI 员工
 *   在跨任务中都能参考这 4 个标准答案与硬约束。
 *
 * 设计原则：
 *   - 纯函数：buildSampleLibraryKbIngestPlan() 不依赖 MaxKB / Electron
 *   - 幂等：上传时按文件名去重，重复运行只解析新文档
 *   - 多级分类：报告样例库 / A、报告样例库 / B、报告样例库 / 决策门禁、报告样例库 / 可追溯约束
 *   - 文件来源单一：artifacts/online-advisor-parity/ 6 份 markdown
 *   - 双源更新（deacb2a1 记忆）：数据/分类名/规模变化需同步 docs/选品分析师-报告样例库.md
 */

import { join, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { KbAgentKey } from './knowledge'

// ── 1. 入库目标（与 MaxkbKnowledgeService KB_AGENTS 保持一致）────────

export const SAMPLE_LIBRARY_KB_TARGET = {
  agentKey: 'sourcing' as KbAgentKey,
  /** MaxKB 知识库名（MaxKB 内显示） */
  kbName: '选品分析师知识库',
  /** 数据集描述 */
  description: '1688 商品机会评估 · 亚马逊选品分析。内置 4 真实样例（A/B/C/D）+ 决策门禁 + 决策可追溯硬约束。',
  /** 多级分类根名（叶子名 = ${categoryRoot}/${subCategory}） */
  categoryRoot: '报告样例库'
} as const

// ── 2. 文档类型（叶子分类）────────────────────────────────────────

export type SampleLibraryKbLeafCategory =
  | '报告样例库/A'
  | '报告样例库/B'
  | '报告样例库/C'
  | '报告样例库/D'
  | '报告样例库/决策门禁'
  | '报告样例库/可追溯约束'

// ── 3. 入库文档元信息（纯数据，运行时检测 size）─────────────────────

export interface SampleLibraryKbDoc {
  /** 文档名（MaxKB 知识库内显示，等于文件 basename） */
  name: string
  /** 物理文件绝对路径（artifacts/online-advisor-parity/） */
  filePath: string
  /** 叶子分类名（meta_fields.category 存这个值） */
  category: SampleLibraryKbLeafCategory
  /** 文档元信息 */
  meta: {
    /** 样例字母（A/B/C/D）或辅助文档类型 */
    kind: 'sample' | 'gates' | 'traceability'
    letter?: 'A' | 'B' | 'C' | 'D'
    /** 文档大小（字节，运行时检测） */
    size: number
  }
}

// ── 4. 入库计划（6 文档，2 辅助 + 4 样例）──────────────────────────

/** 6 份入库文档的定义（与 artifacts/online-advisor-parity/ 强一致） */
// I.2 阶段新增 export：启动器（SampleLibraryKbGuardianLauncher）需要引用此数组生成 categoryResolver
export const SAMPLE_LIBRARY_KB_DOCS: Array<{
  fileName: string
  category: SampleLibraryKbLeafCategory
  meta: SampleLibraryKbDoc['meta']
}> = [
  { fileName: 'sample-A-recommend-entry.md', category: '报告样例库/A', meta: { kind: 'sample', letter: 'A', size: 0 } },
  { fileName: 'sample-B-conditional-entry.md', category: '报告样例库/B', meta: { kind: 'sample', letter: 'B', size: 0 } },
  { fileName: 'sample-C-do-not-enter.md', category: '报告样例库/C', meta: { kind: 'sample', letter: 'C', size: 0 } },
  { fileName: 'sample-D-insufficient-data.md', category: '报告样例库/D', meta: { kind: 'sample', letter: 'D', size: 0 } },
  { fileName: 'sample-library-decision-gates.md', category: '报告样例库/决策门禁', meta: { kind: 'gates', size: 0 } },
  { fileName: 'sample-library-traceability-rule.md', category: '报告样例库/可追溯约束', meta: { kind: 'traceability', size: 0 } }
]

// ── 5. 工件目录解析（与 sampleLibrary.resolveArtifactDir 兼容）────────

/**
 * 解析 artifacts/online-advisor-parity 目录绝对路径（与 src/shared/sampleLibrary.ts 保持一致）
 * dev: process.cwd()/artifacts/online-advisor-parity
 * build: __dirname/../../artifacts/online-advisor-parity 或 process.resourcesPath
 */
export function resolveSampleLibraryArtifactDir(): string {
  const candidates: string[] = []
  candidates.push(resolve(process.cwd(), 'artifacts', 'online-advisor-parity'))
  const here = typeof __dirname === 'string' ? __dirname : process.cwd()
  candidates.push(resolve(here, '..', '..', 'artifacts', 'online-advisor-parity'))
  candidates.push(resolve(here, '..', '..', '..', 'artifacts', 'online-advisor-parity'))
  candidates.push(resolve(here, '..', '..', '..', '..', 'artifacts', 'online-advisor-parity'))
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    candidates.push(resolve(resourcesPath, 'artifacts', 'online-advisor-parity'))
  }
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

// ── 6. 公共 API ─────────────────────────────────────────────────

/**
 * 构造完整的入库计划：6 文档 + 绝对路径 + 运行时大小检测。
 * 文件不存在时 size = 0，verify 工具会单独检查。
 */
export function buildSampleLibraryKbIngestPlan(): SampleLibraryKbDoc[] {
  const dir = resolveSampleLibraryArtifactDir()
  return SAMPLE_LIBRARY_KB_DOCS.map(def => {
    const filePath = join(dir, def.fileName)
    let size = 0
    try {
      if (existsSync(filePath)) size = statSync(filePath).size
    } catch {
      size = 0
    }
    return {
      name: def.fileName,
      filePath,
      category: def.category,
      meta: { ...def.meta, size }
    }
  })
}

/** 入库计划摘要（用于 UI 展示） */
export interface SampleLibraryKbPlanSummary {
  agentKey: KbAgentKey
  kbName: string
  description: string
  categoryRoot: string
  totalDocs: number
  totalBytes: number
  byCategory: Record<string, number>
}

export function summarizeSampleLibraryKbIngestPlan(plan: SampleLibraryKbDoc[] = buildSampleLibraryKbIngestPlan()): SampleLibraryKbPlanSummary {
  const byCategory: Record<string, number> = {}
  let totalBytes = 0
  for (const doc of plan) {
    byCategory[doc.category] = (byCategory[doc.category] ?? 0) + 1
    totalBytes += doc.meta.size
  }
  return {
    agentKey: SAMPLE_LIBRARY_KB_TARGET.agentKey,
    kbName: SAMPLE_LIBRARY_KB_TARGET.kbName,
    description: SAMPLE_LIBRARY_KB_TARGET.description,
    categoryRoot: SAMPLE_LIBRARY_KB_TARGET.categoryRoot,
    totalDocs: plan.length,
    totalBytes,
    byCategory
  }
}

/** 入库结果（Ingestor 返回值类型） */
export interface SampleLibraryKbIngestResult {
  /** 知识库 ID（MaxKB dataset_id） */
  kbId: string
  /** 入库计划 */
  plan: SampleLibraryKbDoc[]
  /** 本次新上传的文档 ID（按文件名检测去重） */
  uploaded: SampleLibraryKbDoc[]
  /** 本次已跳过的文档（同名已存在） */
  skipped: SampleLibraryKbDoc[]
  /** 本次新触发解析的文档 ID */
  parsed: string[]
  /** 错误列表 */
  errors: Array<{ file: string; error: string }>
  /** 耗时（毫秒） */
  durationMs: number
}

/** 元数据快照（verify 工具用） */
export function getSampleLibraryKbSyncSnapshot(): {
  target: typeof SAMPLE_LIBRARY_KB_TARGET
  plan: SampleLibraryKbDoc[]
  summary: SampleLibraryKbPlanSummary
  docCountByKind: Record<'sample' | 'gates' | 'traceability', number>
} {
  const plan = buildSampleLibraryKbIngestPlan()
  const summary = summarizeSampleLibraryKbIngestPlan(plan)
  const docCountByKind: Record<'sample' | 'gates' | 'traceability', number> = { sample: 0, gates: 0, traceability: 0 }
  for (const doc of plan) docCountByKind[doc.meta.kind] += 1
  return { target: SAMPLE_LIBRARY_KB_TARGET, plan, summary, docCountByKind }
}

// ── 7. KB 引用提示词（I.4 阶段新增：主进程 chat 入口注入）────────────────
//
// 设计要点：
//   - 加在 user content 末尾而非 messages 头部，避免影响 MaxKB 智能体内部检索策略
//   - 不依赖 system role：聊天接口仅保留 user/assistant，system 会被吞
//   - 提示 MaxKB 智能体主动检索「选品分析师」KB 中已入库的 4 样例 + 决策门禁 + 可追溯约束
//   - 期望行为：智能体命中样例后在报告中明示「参考样例 X：xxx」以便用户追溯
export const SAMPLE_LIBRARY_KB_REFERENCE_PROMPT = [
  '[系统提示] 本次会话已启用「报告样例库」参考。请在生成报告时优先参考 MaxKB 知识库「选品分析师」中已入库的 4 份历史报告样例与决策门禁、可追溯约束：',
  '- 报告样例库/A、B、C、D（4 份历史报告样例）',
  '- 报告样例库/决策门禁（入场决策的判定标准）',
  '- 报告样例库/可追溯约束（数据来源与可追溯性硬约束）',
  '报告结构应严格遵循知识库中 6 段结构；判定结论必须基于知识库中明确的门禁标准；数据来源必须可追溯。',
  '如有命中样例，请在报告中明示「参考样例 X：xxx」以便用户追溯。'
].join('\n')
