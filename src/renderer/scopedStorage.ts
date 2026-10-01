/**
 * 渲染进程「按维度键」localStorage 的统一前缀 + LRU 裁剪工具。
 *
 * 背景：eBay 原图策展、利润假设、比价决策、市场调研词、标题中译等配置都按
 * listingId / productId / storeId 维度落 localStorage，键数量随商品与店铺线性增长
 * 且从不清理，长期使用会顶满配额（写入抛 QuotaExceededError）并拖慢读取。
 *
 * 约定：
 * - 所有维度键统一加 `scoped:v1:` 前缀，便于按前缀识别、统计与整体裁剪；
 * - 一个索引键记录维度键的「最近写入」顺序（数组头 = 最新）；
 * - 每次写入后按 LRU 裁剪，超出上限的最旧键连同索引项一并删除。同一商品的多个
 *   维度键写入时间相邻，因此裁剪后仍成套保留最近操作过的商品；
 * - 读取时若命中未加前缀的历史键，自动迁移到新键并删除历史键（一次性）。
 *
 * parseScopedOrder / pruneScopedKeys 是不依赖 DOM 的纯函数，可用内存替身单测。
 */

/** localStorage 的最小子集：单测可用 Map 实现替身，无需 jsdom */
export type ScopedStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 维度键统一前缀；历史键 = 新键去掉该前缀 */
export const SCOPED_STORAGE_PREFIX = 'scoped:v1:'

/** 维度键总数上限（索引键自身不计入） */
export const SCOPED_STORAGE_LIMIT = 200

/** LRU 索引键：值为字符串数组，头部最新（导出仅供诊断与单测断言，业务代码不应直接读写） */
export const SCOPED_STORAGE_ORDER_KEY = `${SCOPED_STORAGE_PREFIX}__lru-order`

/**
 * 拼接维度键。family 需自带版本号（如 `ebay-source-selection:v1`），
 * 这样去掉统一前缀后正好等于历史键名，迁移无需额外映射表。
 */
export function scopedStorageKey(family: string, id: string): string {
  return `${SCOPED_STORAGE_PREFIX}${family}:${id}`
}

/** 解析 LRU 索引：容错非法 JSON / 非数组 / 非字符串项，并按首次出现位置去重 */
export function parseScopedOrder(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
  } catch {
    return []
  }
}

/**
 * 纯函数：把 touched 提到队首并按 limit 裁剪，返回新索引与本次被淘汰的键。
 * limit <= 0 视为不裁剪（避免误配置一次性清空全部维度数据）。
 */
export function pruneScopedKeys(order: string[], touched: string, limit: number): { order: string[]; evicted: string[] } {
  const next = [touched, ...order.filter(key => key !== touched)]
  if (limit <= 0 || next.length <= limit) return { order: next, evicted: [] }
  return { order: next.slice(0, limit), evicted: next.slice(limit) }
}

/** 新键对应的历史键；本身不带统一前缀的键返回 null */
function legacyScopedKey(key: string): string | null {
  return key.startsWith(SCOPED_STORAGE_PREFIX) ? key.slice(SCOPED_STORAGE_PREFIX.length) : null
}

function persistScopedOrder(store: ScopedStore, order: string[]): void {
  try {
    store.setItem(SCOPED_STORAGE_ORDER_KEY, JSON.stringify(order))
  } catch {
    /* 索引写失败（配额不足）不影响业务键本身，放弃本次索引更新 */
  }
}

/**
 * 写入维度键并按 LRU 裁剪，返回被淘汰的键列表（供调用方排查/埋点）。
 * 任何存储异常都吞掉：本地缓存写不进去不应中断用户的业务流程。
 */
export function writeScopedItem(store: ScopedStore, key: string, value: string): string[] {
  try {
    store.setItem(key, value)
    const { order, evicted } = pruneScopedKeys(parseScopedOrder(store.getItem(SCOPED_STORAGE_ORDER_KEY)), key, SCOPED_STORAGE_LIMIT)
    persistScopedOrder(store, order)
    for (const stale of evicted) {
      try {
        store.removeItem(stale)
      } catch {
        /* 单个键删除失败不影响其余裁剪 */
      }
    }
    return evicted
  } catch {
    return []
  }
}

/**
 * 读取维度键：命中历史键时先迁移到新键（迁移即视为最近使用）再返回。
 * 读取不更新索引顺序，避免列表渲染阶段产生大量同步写入；
 * 因此 LRU 的「最近使用」以最近一次写入时间近似。
 */
export function readScopedItem(store: ScopedStore, key: string): string | null {
  try {
    const current = store.getItem(key)
    if (current !== null) return current
    const legacy = legacyScopedKey(key)
    if (!legacy) return null
    const migrated = store.getItem(legacy)
    if (migrated === null) return null
    writeScopedItem(store, key, migrated)
    store.removeItem(legacy)
    return migrated
  } catch {
    return null
  }
}
