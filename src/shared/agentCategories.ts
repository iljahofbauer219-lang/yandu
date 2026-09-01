/**
 * AI 员工一二级分类（v2.0 重构版）
 *
 * 设计目标：
 * 1. 一级类目 = 业务职能（产品分析师 / 知识库守卫 / Listing 运营 / 视觉设计 / 财务 / 营销 / 参谋）
 * 2. 二级员工 = 具体可点选的工作台（选品调研员 / 竞品分析员 / ...）
 * 3. 与现有 position 字符串保持兼容：`name` 字段保留中文岗位名，便于 App.tsx 直接传入
 * 4. readiness 区分「上线 / 即将上线 / Beta」，UI 按状态渲染徽标和点击行为
 * 5. 每个二级员工有独立颜色与图标，便于在徽章 / chip / 卡片中复用
 *
 * 数据流：
 * - AIEmployeeHub 主页 -> 跨境智能体卡片（CrossborderAgentGrid）-> 点卡片跳到员工工作台
 * - 员工工作台（AIEmployee.tsx）的 position props 直接用 AgentProfile.name
 * - 旧版 AGENTS 数组（AIEmployee.tsx:62）保留作为局部兼容垫片，本文件为唯一来源
 */

export type AgentCategoryId =
  | 'product-analyst'    // 产品分析师
  | 'knowledge-guardian' // 知识库守卫
  | 'listing-ops'        // Listing 运营
  | 'visual-design'      // 视觉设计
  | 'finance'            // 财务
  | 'marketing'          // 营销
  | 'consulting'         // 参谋

export type AgentReadiness = 'live' | 'beta' | 'coming-soon'

/** 单个二级员工（与 AIEmployee.tsx 旧版 AGENTS 元素兼容） */
export interface AgentProfile {
  /** 唯一英文 id（用于稳定 key / URL 路由） */
  id: string
  /** 中文岗位名 = 现有 position 字符串，保持兼容 */
  name: string
  /** 徽章图标字符（1-2 个汉字） */
  shortName: string
  /** 完整图标 emoji 或字符（用于手风琴二级卡片） */
  icon: string
  /** 主色（HSL 友好，与现有色板一致） */
  color: string
  /** 归属一级类目 id */
  categoryId: AgentCategoryId
  /** 简短描述（用于卡片副标题） */
  description: string
  /** 状态 */
  readiness: AgentReadiness
  /** 默认模型 id（与 AiEmployeeChatService.listModels() 一致） */
  modelId: string
  /** 模型是否可用（与 .env 配置相关，由 listModels() 计算） */
  available: boolean
}

/** 一级类目 */
export interface AgentCategory {
  id: AgentCategoryId
  /** 类目名称 */
  name: string
  /** 类目图标（emoji） */
  icon: string
  /** 类目主色 */
  color: string
  /** 类目副标题 */
  description: string
  /** 默认展开（仅在 Hub 主页首次打开时生效） */
  defaultOpen: boolean
  /** 二级员工列表 */
  agents: AgentProfile[]
}

/** Hub 主页底部「场景入口」 */
export interface SceneEntry {
  id: string
  name: string
  description: string
  icon: string
  color: string
  /** 跳转到对应员工（AgentProfile.name） */
  targetAgent: string
  /** 可选预填任务描述 */
  prefillQuery?: string
}

/** Hub 主页底部「最佳实践案例」 */
export interface BestPractice {
  id: string
  title: string
  description: string
  icon: string
  /** 案例跳转目标（agent name） */
  targetAgent: string
  /** 可选预填任务 */
  prefillQuery?: string
}

/**
 * 一二级员工完整目录（7 一级 / 12 二级）
 *
 * readiness 分布：
 * - live（3 个）：选品调研员 / 知识库守卫 / Listing 精造师
 * - coming-soon（9 个）：其余
 */
