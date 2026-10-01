/**
 * 商品库 (ProductLibrary) 数据层
 *
 * 概念：
 * - 三来源：1688 提取 / 本地图片上传 / 草稿（已选未确认）
 * - 持久化：localStorage 'aiEmployee.productLibrary'
 * - 与 AIEmployee 的 extractedByConversation 联动：用户从抽屉/弹窗点选商品可预填到会话
 *
 * 数据模型：
 * - ProductLibraryItem: { id, source, title, url?, thumbnail?, price?, summary?, createdAt, payload? }
 *   - source: '1688' | 'local' | 'draft'
 *   - payload: 完整 ExtractedProductInfo（用于再次分析）
 */

import type { ExtractedProductInfo } from './selectionExtract'

export type ProductLibrarySource = '1688' | 'local' | 'draft'

export interface ProductLibraryItem {
  id: string
  source: ProductLibrarySource
  title: string
  url?: string
  thumbnail?: string
  price?: string
  /** 简短摘要：来源平台 / 供应商 / 类目 */
  summary?: string
  /** 创建时间 (ISO string) */
  createdAt: string
  /** 完整商品信息（用于再次分析） */
  payload?: ExtractedProductInfo
}

const STORAGE_KEY = 'aiEmployee.productLibrary'

/**
 * 商品库容量上限。
 * 旧值 60 太小：超出的最旧条目被静默裁掉，用户看不到任何提示就"丢商品"。
 * 提到 500 后正常用量碰不到上限；真碰到时由 addProductItem 返回 truncated 计数并 warn，不再静默。
 */
export const PRODUCT_LIBRARY_MAX = 500

export interface ProductLibraryWriteResult {
  /** 本次写入的条目 */
  item: ProductLibraryItem
  /** 因超出上限被裁掉的最旧条目数（0 = 未裁剪） */
  truncated: number
  /** 因去重（同 source + url）被替换掉的旧条目数 */
  replaced: number
  /** localStorage 写入失败原因；空串表示写入成功 */
  quotaError: string
}

export function loadProductLibrary(): ProductLibraryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isValidItem) : []
  } catch {
    return []
  }
}

/**
 * 持久化商品库。返回写入失败原因（空串 = 成功）。
 * 此前这里用一个空 catch 把配额超限/隐私模式写入失败整个吞掉，
 * 界面照常提示"已加入商品库"，刷新后条目却没了 —— 现在至少留下可诊断的 warn 与返回值。
 */
export function saveProductLibrary(items: ProductLibraryItem[]): string {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    return ''
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[product-library] 商品库写入失败（${items.length} 条未落盘）：${reason}`)
    return reason
  }
}

export function addProductItem(item: Omit<ProductLibraryItem, 'id' | 'createdAt'>): ProductLibraryWriteResult {
  const items = loadProductLibrary()
  const full: ProductLibraryItem = {
    ...item,
    id: makeId(),
    createdAt: new Date().toISOString()
  }
  // 1688 / local 去重：同 URL + source 不重复
  const dedupeKey = full.url && (full.source === '1688' || full.source === 'local') ? `${full.source}::${full.url}` : null
  const filtered = dedupeKey
    ? items.filter(it => !it.url || `${it.source}::${it.url}` !== dedupeKey)
    : items
  const replaced = items.length - filtered.length
  filtered.unshift(full)
  // 超出上限时裁掉最旧：裁剪必须可观测（返回计数 + warn），不能像以前那样悄悄丢数据
  const trimmed = filtered.slice(0, PRODUCT_LIBRARY_MAX)
  const dropped = filtered.slice(PRODUCT_LIBRARY_MAX)
  if (dropped.length) {
    console.warn(`[product-library] 商品库已达上限 ${PRODUCT_LIBRARY_MAX} 条，裁掉最旧的 ${dropped.length} 条：${dropped.map(it => it.title).join('、')}`)
  }
  const quotaError = saveProductLibrary(trimmed)
  return { item: full, truncated: dropped.length, replaced, quotaError }
}

export function removeProductItem(id: string): void {
  const items = loadProductLibrary()
  saveProductLibrary(items.filter(it => it.id !== id))
}

export function clearProductLibrary(): void {
  saveProductLibrary([])
}

function isValidItem(item: unknown): item is ProductLibraryItem {
  if (!item || typeof item !== 'object') return false
  const it = item as Record<string, unknown>
  return typeof it.id === 'string'
    && typeof it.source === 'string'
    && ['1688', 'local', 'draft'].includes(it.source as string)
    && typeof it.title === 'string'
    && typeof it.createdAt === 'string'
}

function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 来源徽标中文 */
export const SOURCE_LABELS: Record<ProductLibrarySource, { label: string; emoji: string; tone: string }> = {
  '1688': { label: '1688 提取', emoji: '🛒', tone: '#f59e0b' },
  'local': { label: '本地图片', emoji: '📎', tone: '#0ea5e9' },
  'draft': { label: '草稿', emoji: '📝', tone: '#10b981' }
}

/** 摘要构造 */
export function buildSummary(source: ProductLibrarySource, payload?: ExtractedProductInfo): string {
  if (!payload) return SOURCE_LABELS[source].label
  const parts: string[] = []
  if (payload.title) parts.push(payload.title)
  if (payload.seller) parts.push(payload.seller)
  if (payload.price) parts.push(payload.price)
  if (payload.moq) parts.push(`MOQ ${payload.moq}`)
  return parts.slice(0, 3).join(' · ')
}
