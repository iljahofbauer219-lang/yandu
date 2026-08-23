/**
 * Listing工作台 P4 桥接契约：外部来源（1688 页面提取 / 发布草稿）→ 中文商品素材。
 * 纯函数不依赖 DOM，便于工作台与回归脚本共用。素材只写实际存在的字段，
 * 缺失项交由 Listing精造师按方法论列「需补充字段」，严禁编造。
 */

import { LISTING_SITES } from './listingLocales'

/** 1688 页面提取信息（BrowserWorkspace.aiEmployeeExtractInfo 的 info 结构） */
export interface ListingExtractedInfo {
  title?: string
  url?: string
  price?: string
  seller?: string
  moq?: string
  shipFrom?: string
  deals?: string
  attributes?: string[]
  images?: string[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 1688 提取 info → 中文事实素材（键值行式，与示例素材同口径） */
export function formatExtractedAsMaterial(info: Record<string, unknown>): string {
  const lines: string[] = []
  const title = asString(info.title)
  if (title) lines.push(`商品名称：${title}`)
  const attributes = Array.isArray(info.attributes) ? (info.attributes as unknown[]).map(asString).filter(Boolean) : []
  // 规格属性逐条并入（材质/品牌/货号等由页面提取，避免手工誊抄错位）
  for (const attribute of attributes) lines.push(attribute.includes('：') ? attribute : `规格：${attribute}`)
  const price = asString(info.price)
  if (price) lines.push(`供货价：${price}`)
  const seller = asString(info.seller)
  if (seller) lines.push(`供应商：${seller}`)
  const moq = asString(info.moq)
  if (moq) lines.push(`起订量：${moq}`)
  const shipFrom = asString(info.shipFrom)
  if (shipFrom) lines.push(`发货地：${shipFrom}`)
  const images = Array.isArray(info.images) ? info.images.length : 0
  if (images > 0) lines.push(`主图素材：${images} 张（见来源页面）`)
  const url = asString(info.url)
  if (url) lines.push(`来源：${url}`)
  lines.push('认证：未知。')
  return lines.join('；')
}

/** 发布草稿带入视图（跨平台聚合后的工作台展示结构） */
export interface ListingDraftEntry {
  id: string
  marketplaceCode: string
  title: string
  platformSku: string
  priceText: string
  imageUrl: string
  status: string
}

/** 发布草稿 → 中文事实素材 */
export function formatDraftAsMaterial(draft: ListingDraftEntry): string {
  const lines: string[] = []
  if (draft.title) lines.push(`商品名称：${draft.title}`)
  if (draft.platformSku) lines.push(`SKU：${draft.platformSku}`)
  if (draft.priceText) lines.push(`价格：${draft.priceText}`)
  if (draft.imageUrl) lines.push(`主图：${draft.imageUrl}`)
  lines.push(`来源：${draft.marketplaceCode} 发布草稿（草稿仅含标题/SKU/价格/主图，其余字段需补充）`)
  return lines.join('；')
}

/** 平台编码 → 工作台站点 id（OZON 暂无对应站点，返回空数组） */
export function siteIdsForMarketplace(marketplaceCode: string): string[] {
  const platformByCode: Record<string, string> = {
    AMAZON: 'Amazon',
    EBAY: 'eBay',
    ALIEXPRESS: 'AliExpress',
    TEMU: 'Temu',
    TIKTOK: 'TikTok Shop'
  }
  const platform = platformByCode[marketplaceCode]
  if (!platform) return []
  return LISTING_SITES.filter(site => site.platform === platform).map(site => site.id)
}

/** 站点集 → 默认语言并集（带入草稿时自动勾选） */
export function defaultLanguagesForSites(siteIds: string[]): string[] {
  const languages = new Set<string>()
  for (const siteId of siteIds) {
    const site = LISTING_SITES.find(item => item.id === siteId)
    for (const language of site?.defaultLanguages || []) languages.add(language)
  }
  return [...languages]
}
