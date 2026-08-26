/**
 * AI 员工技能系统 v1.0
 *
 * 概念：
 * - 全局技能（global）：所有 AI 员工共享的设置（如：报告样例库 KB 引用 / 输出语言）
 * - 员工级技能（perAgent）：仅作用于单个员工（如：选品调研员启用快速利润 / Listing精造师启用六段长文）
 * - 覆盖关系：员工级 > 全局（员工级有值时优先用员工级；无值时回退全局）
 *
 * 持久化：
 * - 全局：localStorage 'aiEmployee.skills.global'
 * - 员工级：localStorage 'aiEmployee.skills.<position>'
 * - 模型已切换：localStorage 'yd.aiEmployee.chatModel'（已存在）
 *
 * 阶段说明：
 * - P1-A：定义数据结构 + SkillSelector 弹窗 + 工作台内嵌配置
 * - 后续阶段：把 useSampleLibrary 等已有开关迁移到本系统统一管理
 */

/** 技能值类型 */
export type SkillValue = boolean | number | string

/** 技能定义（可被全局 / 员工级引用） */
export interface SkillDefinition {
  /** 稳定 id */
  id: string
  /** 中文名 */
  name: string
  /** 简短描述 */
  description: string
  /** 技能分组（一级类目） */
  group: 'kb-reference' | 'output-style' | 'analyst-tools' | 'listing-tools' | 'guardian-tools'
  /** 值类型 */
  valueType: 'boolean' | 'select' | 'number'
  /** 默认值 */
  defaultValue: SkillValue
  /** select 类型的选项（仅 valueType='select' 时使用） */
  options?: Array<{ value: string; label: string }>
  /** 适用于哪些员工（空数组 = 全部） */
  applicableAgents?: string[]
  /** 状态徽标 */
  status?: 'live' | 'beta'
}

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  // ── KB 引用类 ────────────────────────────────
  {
    id: 'sample-library-kb',
    name: '报告样例库 KB 引用',
    description: '选品/Listing 报告生成时引用 4 份样例与决策门禁，仅 30 天兼容回退 RAGFlow 链路生效',
    group: 'kb-reference',
    valueType: 'boolean',
    defaultValue: true,
    applicableAgents: ['选品调研员', 'Listing精造师'],
    status: 'live'
  },

  // ── 输出风格类 ───────────────────────────────
  {
    id: 'output-language',
    name: '输出语言',
    description: '主报告与对话默认语言',
    group: 'output-style',
    valueType: 'select',
    defaultValue: 'zh-CN',
    options: [
      { value: 'zh-CN', label: '简体中文' },
      { value: 'zh-TW', label: '繁體中文' },
      { value: 'en-US', label: 'English' },
      { value: 'ja-JP', label: '日本語' },
      { value: 'de-DE', label: 'Deutsch' }
    ],
    status: 'live'
  },
  {
    id: 'output-length',
    name: '输出长度',
    description: '长报告 vs 简明结论',
    group: 'output-style',
    valueType: 'select',
    defaultValue: 'standard',
    options: [
      { value: 'concise', label: '简明（≤ 500 字）' },
      { value: 'standard', label: '标准（500-1500 字）' },
      { value: 'detailed', label: '详尽（≥ 1500 字）' }
    ],
    status: 'live'
  },

  // ── 选品分析师工具类 ──────────────────────────
  {
    id: 'analyst-quick-profit',
    name: '快速利润试算',
    description: '在选品报告前自动生成 FBA 成本 + 利润区间',
    group: 'analyst-tools',
    valueType: 'boolean',
    defaultValue: true,
    applicableAgents: ['选品调研员'],
    status: 'live'
  },
  {
    id: 'analyst-competitor',
    name: '竞品对标',
    description: '自动拉取同款竞品 ASIN 并加入报告',
    group: 'analyst-tools',
    valueType: 'boolean',
    defaultValue: false,
    applicableAgents: ['选品调研员'],
    status: 'beta'
  },

  // ── Listing 工具类 ────────────────────────────
  {
    id: 'listing-six-block',
    name: '六段长文',
    description: 'Listing 按 Hook/Benefit/Feature/Spec/FAQ/CTA 六段渲染',
    group: 'listing-tools',
    valueType: 'boolean',
    defaultValue: true,
    applicableAgents: ['Listing精造师'],
    status: 'live'
  },
  {
    id: 'listing-multi-lang',
    name: '多语翻译',
    description: '同步输出德语/日语/法语/西语版本',
    group: 'listing-tools',
    valueType: 'boolean',
    defaultValue: true,
    applicableAgents: ['Listing精造师'],
    status: 'beta'
  },

  // ── 知识库守卫工具类 ──────────────────────────
  {
    id: 'guardian-auto-collect',
    name: '24h 自动收集',
    description: '新文档出现时自动按 sha256 差异更新目标知识库',
    group: 'guardian-tools',
    valueType: 'boolean',
    defaultValue: true,
    applicableAgents: ['知识库守卫'],
    status: 'live'
  }
]

/** 员工级技能覆盖：{ [agentName]: { [skillId]: value } } */
export type AgentSkillOverride = Record<string, Record<string, SkillValue>>

/** 全部技能配置：{ [skillId]: value }（global） */
export type GlobalSkillConfig = Record<string, SkillValue>

// ─── 存储读写 ─────────────────────────────────────
const GLOBAL_KEY = 'aiEmployee.skills.global'

export function loadGlobalSkills(): GlobalSkillConfig {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as GlobalSkillConfig) : {}
  } catch {
    return {}
  }
}

export function saveGlobalSkills(config: GlobalSkillConfig): void {
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(config))
  } catch { /* ignore quota */ }
}

export function loadAgentSkills(agentName: string): Record<string, SkillValue> {
  try {
    const raw = localStorage.getItem(`aiEmployee.skills.${agentName}`)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SkillValue>) : {}
  } catch {
    return {}
  }
}

export function saveAgentSkills(agentName: string, config: Record<string, SkillValue>): void {
  try {
    localStorage.setItem(`aiEmployee.skills.${agentName}`, JSON.stringify(config))
  } catch { /* ignore quota */ }
}

// ─── 解析逻辑（员工级 > 全局 > 默认） ────────────
export function resolveSkillValue(
  skillId: string,
  agentName: string,
  global: GlobalSkillConfig,
  agentOverride: Record<string, SkillValue>
): SkillValue {
  if (agentOverride[skillId] !== undefined) return agentOverride[skillId]
  if (global[skillId] !== undefined) return global[skillId]
  return SKILL_DEFINITIONS.find(s => s.id === skillId)?.defaultValue ?? false
}

/** 列出适用于某员工的技能（applicableAgents 为空 = 全部适用） */
export function getApplicableSkills(agentName: string): SkillDefinition[] {
  return SKILL_DEFINITIONS.filter(s => !s.applicableAgents || s.applicableAgents.length === 0 || s.applicableAgents.includes(agentName))
}

/** 按 group 归组 */
export function groupSkillsByGroup(skills: SkillDefinition[]): Record<string, SkillDefinition[]> {
  const groups: Record<string, SkillDefinition[]> = {}
  for (const s of skills) {
    if (!groups[s.group]) groups[s.group] = []
    groups[s.group].push(s)
  }
  return groups
}

/** group 中文标签 */
export const SKILL_GROUP_LABELS: Record<string, string> = {
  'kb-reference': '📚 知识库引用',
  'output-style': '🎨 输出风格',
  'analyst-tools': '📊 选品分析工具',
  'listing-tools': '✨ Listing 工具',
  'guardian-tools': '🛡 守卫工具'
}
