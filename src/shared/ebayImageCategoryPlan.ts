export interface EbayMarketingFacts {
  purchaseReason: string
  painPoints: string[]
  scenarios: string[]
}

export type EbayImageOutputMode = 'PURE' | 'TEXT_COMBO'

export type EbayImageCategory = 'HERO' | 'PRODUCT' | 'PAIN_POINT' | 'SCENE'

/** 四类图片各自生成张数 */
export type EbayImageCategoryCounts = Record<EbayImageCategory, number>

export interface EbayCategoryShotCard {
  id: string
  category: EbayImageCategory
  title: string
  instruction: string
  variations: number
  /** 互斥机位/构图描述（痛点/场景卡同类多张不雷同） */
  framing?: string
  /** 商品属性事实行（材质/部件/尺寸锚定） */
  factsLine?: string
  /** 套装同框声明（N 件套强制同框 N 件） */
  setStatement?: string
}

const CATEGORY_TITLES: Record<EbayImageCategory, string> = {
  HERO: '主图', PRODUCT: '产品细节图', PAIN_POINT: '痛点解决图', SCENE: '应用场景图'
}

/** 文案/输入标签用的简称（与四类数量输入、按钮文案一致） */
const CATEGORY_SHORT_LABELS: Record<EbayImageCategory, string> = {
  HERO: '主图', PRODUCT: '细节', PAIN_POINT: '痛点', SCENE: '场景'
}

/** 默认每类张数：主图与细节图通常需要更多，痛点/场景受事实条数限制 */
export const DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS: EbayImageCategoryCounts = { HERO: 3, PRODUCT: 3, PAIN_POINT: 2, SCENE: 2 }

export const EBAY_IMAGE_CATEGORY_COUNT_MIN = 1
export const EBAY_IMAGE_CATEGORY_COUNT_MAX = 4

export function marketingFactCategoryLabel(category: EbayImageCategory): string {
  return CATEGORY_TITLES[category]
}

export function marketingFactCategoryShortLabel(category: EbayImageCategory): string {
  return CATEGORY_SHORT_LABELS[category]
}

/** 单个数量：非法（NaN/非正数）回落默认值，有效值钳到 1..4 */
function clampCount(value: unknown, fallback: number): number {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number) || number < EBAY_IMAGE_CATEGORY_COUNT_MIN) return fallback
  return Math.min(EBAY_IMAGE_CATEGORY_COUNT_MAX, number)
}

/** 四类数量归一化：缺失或非法一律取该类默认值 */
export function normalizeEbayImageCategoryCounts(input?: Partial<EbayImageCategoryCounts> | null): EbayImageCategoryCounts {
  const source = input || {}
  return {
    HERO: clampCount(source.HERO, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.HERO),
    PRODUCT: clampCount(source.PRODUCT, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.PRODUCT),
    PAIN_POINT: clampCount(source.PAIN_POINT, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.PAIN_POINT),
    SCENE: clampCount(source.SCENE, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.SCENE)
  }
}

/** 单类数量调整：清空或非法取最小值，有效值钳到 1..4（其余三类保持不变） */
export function withEbayImageCategoryCount(counts: EbayImageCategoryCounts, category: EbayImageCategory, value: unknown): EbayImageCategoryCounts {
  return { ...counts, [category]: clampCount(value, EBAY_IMAGE_CATEGORY_COUNT_MIN) }
}

/** 旧版单一「每类图片数」→ 四类同值迁移 */
export function ebayImageCountsFromLegacyPerCount(perCount: unknown): EbayImageCategoryCounts {
  const number = Math.floor(Number(perCount))
  if (!Number.isFinite(number) || number < EBAY_IMAGE_CATEGORY_COUNT_MIN) return { ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS }
  const count = Math.min(EBAY_IMAGE_CATEGORY_COUNT_MAX, number)
  return { HERO: count, PRODUCT: count, PAIN_POINT: count, SCENE: count }
}

/** 按钮/摘要文案：主图 3 · 细节 3 · 痛点 2 · 场景 2 */
export function describeEbayImageCategoryCounts(counts: EbayImageCategoryCounts): string {
  return (Object.keys(CATEGORY_SHORT_LABELS) as EbayImageCategory[])
    .map(category => `${CATEGORY_SHORT_LABELS[category]} ${counts[category]}`)
    .join(' · ')
}

