/**
 * 报告样例库 → AI 智能体 Prompt 集成（H 阶段新增）。
 *
 * 数据源：artifacts/online-advisor-parity/sample-{A,B,C,D}-*.md（4 个真实样例）
 * 注入点：buildSelectionReportCollaborationPrompt（src/shared/selectionReportWorkflow.ts）
 *
 * 目的：让"选品分析师"AI 智能体生成报告时，自动对齐 v1.3 模板的
 *   1. 4 决策枚举（✅ / ⚠️ / ❌ / ❓）
 *   2. 6 部分结构（第一部分...第六部分）
 *   3. 决策可追溯硬约束（系统入场结论 = 报告最终结论）
 *   4. 决策门禁（10 道门禁的顺序）
 *
 * 设计原则：
 *   - 多示例优于少示例（few-shot 是 LLM 提示工程核心）
 *   - 4 样例必须用真实数据（与 sample-library 元数据决策一致）
 *   - 双源更新（deacb2a1 记忆）：模板文档 + 提示词文档必须同步
 *   - 渲染器兜底：模型偷懒时由 reportEnhance.ensureSampleLibraryAlignment 补全
 */

import { SAMPLE_DECISION_TOKENS, loadSampleLibrary, type SampleMeta } from './sampleLibrary'

// ── 1. 决策枚举（与 sample-library / docs 模板强一致）───────────────

export const SAMPLE_DECISION_KEYWORDS = [
  '✅ 建议入场',
  '⚠️ 有条件谨慎入场',
  '❌ 不建议入场',
  '❓ 数据不足，不能判定'
] as const

export type SampleDecisionKeyword = typeof SAMPLE_DECISION_KEYWORDS[number]

/** 决策枚举 → 失败门禁（与 sample-library 元数据同步） */
export const SAMPLE_DECISION_FAILED_GATES: Record<SampleDecisionKeyword, string[]> = {
  '✅ 建议入场': [],
  '⚠️ 有条件谨慎入场': ['差异化或合规证据偏短，需补强后复评'],
  '❌ 不建议入场': ['定价无法覆盖全成本 / 悲观情景亏损 / 差异化不可验证 / 合规 IP 存在未解决硬风险'],
  '❓ 数据不足，不能判定': ['23 evidence 至少一项未核验']
}

// ── 2. 决策矩阵（用于 prompt 顶部锚定）─────────────────────────────

export function buildSampleLibraryDecisionMatrix(): string {
  const lib = loadSampleLibrary()
  const lines: string[] = [
    '## 报告样例库决策矩阵（H 阶段新增，4 真实样例）',
    '',
    '> 本提示词配套样例库已落地 artifacts/online-advisor-parity/，共 4 个真实样例覆盖 4 种决策。',
    '> 你的输出必须与样例库决策矩阵中的 4 枚举完全一致；偏离任何枚举都会触发报告样例库决策可追溯失败。',
    '',
    '| 样例 | 决策 | 关键参数 | 失败门禁 |',
    '|---|---|---|---|'
  ]
  for (const meta of lib) {
    const km = meta.keyMetrics
    const marginCell = km.baseMargin === null ? '数据不足' : `${km.baseMargin.toFixed(1)}%`
    const profitCell = km.downsideProfit === null ? '数据不足' : `$${km.downsideProfit.toFixed(2)}`
    const gatesCell = meta.failedGates.length === 0 ? '（无）' : meta.failedGates.join('、')
    lines.push(`| 样例 ${meta.letter} | ${meta.decision} | 毛利 ${marginCell} / 悲观 ${profitCell} / DIRECT ${km.directCount ?? '?'} | ${gatesCell} |`)
  }
  return lines.join('\n')
}

// ── 3. 4 样例精简 few-shot（每个 ≤ 1KB，固定决策路径）──────────────

export interface FewShotExample {
  letter: 'A' | 'B' | 'C' | 'D'
  decision: SampleDecisionKeyword
  /** 触发场景（一句话） */
  scenario: string
  /** 关键数字（baseMargin / downsideProfit / directCount） */
  metrics: { baseMargin: number | null; downsideProfit: number | null; directCount: number | null }
  /** 6 部分 + 决策可追溯 的压缩版（约 800-1000 字符） */
  skeleton: string
}

const SCENARIOS: Record<SampleDecisionKeyword, string> = {
  '✅ 建议入场': '全 DIRECT 命中 + 利润达标 + 合规证据完整 + 差异化可验证',
  '⚠️ 有条件谨慎入场': '利润达标但合规/IP 证据偏短，需补强后复评',
  '❌ 不建议入场': '成本结构过重 / 悲观情景亏损 / 合规 IP 存在未解决硬风险',
  '❓ 数据不足，不能判定': '23 evidence 至少一项未核验 / DIRECT 不够 / 缺关键经营输入'
}

