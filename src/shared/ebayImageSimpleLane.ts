import type { EbayImageCategory, EbayImageCategoryCounts } from './ebayImageCategoryPlan'
import type { EbayImageVisualInspectionReport } from './contracts'

/** 简版优化：原图优化（合规沿用/不合规重生成）→ 多生图片（张数可 0）→ 图片排序（即上传顺序） */

/** eBay 图片最长边下限（与最终图集检查同口径） */
export const EBAY_IMAGE_MIN_LONGEST_EDGE = 500
/** 简版档各类张数下限：0 代表该类不需要生成 */
export const SIMPLE_CATEGORY_COUNT_MIN = 0

/** 原图角色 → 四类图（排序步按类回传下游） */
export function simpleSourceCategory(role: string): EbayImageCategory {
  if (role === 'HERO') return 'HERO'
  if (role === 'PAIN_POINT') return 'PAIN_POINT'
  if (role === 'SCENE') return 'SCENE'
  return 'PRODUCT'
}

export interface EbaySimpleSourceInput {
  url: string
  role: string
}

export interface EbaySimpleSourceMedia {
  id: string
  remoteUrl: string
  width: number
  height: number
}

/** 单张原图的合规事实：尺寸取本地快照，视觉规则取逐图缓存报告；缺数据记未知，不妄判 */
export interface EbaySimpleSourceCheck {
  url: string
  role: string
  longestEdge: number
  sizeOk: boolean
  visualOk: boolean
  visualIssues: string[]
  visualReview: string[]
  extraToPage: boolean
}

/** 文件名归一：取 basename、去 eBay /s-lNNN 缩放段（含整段文件名如 s-l1600.png）、去查询串与扩展名、转小写，用于跨源比对 */
function normalizeAssetName(value: string): string {
  const parts = value.split('/')
  let base = parts.pop() || value
  // 若 basename 纯为 eBay 缩放段（如 s-l1600.png），回退用上一级目录名作为资产名
  if (/^s-l\d+\.[a-z0-9]+$/i.test(base) && parts.length) base = parts.pop() || base
  return base.replace(/\?.*$/, '').replace(/\.[a-z0-9]+$/i, '').toLowerCase()
}

/** 原图清单 vs 图文页图集（imageAssets 为资产文件名）→ 标出多出来的图；清单为空时一律不判 */
function isExtraToPage(sourceUrl: string, pageAssets: string[]): boolean {
  if (!pageAssets.length) return false
  const sourceName = normalizeAssetName(sourceUrl)
  return !pageAssets.some(asset => normalizeAssetName(asset) === sourceName)
}

/** 尺寸（本地快照宽高）+ 视觉规则（逐图缓存报告）+ 图文页图集 → 逐张合规事实；无快照/无报告一律未知不判违规 */
export function buildSourceComplianceChecks(
  sources: EbaySimpleSourceInput[],
  media: EbaySimpleSourceMedia[],
  report?: EbayImageVisualInspectionReport | null,
  pageAssets?: string[]
): EbaySimpleSourceCheck[] {
  return (sources || []).map(source => {
    const item = (media || []).find(entry => entry.remoteUrl === source.url)
    const longestEdge = item ? Math.max(item.width || 0, item.height || 0) : 0
    const visual = item && report ? (report.images || []).find(entry => entry.mediaId === item.id) : undefined
    const rules = visual?.rules || []
    return {
      url: source.url,
      role: source.role,
      longestEdge,
      sizeOk: longestEdge === 0 || longestEdge >= EBAY_IMAGE_MIN_LONGEST_EDGE,
      visualOk: !visual || rules.every(rule => rule.status !== 'FAILED'),
      visualIssues: rules.filter(rule => rule.status === 'FAILED').map(rule => rule.label || rule.rule),
      visualReview: rules.filter(rule => rule.status === 'REVIEW').map(rule => rule.label || rule.rule),
      extraToPage: isExtraToPage(source.url, pageAssets || [])
    }
  })
}