/** 大模型回复 → 营销事实卡（1 个购买理由 + 1~3 痛点 + 1~3 场景）；不合法返回 null */
export function parseMarketingFactsReply(content: string): EbayMarketingFacts | null {
  if (!content || typeof content !== 'string') return null
  let parsed: unknown = null
  try {
    const clean = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    parsed = JSON.parse(clean.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const row = parsed as Record<string, unknown>
  const purchaseReason = String(row.purchaseReason || '').replace(/\s+/g, ' ').trim()
  const clamp = (value: unknown): string[] => (Array.isArray(value) ? value : [])
    .map(item => String(item).replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 4 && item.length <= 200)
    .slice(0, 3)
  const painPoints = clamp(row.painPoints)
  const scenarios = clamp(row.scenarios)
  if (!purchaseReason || purchaseReason.length < 4 || !painPoints.length || !scenarios.length) return null
  return { purchaseReason, painPoints, scenarios }
}

const HERO_SHOTS = ['纯白底正面主图，商品占幅≥80%', '纯白底 45 度侧视主图', '纯白底背面主图', '纯白底俯视主图']

/** 细节图四档互斥构图：材质微距 / 五金结构 / 尺寸配件 / 操作演示（A/B 实测：空泛短语会让模型出同视角重复图） */
const PRODUCT_SHOTS = [
  'extreme macro close-up of the surface material grain and the stitching thread line in sharp focus, shallow depth of field',
  'close-up of hardware and structure: slider rails, recline adjuster and frame joints, three-quarter low angle',
  'full product view with a size reference prop beside it: overall proportions and every included accessory visible',
  'in-use operation close-up demonstrating the adjustable or moving part mid-action'
]

/** 痛点/场景卡互斥机位：同一条事实按不同机位出图，避免同类多张雷同 */
const PAIN_FRAMINGS = [
  'installed in the vehicle cabin viewed from the open driver door, side bolsters and lumbar support clearly gripping the seating space',
  'view from the rear of the cabin showing the seat back and headrest cutouts, with a plain worn factory seat glimpsed in the background as contrast'
]

const SCENE_FRAMINGS = [
  'environment shot from the driver side with daylight through the windows and street bokeh outside',
  'environment shot from a low front angle showing the product in its real usage setting with contextual props'
]

/** 分镜构建上下文：标题/描述/属性用于把商品事实写进生图指令 */
export interface EbayCategoryShotContext {
  title?: string
  description?: string
  itemSpecifics?: Array<{ name: string; value: string }>
}

/** 标题/描述中的套装件数（2PC、3 件套…）；识别不到返回 null */
export function extractSetCount(text: string): number | null {
  const match = String(text || '').match(/(\d+)\s*(?:pcs?|pieces?|件套|件装)|(\d+)\s*PC\b/i)
  const value = Number(match?.[1] || match?.[2] || 0)
  return value >= 2 && value <= 12 ? value : null
}

/** 商品事实行：属性 name:value 至多 6 组，供生图提示词锚定材质/部件/尺寸 */
export function buildProductFactsLine(context?: EbayCategoryShotContext): string {
  return (context?.itemSpecifics || [])
    .map(item => `${String(item.name || '').replace(/\s+/g, ' ').trim()}: ${String(item.value || '').replace(/\s+/g, ' ').trim()}`)
    .filter(item => item.length > 3 && item.length <= 80)
    .slice(0, 6)
    .join('; ')
}

/** 套装声明：商品为 N 件套时强制同框 N 件，避免模型只画单件 */
export function buildSetStatement(context?: EbayCategoryShotContext): string {
  const count = extractSetCount(`${context?.title || ''} ${context?.description || ''}`)
  return count ? `The product is a ${count}-piece set: show all ${count} pieces together as a matched set, never a single piece.` : ''
}

/** 四类各自优先参照的原图角色标签（与『02 选择原图』角色一致）；缺角色时按序回落 */
const REFERENCE_ROLE_PRIORITY: Record<EbayImageCategory, string[]> = {
  HERO: ['主图', '正面', '背面', '侧面'],
  PRODUCT: ['细节', '尺寸参照', '安装', '正面', '主图'],
  PAIN_POINT: ['痛点依据', '正面', '细节', '主图'],
  SCENE: ['应用场景', '主图', '正面']
}

/** 去掉 CDN 缩略图处理参数（x-oss-process），尽量用原图分辨率作参照 */
export function fullSizeReferenceUrl(url: string): string {
  if (!url.includes('x-oss-process=')) return url
  const [base, query = ''] = url.split('?')
  const kept = query.split('&').filter(part => part && !part.startsWith('x-oss-process='))
  return kept.length ? `${base}?${kept.join('&')}` : base
}

/** 按分镜类别挑参照图：角色优先 + 去重 + 上限裁剪 + 全空回落前 N 张 */
export function selectCategoryReferences(sourceImages: string[], sourceLabels: string[], category: EbayImageCategory, limit: number): string[] {
  const max = Math.max(0, Math.floor(limit))
  if (max === 0) return []
  const picked: string[] = []
  for (const keyword of REFERENCE_ROLE_PRIORITY[category]) {
    sourceImages.forEach((url, index) => {
      if (picked.length >= max) return
      if ((sourceLabels[index] || '').includes(keyword) && !picked.includes(url)) picked.push(url)
    })
  }
  for (const url of sourceImages) {
    if (picked.length >= max) break
    if (!picked.includes(url)) picked.push(url)
  }
  return picked.slice(0, max).map(fullSizeReferenceUrl)
}

/** 四类图分镜计划：每类按各自数量出卡，痛点/场景另受事实条数封顶（min(数量, 事实数)） */
export function buildCategoryShotCards(facts: EbayMarketingFacts, counts?: Partial<EbayImageCategoryCounts>, context?: EbayCategoryShotContext): EbayCategoryShotCard[] {
  const next = normalizeEbayImageCategoryCounts(counts)
  const factsLine = buildProductFactsLine(context)
  const setStatement = buildSetStatement(context)
  const cards: EbayCategoryShotCard[] = []
  HERO_SHOTS.slice(0, next.HERO).forEach((shot, index) => {
    cards.push({ id: `HERO-${index + 1}`, category: 'HERO', title: `${CATEGORY_TITLES.HERO} ${index + 1}`, instruction: shot, variations: 1, factsLine, setStatement })
  })
  PRODUCT_SHOTS.slice(0, next.PRODUCT).forEach((shot, index) => {
    cards.push({ id: `PRODUCT-${index + 1}`, category: 'PRODUCT', title: `${CATEGORY_TITLES.PRODUCT} ${index + 1}`, instruction: shot, variations: 1, factsLine, setStatement })
  })
  facts.painPoints.slice(0, next.PAIN_POINT).forEach((pain, index) => {
    cards.push({
      id: `PAIN-${index + 1}`, category: 'PAIN_POINT', title: `${CATEGORY_TITLES.PAIN_POINT} ${index + 1}`,
      instruction: `Show the pain point and its resolution in one frame: ${pain}. The resolved state must be visible (firm support, stable mounting, no wobble). Prefer the installed product without people; if a person appears, exactly one.`,
      framing: PAIN_FRAMINGS[index % PAIN_FRAMINGS.length], variations: 1, factsLine, setStatement
    })
  })
  facts.scenarios.slice(0, next.SCENE).forEach((scenario, index) => {
    cards.push({
      id: `SCENE-${index + 1}`, category: 'SCENE', title: `${CATEGORY_TITLES.SCENE} ${index + 1}`,
      instruction: `Real usage scene: ${scenario}. The product remains the hero of the frame.`,
      framing: SCENE_FRAMINGS[index % SCENE_FRAMINGS.length], variations: 1, factsLine, setStatement
    })
  })
  return cards
}

/** 出图模式提示词：PURE=eBay 纯图严禁文字；TEXT_COMBO=亚马逊风格允许简洁卖点文字图层 */
export function buildCategoryGenerationPrompt(card: EbayCategoryShotCard, facts: EbayMarketingFacts, mode: EbayImageOutputMode): string {
  const base = [
    `Create ${CATEGORY_TITLES[card.category]} for an e-commerce listing.`,
    `Shot requirement: ${card.instruction}`,
    card.framing ? `Framing: ${card.framing}` : '',
    card.setStatement || '',
    card.factsLine ? `Product facts: ${card.factsLine}` : '',
    `Why buyers want it: ${facts.purchaseReason}`,
    'Keep the sellable product identity, structure, proportions, color, material and packaging exactly as in the reference images.',
    'No watermark, no border, no promotional badge, no measurement labels.'
  ].filter(Boolean)
  if (mode === 'PURE') {
    // 旧文案对全部卡片都写「plain clean background」，实测会把痛点/场景图也压成棚拍白底
    base.push(card.category === 'HERO'
      ? 'eBay rule: absolutely NO added text, logos or graphics of any kind; plain clean white background.'
      : 'eBay rule: absolutely NO added text, logos or graphics of any kind; background must follow the shot requirement above.')
  } else {
    base.push('Amazon style: may include one short benefit text overlay (max 6 words) rendered cleanly; still no watermark or border.')
  }
  return base.join('\n')
}
