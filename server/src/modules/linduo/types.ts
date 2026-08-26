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

/** 用户 Linduo 模型授权视图（API 响应） */
export interface UserLinduoGrantView {
  userId: string
  modelId: string
  displayName: string
  vendor: string
  grantedBy: string | null
  grantedAt: string
}
