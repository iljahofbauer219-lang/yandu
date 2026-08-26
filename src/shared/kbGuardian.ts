// 知识库守卫：技能注册表 / 运行日志共享契约（主进程与渲染层共用）
export type GuardianFrequency = 'manual' | 'daily' | 'weekly'
export type GuardianRunStatus = 'ok' | 'partial' | 'failed'
export type GuardianRunTrigger = 'manual' | 'schedule' | 'catchup'
// I.5 阶段新增：同步模式
// - soft：保留旧 docId，调 MaxKB 文档 PUT 替换文件 + 重解析（旧 chunk 在重解析期间仍可被检索）
// - hard：先删旧 docId + 再上传新文件 + 重解析（I.2 阶段默认行为；保留作回退路径）
export type GuardianSyncMode = 'soft' | 'hard'

export interface GuardianSkillStats {
  added: number
  updated: number
  skipped: number
  failed: number
  // I.6 阶段新增：本次清理的孤儿文档数（源文件被删/重命名后 KB 中残留的旧 docId）
  orphansRemoved: number
  // I.7 阶段新增：软同步失败时自动回退到硬同步的次数（docId 失效/PUT 200 但未持久化时的自动恢复）
  fallbackToHard: number
}

export interface GuardianSkill {
  id: string
  name: string
  sourceType: 'local-dir'
  sourcePath: string
  // 扩展名过滤：带点小写，如 ['.md', '.txt']
  fileExts: string[]
  targetKbId: string
  targetKbName: string
  frequency: GuardianFrequency
  enabled: boolean
  // I.2 阶段新增：上传兜底分类（meta_fields.category 落这个值；留空则不指定）
  category?: string
  // I.2 阶段新增：启动时幂等补齐的分类（树形；父不存在时按顺序创建）
  ensureCategories?: GuardianCategorySpec[]
  // I.5 阶段新增：同步模式（缺省 soft：保留旧 docId + MaxKB 文档 PUT；hard：先删旧再传新，I.2 默认行为）
  syncMode?: GuardianSyncMode
  // I.6 阶段新增：孤儿清理开关（缺省 true：源文件被删/重命名后 KB 中残留的旧 docId 会被自动清理；运行时可用 options.orphanCleanup 临时覆盖）
  orphanCleanup?: boolean
  // I.7 阶段新增：软同步失败时是否自动回退到硬同步（缺省 true：docId 失效/PUT 异常时自动 deleteDocs + uploadAndParse 恢复）
  softFallbackHard?: boolean
  lastRunAt?: number
  lastStats?: GuardianSkillStats
  // 主进程注入的运行时状态（不持久化）
  running?: boolean
}

// 多级分类声明：name 必填；parent 可选指明父分类
export interface GuardianCategorySpec {
  name: string
  parent?: string
}

// 创建 / 编辑入参（不含 id / lastRunAt / lastStats / running）
export interface GuardianSkillInput {
  name: string
  sourcePath: string
  fileExts: string[]
  targetKbId: string
  targetKbName: string
  frequency: GuardianFrequency
  enabled: boolean
  // I.2 阶段新增（可选）
  category?: string
  ensureCategories?: GuardianCategorySpec[]
  // I.5 阶段新增（可选）：创建 / 编辑技能时显式指定同步模式
  syncMode?: GuardianSyncMode
  // I.6 阶段新增（可选）：创建 / 编辑技能时显式指定是否清理孤儿文档（缺省 true）
  orphanCleanup?: boolean
  // I.7 阶段新增（可选）：创建 / 编辑技能时显式指定软同步失败时是否自动回退到硬同步（缺省 true）
  softFallbackHard?: boolean
}

export interface GuardianRunFailure {
  name: string
  reason: string
}

export interface GuardianRunLog {
  id: string
  skillId: string
  skillName: string
  startedAt: number
  finishedAt: number
  status: GuardianRunStatus
  trigger: GuardianRunTrigger
  added: number
  updated: number
  skipped: number
  // I.6 阶段新增：本次清理的孤儿文档数（0 表示无孤儿）
  orphansRemoved: number
  // I.7 阶段新增：本次软同步失败自动回退到硬同步的次数（0 表示未触发回退）
  fallbackToHard: number
  failures: GuardianRunFailure[]
}

export interface GuardianState {
  skills: GuardianSkill[]
  logs: GuardianRunLog[]
}

// I.2 阶段新增：守卫运行参数（主进程可选注入；用于按文件名映射分类的预置技能）
export interface GuardianRunOptions {
  // 单分类：所有文档都归这一类（meta_fields.category 落这个值）
  category?: string
  // 运行前幂等补齐的多级分类（先父后子）
  ensureCategories?: GuardianCategorySpec[]
  // 文件名 → 叶子分类的映射器（按文件 basename 调用；返回 undefined 则不指定分类）
  categoryResolver?: (fileName: string) => string | undefined
  // I.5 阶段新增（可选）：运行时覆盖 syncMode（不改持久化，仅本次 runNow 生效）
  syncMode?: GuardianSyncMode
  // I.6 阶段新增（可选）：是否清理孤儿文档（缺省 true；源文件被删/重命名后 KB 中残留的旧 docId 会被删除）
  orphanCleanup?: boolean
  // I.7 阶段新增（可选）：软同步失败时是否自动回退到硬同步（缺省 true：docId 失效/PUT 异常时自动 deleteDocs + uploadAndParse 恢复；false 维持 I.5 行为只 push failure）
  softFallbackHard?: boolean
}

// J 阶段扩展：守卫运行事件
// - started：守卫进入运行队列（主进程发）
// - progress：每处理一个文件后发一次，供渲染层显示「> 30s」的进度条
//   - processed / total：当前处理的文件下标 / 总数（用于进度条比例）
//   - sinceStartMs：自 started 事件以来的毫秒数（避免 UI 算时间漂移）
//   - added/updated/skipped/fallbackToHard：仅 runSkill 路径携带；retry 路径不携带（语义不同）
// - finished：守卫运行结束（主进程发）
export type GuardianRunEvent =
  | { type: 'started'; skillId: string }
  | { type: 'progress'; skillId: string; processed: number; total: number; sinceStartMs: number; added?: number; updated?: number; skipped?: number; fallbackToHard?: number }
  | { type: 'finished'; skillId: string }

// J 阶段新增：失败重试入参（按 log 定位失败文件集，重跑时复用 runSkill 的 soft + softFallbackHard 路径）
export interface GuardianRetryRequest {
  skillId: string
  logId: string
}

// J 阶段新增：失败重试结果
// - retried: 本次重试处理的文件数
// - succeeded: 本次重试新增或更新的文件数（同步成功）
// - skipped: 文件已被删除/不在扩展名集合内/已被其他 run 同步成功
// - failed: 重试后仍失败的文件数
// - failures: 重试后仍失败的明细（name + reason）
export interface GuardianRetryResult {
  retried: number
  succeeded: number
  skipped: number
  failed: number
  failures: GuardianRunFailure[]
}