export const AGENT_CATEGORIES: AgentCategory[] = [
  {
    id: 'product-analyst',
    name: '产品分析师',
    icon: '📊',
    color: '#0ea5e9',
    description: '选品调研 · 竞品分析 · 定价 · 类目',
    defaultOpen: true,
    agents: [
      {
        id: 'researcher',
        name: '选品调研员',
        shortName: '调',
        icon: '🔍',
        color: '#0ea5e9',
        categoryId: 'product-analyst',
        description: '1688 商品机会评估 · Amazon-Skills 选品分析',
        readiness: 'live',
        modelId: 'amazon-skills-agent',
        available: true
      },
      {
        id: 'competitor',
        name: '竞品分析员',
        shortName: '竞',
        icon: '🎯',
        color: '#10b981',
        categoryId: 'product-analyst',
        description: '竞品对比 · 差异化卖点挖掘',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      },
      {
        id: 'pricing',
        name: '产品定价员',
        shortName: '定',
        icon: '💰',
        color: '#f59e0b',
        categoryId: 'product-analyst',
        description: '成本核算 · 定价策略',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      },
      {
        id: 'category',
        name: '类目优选员',
        shortName: '类',
        icon: '🗂',
        color: '#8b5cf6',
        categoryId: 'product-analyst',
        description: '类目机会 · 蓝海发现',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      }
    ]
  },
  {
    id: 'knowledge-guardian',
    name: '知识库守卫',
    icon: '🛡',
    color: '#14b8a6',
    description: '知识库自动收集 · 增量更新',
    defaultOpen: false,
    agents: [
      {
        id: 'guardian',
        name: '知识库守卫',
        shortName: '卫',
        icon: '🛡',
        color: '#14b8a6',
        categoryId: 'knowledge-guardian',
        description: '知识库自动收集 · 增量更新守卫',
        readiness: 'live',
        modelId: 'qwen3.6-flash',
        available: true
      }
    ]
  },
  {
    id: 'listing-ops',
    name: 'Listing 运营',
    icon: '📝',
    color: '#f59e0b',
    description: '多平台 Listing 文案 · 多语翻译',
    defaultOpen: false,
    agents: [
      {
        id: 'listing',
        name: 'Listing精造师',
        shortName: '精',
        icon: '✨',
        color: '#f59e0b',
        categoryId: 'listing-ops',
        description: '多平台 Listing 文案 · 母语级多语翻译',
        readiness: 'live',
        modelId: 'listing-agent',
        available: true
      }
    ]
  },
  {
    id: 'visual-design',
    name: '视觉设计',
    icon: '🎨',
    color: '#8b5cf6',
    description: '图片 / 视频生成与优化',
    defaultOpen: false,
    agents: [
      {
        id: 'image-designer',
        name: '图片设计师',
        shortName: '图',
        icon: '🖼',
        color: '#8b5cf6',
        categoryId: 'visual-design',
        description: '主图 / 场景图 / Listing 配图生成',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      },
      {
        id: 'video-creator',
        name: '视频创作者',
        shortName: '视',
        icon: '🎬',
        color: '#ef4444',
        categoryId: 'visual-design',
        description: '短视频脚本与生成',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      }
    ]
  },
  {
    id: 'finance',
    name: '财务',
    icon: '💼',
    color: '#0ea5e9',
    description: '跨境会计 · 物流精算',
    defaultOpen: false,
    agents: [
      {
        id: 'accountant',
        name: '跨境会计师',
        shortName: '会',
        icon: '📒',
        color: '#0ea5e9',
        categoryId: 'finance',
        description: '多平台多币种核算 · 报表',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      },
      {
        id: 'logistics',
        name: '物流精算师',
        shortName: '流',
        icon: '🚚',
        color: '#10b981',
        categoryId: 'finance',
        description: 'FBA 费用 · 头程 · 关税精算',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      }
    ]
  },
  {
    id: 'marketing',
    name: '营销',
    icon: '📣',
    color: '#a855f7',
    description: '品牌客服 · 私域 · 投流',
    defaultOpen: false,
    agents: [
      {
        id: 'cs',
        name: '品牌客服官',
        shortName: '客',
        icon: '🎧',
        color: '#a855f7',
        categoryId: 'marketing',
        description: '多语言客服话术 · 售后策略',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      }
    ]
  },
  {
    id: 'consulting',
    name: '参谋',
    icon: '🧭',
    color: '#ff2442',
    description: '在线参谋长 · 全局决策辅助',
    defaultOpen: false,
    agents: [
      {
        id: 'chief',
        name: '在线参谋长',
        shortName: '参',
        icon: '🧭',
        color: '#ff2442',
        categoryId: 'consulting',
        description: '跨境运营全局问题诊断',
        readiness: 'coming-soon',
        modelId: '',
        available: false
      }
    ]
  }
]