function buildSkeletonA(): string {
  return `# 选品分析报告样本 A（✅ 建议入场）

## 第一部分：本品基础信息解析
> 商品名：宠物免洗清洁喷雾 200ml｜1688 ID：xxx｜目标平台：Amazon 美国站

## 第二部分：目标平台细分市场调研
> 检索词 3/3 成功｜DIRECT 15｜ADJACENT 2｜NON_COMPARABLE 1｜覆盖率 100%

## 第三部分：本品与核心竞品多维对比
> 核心竞品 5 款：均为猫狗免洗喷雾 200ml｜价格 25-30 USD｜评分 4.3-4.7

## 第四部分：价格、成本与单位经济
> 快速毛利：57.2%｜全成本基准毛利：39.3%｜悲观情景利润：$8.57

## 第五部分：合规、知识产权与差异化核验
> 差异化：植物精华 + 双香型 + 200ml 大瓶装，竞品多为单香型小瓶装。
> 合规：成分均为常见日化原料，无 EPA/FDA 风险；包装含英文成分表与净含量。

## 第六部分：入场结论与30天验证计划
- 决策可追溯：系统入场结论 = ✅ 建议入场，报告最终结论 = ✅ 建议入场，二者必须完全一致。
- 30 天验证：投放 50 单测试、退货率 < 5%、评分 > 4.3 进入扩量

---
附录：阶段 4 systemFact 块（拼装路径直供智能体）
> systemFact.decision = "✅ 建议入场"｜systemFact.baseMargin = 39.3｜systemFact.downsideProfit = 8.57
`
}

function buildSkeletonB(): string {
  return `# 选品分析报告样本 B（⚠️ 有条件谨慎入场）

## 第一部分：本品基础信息解析
> 商品名：宠物免洗清洁喷雾 200ml｜目标平台：Amazon 美国站

## 第二部分：目标平台细分市场调研
> DIRECT 15｜ADJACENT 2｜NON_COMPARABLE 1｜覆盖率 100%

## 第三部分：本品与核心竞品多维对比
> 核心竞品 5 款：与样本 A 一致（差异化定位清晰）

## 第四部分：价格、成本与单位经济
> 快速毛利：57.2%｜全成本基准毛利：35.2%｜悲观情景利润：$7.91

## 第五部分：合规、知识产权与差异化核验
> 差异化：植物精华 + 双香型 + 200ml 大瓶装，竞品多为单香型小瓶装。
> 合规：待补（仅 2 字符说明，不满足 ≥ 8 字符硬要求）

## 第六部分：入场结论与30天验证计划
- 决策可追溯：系统入场结论 = ⚠️ 有条件谨慎入场，报告最终结论 = ⚠️ 有条件谨慎入场，二者必须完全一致。
- 30 天验证：先补强合规证据（≥ 8 字符），复评后再入场

---
附录：阶段 4 systemFact 块
> systemFact.decision = "⚠️ 有条件谨慎入场"｜failedGates = ["complianceIpEvidence ≥ 8 字符"]
`
}

function buildSkeletonC(): string {
  return `# 选品分析报告样本 C（❌ 不建议入场）

## 第一部分：本品基础信息解析
> 商品名：宠物免洗清洁喷雾 200ml｜目标平台：Amazon 美国站

## 第二部分：目标平台细分市场调研
> DIRECT 15｜ADJACENT 2｜NON_COMPARABLE 1｜覆盖率 100%

## 第三部分：本品与核心竞品多维对比
> 核心竞品 5 款：参考样本 A

## 第四部分：价格、成本与单位经济
> 快速毛利：-2.3%｜全成本基准毛利：-17.6%｜悲观情景利润：-$8.00

## 第五部分：合规、知识产权与差异化核验
> 差异化：与样本 A 一致
> 合规：与样本 A 一致

## 第六部分：入场结论与30天验证计划
- 决策可追溯：系统入场结论 = ❌ 不建议入场，报告最终结论 = ❌ 不建议入场，二者必须完全一致。
- 不入场原因：定价 12 USD 无法覆盖全成本（采购 1.5 + FBA 3.43 + 包装 0.3 + ...），悲观情景亏损 $8.00/件

---
附录：阶段 4 systemFact 块
> systemFact.decision = "❌ 不建议入场"｜failedGates = ["numbers.base.margin ≥ target", "numbers.downside.profit ≥ 0"]
`
}

function buildSkeletonD(): string {
  return `# 选品分析报告样本 D（❓ 数据不足，不能判定）

## 第一部分：本品基础信息解析
> 商品名：宠物免洗清洁喷雾 200ml｜目标平台：Amazon 美国站

## 第二部分：目标平台细分市场调研
> DIRECT 15｜ADJACENT 2｜NON_COMPARABLE 1｜覆盖率 100%（数据完整但 evidence 全部未核验）

## 第三部分：本品与核心竞品多维对比
> 核心竞品 5 款：参考样本 A

## 第四部分：价格、成本与单位经济
> 快速毛利：待核验｜全成本基准毛利：待核验｜悲观情景利润：待核验
> 23 evidence 全部 decisionEligible=false，无法进入决策门禁

## 第五部分：合规、知识产权与差异化核验
> 差异化：待核验
> 合规：待核验

## 第六部分：入场结论与30天验证计划
- 决策可追溯：系统入场结论 = ❓ 数据不足，不能判定，报告最终结论 = ❓ 数据不足，不能判定，二者必须完全一致。
- 不入场原因：23 evidence 全部未核验（采购价、佣金率、FBA、退货、广告、包装、国内物流、头程、关税、清关、入仓、仓储、目标贡献利润率、差异化、合规/IP）

---
附录：阶段 4 systemFact 块
> systemFact.decision = "❓ 数据不足，不能判定"｜failedGates = ["23 evidence 全部 decisionEligible=true"]
`
}

