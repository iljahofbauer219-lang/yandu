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

export function loadProductLibrary(): ProductLibraryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isValidItem) : []
  } catch {
    return []
  }
}

export function saveProductLibrary(items: ProductLibraryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch { /* ignore quota */ }
}

export function addProductItem(item: Omit<ProductLibraryItem, 'id' | 'createdAt'>): ProductLibraryItem {
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
  filtered.unshift(full)
  // 最多保留 60 条
  const trimmed = filtered.slice(0, 60)
  saveProductLibrary(trimmed)
  return full
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
