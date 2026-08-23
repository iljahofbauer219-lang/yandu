/**
 * 选品采集域工具函数：移植自 AppDatabase.ts 顶部私有函数。
 */

/** 候选图是否可用：必须是 http(s) 链接，且不是占位/懒加载/默认图 */
export function isUsableCandidateImage(value: string) {
  return /^https?:\/\//i.test(value) && !/(?:product_base|placeholder|default[-_]?image|loading|lazyload|blank|transparent|no[-_]?image)/i.test(value)
}