const SKELETON_BUILDERS: Record<SampleDecisionKeyword, () => string> = {
  '✅ 建议入场': buildSkeletonA,
  '⚠️ 有条件谨慎入场': buildSkeletonB,
  '❌ 不建议入场': buildSkeletonC,
  '❓ 数据不足，不能判定': buildSkeletonD
}

export function buildSampleLibraryFewShot(): FewShotExample[] {
  const lib = loadSampleLibrary()
  return lib.map(meta => {
    const decision = meta.decision as SampleDecisionKeyword
    return {
      letter: meta.letter,
      decision,
      scenario: SCENARIOS[decision],
      metrics: meta.keyMetrics,
      skeleton: SKELETON_BUILDERS[decision]()
    }
  })
}

export function buildSampleLibraryFewShotMarkdown(): string {
  const examples = buildSampleLibraryFewShot()
  const sections: string[] = [
    '## 报告样例库 few-shot 注入（H 阶段新增）',
    '',
    '> 以下 4 个真实样例覆盖 4 种决策路径，模型生成时必须参考对应决策的样本结构。',
    '> 每个样例 ≤ 1KB，固定 6 部分 + 决策可追溯 + 附录 systemFact 块。',
    ''
  ]
  for (const ex of examples) {
    const token = SAMPLE_DECISION_TOKENS[ex.decision]
    sections.push(
      `### 样例 ${ex.letter} · ${ex.decision}（${token.fgColor} 触发）`,
      `> 触发场景：${ex.scenario}`,
      `> 关键参数：baseMargin=${ex.metrics.baseMargin ?? '数据不足'}%, downsideProfit=${ex.metrics.downsideProfit ?? '数据不足'} USD, directCount=${ex.metrics.directCount ?? '?'}`,
      '',
      ex.skeleton,
      ''
    )
  }
  return sections.join('\n')
}

// ── 4. 完整 prompt 注入段（拼接到 selectionReportWorkflow 的协同 prompt）──

export function buildSampleLibraryPromptSection(): string {
  return [
    '【报告样例库对齐段 · H 阶段新增】',
    '说明：以下 4 样例用于把"4 决策枚举 + 6 部分 + 决策可追溯"硬约束注入到模型输出。',
    '生效路径：',
    '  1. 模型必须使用以下 4 决策枚举之一作为最终结论：' + SAMPLE_DECISION_KEYWORDS.join('、'),
    '  2. 模型必须保留 6 部分结构（第一部分...第六部分）+ 附录 systemFact 块',
    '  3. 模型必须在第六部分首行明确写出"决策可追溯：系统入场结论 = X，报告最终结论 = X，二者必须完全一致"',
    '  4. 偏离任何上述约束都会触发报告样例库决策可追溯失败（见 docs/选品分析师-报告样例库.md）',
    '',
    buildSampleLibraryDecisionMatrix(),
    '',
    buildSampleLibraryFewShotMarkdown(),
    '',
    '【报告样例库对齐段结束】'
  ].join('\n')
}

// ── 5. 提示词文档规则 18（H 阶段新增，docs 同步）───────────────────

export const PROMPT_RULE_18 = {
  number: 18,
  title: '报告样例库对齐',
  body: '生成报告时必须参考 docs/选品分析师-报告样例库.md 的 4 真实样例结构。最终结论只能是 ✅ 建议入场 / ⚠️ 有条件谨慎入场 / ❌ 不建议入场 / ❓ 数据不足，不能判定 四种之一；第六部分首行必须包含"决策可追溯：系统入场结论 = X，报告最终结论 = X"链路声明。模型偏离 4 决策枚举或缺少决策可追溯链路时，渲染器（src/shared/reportEnhance.ts ensureSampleLibraryAlignment）会兜底补全。'
}

// ── 6. 元数据同步检查（verify 工具用）─────────────────────────────

export function getPromptRule18(): typeof PROMPT_RULE_18 {
  return PROMPT_RULE_18
}

export function getSampleLibrarySyncSnapshot(): {
  lib: SampleMeta[]
  decisionKeywords: readonly SampleDecisionKeyword[]
  failedGates: Record<SampleDecisionKeyword, string[]>
} {
  return {
    lib: loadSampleLibrary(),
    decisionKeywords: SAMPLE_DECISION_KEYWORDS,
    failedGates: SAMPLE_DECISION_FAILED_GATES
  }
}
