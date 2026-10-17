import type { EbayStoreCategory } from './contracts'

export interface PalletCategoryMatchInput {
  title: string
  category: string
  subcategory: string
  tertiaryCategory: string
  description?: string
  coreTerm?: string
}

export interface PalletCategoryMatch {
  categoryId: string
  categoryName: string
  score: number
}

/** 大模型归类回复解析：命中树内节点返回 id；NONE/坏 JSON/树外 id 一律 null + 中文原因 */
export function parseCategoryClassifyReply(content: string, validIds: ReadonlySet<string>): { categoryId: string | null; reason: string } {
  const clean = content.trim().replace(/^```json\s*|\s*```$/g, '')
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start < 0 || end <= start) return { categoryId: null, reason: '模型返回不是有效 JSON' }
  try {
    const parsed = JSON.parse(clean.slice(start, end + 1)) as { categoryId?: unknown; reason?: unknown }
    const raw = String(parsed.categoryId ?? '').trim()
    if (!raw || raw.toUpperCase() === 'NONE') return { categoryId: null, reason: String(parsed.reason || '模型判断无合适类目') }
    if (!validIds.has(raw)) return { categoryId: null, reason: '模型返回的类目不在店铺类目树内' }
    return { categoryId: raw, reason: String(parsed.reason || '') }
  } catch {
    return { categoryId: null, reason: '模型返回 JSON 解析失败' }
  }
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9一-龥]+/g, ' ').trim()
const fold = (token: string) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)
const tokens = (value: string) => norm(value).split(' ').filter(Boolean).map(fold).filter(token => token.length >= 2)

/**
 * 货盘商品 → 店铺类目树自动归类（送入时与编辑器『自动分类』共用）。
 * 三级策略：①源三级类目名自细向粗与树节点名相等/包含（取最深节点）；
 * ②标题+描述文本 token 与节点路径 token 交集 ≥2（单复数归一）；③无匹配返回 null（落未分类，手工选）。
 */
export function matchPalletCategory(input: PalletCategoryMatchInput, tree: EbayStoreCategory[]): PalletCategoryMatch | null {
  if (!tree.length) return null
  const byId = new Map(tree.map(node => [node.categoryId, node]))
  const pathOf = (node: EbayStoreCategory): string[] => {
    const chain: string[] = []
    let current: EbayStoreCategory | undefined = node
    while (current) {
      chain.unshift(current.name)
      current = byId.get(current.parentCategoryId)
    }
    return chain
  }
  const sources = [input.tertiaryCategory, input.subcategory, input.category, input.coreTerm || ''].map(norm).filter(Boolean)
  for (const source of sources) {
    let hit: EbayStoreCategory | null = null
    for (const node of tree) {
      const nodeName = norm(node.name)
      if (!nodeName) continue
      if (nodeName === source || nodeName.includes(source) || source.includes(nodeName)) {
        if (!hit || node.level > hit.level) hit = node
      }
    }
    if (hit) return { categoryId: hit.categoryId, categoryName: hit.name, score: 100 }
  }
  const titleTokens = new Set([...tokens(input.title), ...tokens((input.description || '').slice(0, 2000))])
  let best: PalletCategoryMatch | null = null
  for (const node of tree) {
    const pathTokens = new Set(pathOf(node).flatMap(tokens))
    let overlap = 0
    for (const token of titleTokens) if (pathTokens.has(token)) overlap += 1
    if (overlap >= 2) {
      const score = overlap * 10 + node.level
      if (!best || score > best.score) best = { categoryId: node.categoryId, categoryName: node.name, score }
    }
  }
  return best
}