/** Hub 主页场景入口 */
export const SCENE_ENTRIES: SceneEntry[] = [
  {
    id: 'scene-selection',
    name: '选品分析',
    description: '一键生成选品报告',
    icon: '🔍',
    color: '#0ea5e9',
    targetAgent: '选品调研员'
  },
  {
    id: 'scene-market',
    name: '市场分析',
    description: '类目与竞品全景',
    icon: '📊',
    color: '#10b981',
    targetAgent: '选品调研员'
  },
  {
    id: 'scene-listing',
    name: 'Listing 生成',
    description: '六段长文 · 多语',
    icon: '✨',
    color: '#f59e0b',
    targetAgent: 'Listing精造师'
  },
  {
    id: 'scene-image',
    name: '图片生成',
    description: '主图与场景图',
    icon: '🖼',
    color: '#8b5cf6',
    targetAgent: '图片设计师'
  },
  {
    id: 'scene-pricing',
    name: '成本核算',
    description: '采购 · FBA · 利润',
    icon: '💰',
    color: '#f59e0b',
    targetAgent: '产品定价员'
  },
  {
    id: 'scene-fba',
    name: 'FBA 计划',
    description: '库存与补货',
    icon: '📦',
    color: '#10b981',
    targetAgent: '物流精算师'
  }
]

/** Hub 主页最佳实践案例（占位，后续可由 MaxKB 推） */
export const BEST_PRACTICES: BestPractice[] = [
  {
    id: 'bp-pet-grooming',
    title: '宠物美容刷选品分析',
    description: '基于 Amazon 真实数据生成的选品报告样例',
    icon: '🐾',
    targetAgent: '选品调研员'
  },
  {
    id: 'bp-amazon-listing',
    title: 'Listing 六段长文样例',
    description: 'Amazon 美国站 Listing 多语版本',
    icon: '📝',
    targetAgent: 'Listing精造师'
  },
  {
    id: 'bp-knowledge',
    title: '知识库增量更新',
    description: '守卫 24h 自动收集',
    icon: '🛡',
    targetAgent: '知识库守卫'
  },
  {
    id: 'bp-competitor',
    title: '竞品差异化分析',
    description: '5 个头部 ASIN 对比',
    icon: '🎯',
    targetAgent: '竞品分析员'
  }
]

/** Hub 主页「跨境智能体」部门分组（卡片按 name 引用现有 AgentProfile，不重复定义） */
export interface CrossborderDepartment {
  id: string
  /** 部门标题（含序号） */
  name: string
  /** 部门色条颜色 */
  color: string
  /** 部门成员（AgentProfile.name） */
  agents: string[]
}

export const CROSSBORDER_DEPARTMENTS: CrossborderDepartment[] = [
  {
    id: 'cb-ops',
    name: '一、跨境营运部',
    color: '#0abab5',
    agents: ['选品调研员', '竞品分析员', '产品定价员', '类目优选员']
  },
  {
    id: 'cb-product-optimization',
    name: '二、产品优化部',
    color: '#f59e0b',
    agents: ['Listing精造师']
  }
]

/**
 * 工具函数：按 name 查找 AgentProfile（兼容 AIEmployee.tsx position props）
 */
export function findAgentByName(name: string): AgentProfile | undefined {
  for (const category of AGENT_CATEGORIES) {
    const agent = category.agents.find(a => a.name === name)
    if (agent) return agent
  }
  return undefined
}

/** 工具函数：按 id 查找 */
export function findAgentById(id: string): AgentProfile | undefined {
  for (const category of AGENT_CATEGORIES) {
    const agent = category.agents.find(a => a.id === id)
    if (agent) return agent
  }
  return undefined
}

/** 工具函数：找出 agent 归属的一级类目 */
export function findCategoryOfAgent(agentName: string): AgentCategory | undefined {
  return AGENT_CATEGORIES.find(c => c.agents.some(a => a.name === agentName))
}

/** readiness 中文标签 */
export function readinessLabel(readiness: AgentReadiness): string {
  switch (readiness) {
    case 'live': return '进入'
    case 'beta': return 'Beta'
    case 'coming-soon': return '即将上线'
  }
}

/** readiness 颜色 class */
export function readinessClass(readiness: AgentReadiness): string {
  return `agent-readiness-${readiness}`
}
