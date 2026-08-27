/**
 * 零度API 价格抓取模块本地类型（避免跨目录依赖 ../shared/contracts）。
 * 与 src/shared/contracts.ts 的同名类型保持字段兼容；只在此模块内部使用。
 */

export type LinduoBillingType = 'TOKEN' | 'IMAGE' | 'VIDEO' | 'REQUEST'

export type LinduoVendor = 'openai' | 'google' | 'anthropic' | 'vidu'

export interface LinduoModelPricing {
  modelId: string
  vendor: LinduoVendor
  /** 美元 / 1M tokens */
  inputPrice: number | null
  /** 美元 / 1M tokens */
  outputPrice: number | null
  /** 美元 / 1M tokens（仅部分模型有缓存读） */
  cachePrice: number | null
  currency: 'USD'
  billingType: LinduoBillingType
  /** 图片/视频按张/按秒计费时存储 */
  pricePerUnit: number | null
  /** 1M tokens / 张 / 秒 */
  unitLabel: string | null
  fetchedAt: string
  /** true = 上次抓取失败，保留的是旧数据 */
  stale: boolean
}

// ===================== Linduo 聊天模型选用 (M1) =====================

/** Linduo 聊天模型视图（API 响应） */
export interface LinduoChatModelView {
  id: string
  modelId: string
  vendor: string
  displayName: string
  description: string | null
  contextLabel: string | null
  /** 解析后的能力数组（服务端从 JSON 字符串反序列化） */
  capabilities: string[]
  effort: string
  enabled: boolean
}

/** 用户 Linduo 模型例外视图（API 响应）—— 与 shared/contracts.ts UserLinduoExceptionView 字段一致 */
export interface UserLinduoExceptionView {
  userId: string
  modelId: string
  displayName: string
  vendor: string
  kind: 'GRANT' | 'REVOKE'
  grantedBy: string | null
  grantedAt: string
}

/** Linduo 模型等级视图（API 响应）—— R-2 */
export interface LinduoModelTierView {
  id: string
  key: 'basic' | 'advanced' | 'full'
  name: string
  description: string | null
  displayOrder: number
  isSystem: boolean
  /** 该 tier 下 LinduoTierGrant 行数 */
  grantCount: number
  /** 可选:tier 下模型详情 */
  grants?: LinduoChatModelView[]
}

/** 成员 Linduo 等级 + 例外 汇总视图(API 响应)—— R-2 */
export interface LinduoMemberTierView {
  memberId: string
  memberName: string
  memberEmail: string
  isOwner: boolean
  tier: LinduoModelTierView | null
  exceptions: Array<{
    modelId: string
    modelDisplayName: string
    vendor: string
    kind: 'GRANT' | 'REVOKE'
    grantedBy: string | null
    grantedAt: string
  }>
}