export type EbaySimpleBackground = 'WHITE' | 'NON_WHITE' | 'UNKNOWN'

export interface EbaySimpleTriageItem {
  url: string
  reasons: string[]
}

export interface EbaySimpleTriage {
  checkedAt: string
  keep: string[]
  regen: EbaySimpleTriageItem[]
}

/** 合规事实 + 主图白底探测 → 沿用/重生成两单；主图背景仅在有探测结论时参与判定 */
export function triageSimpleSources(
  checks: EbaySimpleSourceCheck[],
  backgrounds?: Record<string, EbaySimpleBackground>
): { keep: string[]; regen: EbaySimpleTriageItem[] } {
  const keep: string[] = []
  const regen: EbaySimpleTriageItem[] = []
  for (const check of checks || []) {
    const reasons: string[] = []
    if (!check.sizeOk) reasons.push(`最长边仅 ${check.longestEdge}px，低于 ${EBAY_IMAGE_MIN_LONGEST_EDGE}px`)
    if (check.visualIssues.length) reasons.push(`视觉检查未过：${check.visualIssues.join('、')}`)
    const background = backgrounds?.[check.url]
    if (check.role === 'HERO' && background === 'NON_WHITE') reasons.push('主图背景非纯白')
    if (reasons.length) regen.push({ url: check.url, reasons })
    else keep.push(check.url)
  }
  return { keep, regen }
}

const clampSimpleCount = (value: unknown, fallback: number): number => {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number) || number < SIMPLE_CATEGORY_COUNT_MIN) return fallback
  return Math.min(4, number)
}

/** 简版档张数归一：缺失或非法取默认值，有效值钳到 0..4 */
export function normalizeSimpleCategoryCounts(input?: Partial<EbayImageCategoryCounts> | null): EbayImageCategoryCounts {
  const source = input || {}
  return {
    HERO: clampSimpleCount(source.HERO, 3),
    PRODUCT: clampSimpleCount(source.PRODUCT, 3),
    PAIN_POINT: clampSimpleCount(source.PAIN_POINT, 2),
    SCENE: clampSimpleCount(source.SCENE, 2)
  }
}

/** 简版档单类张数调整：清空或非法取 0，有效值钳到 0..4 */
export function withSimpleCategoryCount(counts: EbayImageCategoryCounts, category: EbayImageCategory, value: unknown): EbayImageCategoryCounts {
  return { ...counts, [category]: clampSimpleCount(value, SIMPLE_CATEGORY_COUNT_MIN) }
}

export type EbaySimpleMemberKind = 'ORIGINAL' | 'REGENERATED' | 'GENERATED'

export interface EbaySimpleGalleryMember {
  url: string
  category: EbayImageCategory
  kind: EbaySimpleMemberKind
}

/** 排序清单去重、剔除不在成员里的地址；新成员（未在清单也未删除）追加到末尾 */
export function normalizeSimpleOrder(order: string[], members: EbaySimpleGalleryMember[], deleted?: string[]): string[] {
  const memberUrls = new Set(members.map(member => member.url))
  const deletedUrls = new Set(deleted || [])
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of order || []) {
    if (!url || seen.has(url) || !memberUrls.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  for (const member of members) {
    if (seen.has(member.url) || deletedUrls.has(member.url)) continue
    seen.add(member.url)
    result.push(member.url)
  }
  return result
}

/** 排序清单 → 四类各自子序列（同类内顺序即上传顺序；类间按主图→细节→痛点→场景） */
export function mergeSimpleGalleryOrder(order: string[], members: EbaySimpleGalleryMember[]): Partial<Record<EbayImageCategory, string[]>> {
  const categoryByUrl = new Map(members.map(member => [member.url, member.category]))
  const mapped: Partial<Record<EbayImageCategory, string[]>> = {}
  for (const url of order || []) {
    const category = categoryByUrl.get(url)
    if (!category) continue
    const list = mapped[category] || (mapped[category] = [])
    list.push(url)
  }
  return mapped
}
