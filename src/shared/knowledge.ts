// 知识库两大类（智能体知识库 / 自定义知识库）共享类型：主进程服务与渲染层共用

export type KbCategory = 'agent' | 'custom'
export type KbAgentKey = 'sourcing' | 'listing' | 'compliance' | 'ops'

export interface KbView {
  id: string
  name: string
  description: string
  documentCount: number
  chunkCount: number
  updateDate: string
  category: KbCategory
  agentKey?: KbAgentKey
  agentName?: string
}

export interface AgentKbSlot {
  key: KbAgentKey
  name: string
  role: string
  color: string
  icon: string
  kb: KbView | null
}

export interface KbListView {
  agents: AgentKbSlot[]
  customs: KbView[]
}

export interface KbDocView {
  id: string
  name: string
  size: number
  chunkCount: number
  run: string
  progress: number
  createDate: string
  updateDate: string
  /** 所属分类名（RAGFlow meta_fields.category，存叶子名；同库内分类名全局唯一），空串 = 未分类 */
  category?: string
}

/** 分类树节点：name 同库内全局唯一；parent 缺省 = 顶层 */
export interface KbCategoryNode {
  name: string
  parent?: string
}

export interface KbDocsView {
  docs: KbDocView[]
  /** 分类目录树：本地树 ∪ 文档 meta 中出现的分类（孤儿分类补为顶层），保序 */
  categories: KbCategoryNode[]
}
