import {
  DEFAULT_EBAY_IMAGE_MODEL_PRESENCE,
  DEFAULT_EBAY_IMAGE_RULES,
  buildRulePromptLines,
  type EbayImageModelPresence,
  type EbayImageRuleState
} from './ebayImageRules'

export interface EbayMarketingFacts {
  purchaseReason: string
  painPoints: string[]
  scenarios: string[]
  /** 产品下载图文页「产品规格」原文（主进程直取，不经大模型改写），只保留产品尺寸/颜色/材质 */
  specifications?: string[]
  /** 产品特点 1~3 条：大模型仅压缩合并图文页原文；未返回时回落页面原文清洗 */
  features?: string[]
  /** 事实卡口径版本：展示口径收紧后旧存档需重生成一次 */
  factsVersion?: number
}

/** 当前事实卡口径版本（旧存档低于此版本时面板自动重生成一次） */
export const MARKETING_FACTS_VERSION = 2

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
  /** 同类第几张（0 起）：决定用哪个机位的参照图 */
  siblingIndex?: number
  /** 同类一共几张：>1 时才写「必须与其余各张明显不同」 */
  siblingCount?: number
  /** 指定参照图（简版档「原图整改」以被整改原图为唯一参照）；缺省按类别轮换选取 */
  referenceUrls?: string[]
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

/** 单个数量：非法（NaN/非正数）回落默认值，有效值钳到 min..4 */
function clampCount(value: unknown, fallback: number, min: number): number {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number) || number < min) return fallback
  return Math.min(EBAY_IMAGE_CATEGORY_COUNT_MAX, number)
}

/** 四类数量归一化：缺失或非法一律取该类默认值；min 默认 1（简版档传 0 允许「该类不生成」） */
export function normalizeEbayImageCategoryCounts(input?: Partial<EbayImageCategoryCounts> | null, min: number = EBAY_IMAGE_CATEGORY_COUNT_MIN): EbayImageCategoryCounts {
  const source = input || {}
  return {
    HERO: clampCount(source.HERO, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.HERO, min),
    PRODUCT: clampCount(source.PRODUCT, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.PRODUCT, min),
    PAIN_POINT: clampCount(source.PAIN_POINT, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.PAIN_POINT, min),
    SCENE: clampCount(source.SCENE, DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS.SCENE, min)
  }
}

/** 单类数量调整：清空或非法取最小值，有效值钳到 1..4（其余三类保持不变） */
export function withEbayImageCategoryCount(counts: EbayImageCategoryCounts, category: EbayImageCategory, value: unknown): EbayImageCategoryCounts {
  return { ...counts, [category]: clampCount(value, EBAY_IMAGE_CATEGORY_COUNT_MIN, EBAY_IMAGE_CATEGORY_COUNT_MIN) }
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

/** 大模型回复 → 营销事实卡（1 个购买理由 + 1~3 痛点 + 1~3 场景 + 可选 1~3 产品特点）；不合法返回 null */
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
  const features = clamp(row.features)
  return features.length ? { purchaseReason, painPoints, scenarios, features } : { purchaseReason, painPoints, scenarios }
}

/** 事实卡缺项统一中文占位：不留空块、不弹报错 */
export const MARKETING_FACT_MISSING = '资料未提及'

export interface EbayMarketingFactRow { label: string; text: string }

/** 不进大模型的两项事实：与「标题优化」环节同源（核心商品词、已确认市场词） */
export interface EbayMarketingFactContext { coreTerm?: string; searchTerms?: string[] }

/** 「② 营销事实卡」七项定序：核心商品词/搜索长尾词（标题优化同源）→ 产品规格/产品特点（下载图文页原文）→ 购买理由/痛点解决/应用场景 */
export function buildMarketingFactRows(facts: EbayMarketingFacts | null, context?: EbayMarketingFactContext): EbayMarketingFactRow[] {
  const one = (value: string) => (value || '').replace(/\s+/g, ' ').trim() || MARKETING_FACT_MISSING
  const many = (values?: string[]) => {
    const items = (values || []).map(item => (item || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    /** 条目自带句号时行内「；」是多余叠字：句号收尾直接接下一条，未收尾的仍用「；」分隔 */
    const joined = items.reduce((acc, item) => acc + (acc && !/[。！？]$/.test(acc) ? '；' : '') + item, '')
    return joined || MARKETING_FACT_MISSING
  }
  return [
    { label: '核心商品词', text: one(context?.coreTerm || '') },
    { label: '搜索长尾词', text: many(context?.searchTerms) },
    { label: '产品规格', text: many(facts?.specifications) },
    { label: '产品特点', text: many(facts?.features) },
    { label: '购买理由', text: one(facts?.purchaseReason || '') },
    { label: '痛点解决', text: many(facts?.painPoints) },
    { label: '应用场景', text: many(facts?.scenarios) }
  ]
}

/** 搜索长尾词只留最主要这几条 */
export const MARKETING_SEARCH_TERM_LIMIT = 5
/** 产品特点只留提炼后的这几条 */
export const MARKETING_FEATURE_LIMIT = 3

export interface MarketingSearchTermStat {
  term: string
  count?: number
  coverage?: number
}

/** 搜索长尾词取最主要 5 个：按成交件数降序、次按覆盖率降序，忽略大小写去重 */
export function topMarketingSearchTerms(stats?: Array<MarketingSearchTermStat | null> | null, limit = MARKETING_SEARCH_TERM_LIMIT): string[] {
  const seen = new Set<string>()
  return (stats || []).filter(item => !!item && String(item.term || '').trim().length > 0)
    .sort((a, b) => (Number(b?.count) || 0) - (Number(a?.count) || 0) || (Number(b?.coverage) || 0) - (Number(a?.coverage) || 0))
    .map(item => String(item?.term).replace(/\s+/g, ' ').trim())
    .filter(term => {
      const key = term.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, Math.max(1, limit))
}

const normalizeSpecKey = (key: string) => String(key || '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')')
const specUnit = (key: string) => { const matched = normalizeSpecKey(key).match(/\(([^)]+)\)/); return matched ? matched[1].trim() : '' }
const specValue = (key: string) => String(key || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim()

/**
 * 产品规格只留三项：产品尺寸、颜色、材质。
 * 图文页把尺寸拆成「组装长度/宽度/高度 (英寸)」三个键，这里合并为一条「长×宽×高 单位」，其余键（Item Code、产地、重量等）一律不取。
 */
export function pickMarketingSpecifications(specs?: Array<{ key: string; value: string } | null> | null): string[] {
  const items = (specs || []).filter(item => !!item)
  const rows: string[] = []
  const dims: string[] = []
  let unit = ''
  for (const word of ['长度', '宽度', '高度', '深度']) {
    const found = items.find(item => normalizeSpecKey(item.key).includes(word))
    const value = found ? specValue(found.value) : ''
    if (!found || !value) continue
    dims.push(value)
    unit = unit || specUnit(found.key)
  }
  const direct = items.find(item => normalizeSpecKey(item.key).includes('尺寸'))
  const directValue = direct ? specValue(direct.value) : ''
  if (dims.length >= 2) rows.push(`产品尺寸：${dims.join('×')}${unit ? ` ${unit}` : ''}`)
  else if (directValue) rows.push(`产品尺寸：${directValue}`)
  for (const word of ['颜色', '材质']) {
    const found = items.find(item => normalizeSpecKey(item.key).includes(word))
    const value = found ? specValue(found.value) : ''
    if (value) rows.push(`${word}：${value}`)
  }
  return rows
}

/** 产品特点回落：清洗图文页原文行首的 ⚠️✅/「1.」等编号符号，最多 3 条 */
export function cleanMarketingFeatureLines(features?: string[] | null, limit = MARKETING_FEATURE_LIMIT): string[] {
  const symbols = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+/gu
  return (features || [])
    .map(item => String(item || '').replace(symbols, '').replace(/^(?:\d{1,2}\s*[.、)]|[-*•·])\s*/, ''))
    .map(item => item.replace(symbols, '').replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 4 && item.length <= 200)
    .slice(0, Math.max(1, limit))
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

/**
 * 同类第 N 张分镜应锚定的原图视角（与 HERO_SHOTS / PRODUCT_SHOTS 的机位顺序一一对应）。
 * 主图第 1 张用正面、第 2 张用侧面…；细节卡按材质/五金/尺寸/安装分档，避免同类多张共用同一组参照而出雷同图。
 */
const CATEGORY_ANGLE_KEYWORDS: Partial<Record<EbayImageCategory, string[][]>> = {
  HERO: [['主图', '正面'], ['侧面', '45'], ['背面'], ['俯视', '顶部']],
  PRODUCT: [['细节'], ['五金', '结构'], ['尺寸参照'], ['安装', '操作']]
}

/** 去掉 CDN 缩略图处理参数（x-oss-process），尽量用原图分辨率作参照 */
export function fullSizeReferenceUrl(url: string): string {
  if (!url.includes('x-oss-process=')) return url
  const [base, query = ''] = url.split('?')
  const kept = query.split('&').filter(part => part && !part.startsWith('x-oss-process='))
  return kept.length ? `${base}?${kept.join('&')}` : base
}

function urlsLabeled(sourceImages: string[], sourceLabels: string[], keywords: string[]): string[] {
  const picked: string[] = []
  for (const keyword of keywords) {
    sourceImages.forEach((url, index) => {
      if ((sourceLabels[index] || '').includes(keyword) && !picked.includes(url)) picked.push(url)
    })
  }
  return picked
}

/**
 * 按分镜类别挑参照图：本卡机位视角原图打头 → 角色优先/原图顺序按 siblingIndex 轮转补齐。
 * 没有该视角原图时（标签缺角色）整组参照往后挪位，保证同类多张不共用同一组参照而出雷同图；rotation=0 与旧口径逐张一致。
 */
export function selectCategoryReferences(sourceImages: string[], sourceLabels: string[], category: EbayImageCategory, limit: number, rotation = 0): string[] {
  const max = Math.max(0, Math.floor(limit))
  if (max === 0 || !sourceImages.length) return []
  const shift = Number.isFinite(rotation) ? Math.max(0, Math.floor(rotation)) : 0
  const angles = CATEGORY_ANGLE_KEYWORDS[category]
  const anchor = angles ? urlsLabeled(sourceImages, sourceLabels, angles[shift % angles.length]) : []
  const rest: string[] = []
  const seen = new Set(anchor)
  for (const url of [...urlsLabeled(sourceImages, sourceLabels, REFERENCE_ROLE_PRIORITY[category]), ...sourceImages]) {
    if (seen.has(url)) continue
    seen.add(url)
    rest.push(url)
  }
  const start = anchor.length ? 0 : rest.length ? shift % rest.length : 0
  const picked = [...anchor]
  for (let step = 0; step < rest.length && picked.length < max; step += 1) picked.push(rest[(step + start) % rest.length])
  return picked.slice(0, max).map(fullSizeReferenceUrl)
}

/** 四类图分镜计划：每类按各自数量出卡，痛点/场景另受事实条数封顶（min(数量, 事实数)） */
export function buildCategoryShotCards(facts: EbayMarketingFacts, counts?: Partial<EbayImageCategoryCounts>, context?: EbayCategoryShotContext, minPerCategory: number = EBAY_IMAGE_CATEGORY_COUNT_MIN): EbayCategoryShotCard[] {
  const next = normalizeEbayImageCategoryCounts(counts, minPerCategory)
  const factsLine = buildProductFactsLine(context)
  const setStatement = buildSetStatement(context)
  const cards: EbayCategoryShotCard[] = []
  const push = (category: EbayImageCategory, idPrefix: string, total: number, items: Array<Pick<EbayCategoryShotCard, 'instruction' | 'framing' | 'title'>>) => {
    items.forEach((item, index) => {
      cards.push({ id: `${idPrefix}-${index + 1}`, category, title: item.title, instruction: item.instruction, variations: 1, framing: item.framing, factsLine, setStatement, siblingIndex: index, siblingCount: total })
    })
  }
  const heroShots = HERO_SHOTS.slice(0, next.HERO)
  push('HERO', 'HERO', heroShots.length, heroShots.map((shot, index) => ({ instruction: shot, title: `${CATEGORY_TITLES.HERO} ${index + 1}` })))
  const productShots = PRODUCT_SHOTS.slice(0, next.PRODUCT)
  push('PRODUCT', 'PRODUCT', productShots.length, productShots.map((shot, index) => ({ instruction: shot, title: `${CATEGORY_TITLES.PRODUCT} ${index + 1}` })))
  const pains = facts.painPoints.slice(0, next.PAIN_POINT)
  push('PAIN_POINT', 'PAIN', pains.length, pains.map((pain, index) => ({
    // 人物/动物与否由「模特」选项在提示词里统一控制，此处不再写死
    instruction: `Show the pain point and its resolution in one frame: ${pain}. The resolved state must be visible (firm support, stable mounting, no wobble).`,
    framing: PAIN_FRAMINGS[index % PAIN_FRAMINGS.length], title: `${CATEGORY_TITLES.PAIN_POINT} ${index + 1}`
  })))
  const scenes = facts.scenarios.slice(0, next.SCENE)
  push('SCENE', 'SCENE', scenes.length, scenes.map((scenario, index) => ({
    instruction: `Real usage scene: ${scenario}. The product remains the hero of the frame.`,
    framing: SCENE_FRAMINGS[index % SCENE_FRAMINGS.length], title: `${CATEGORY_TITLES.SCENE} ${index + 1}`
  })))
  return cards
}

/** 生成提示词的规则上下文：不传 = 旧文案逐字节不变；传了则按勾选规则与模特选项拼装 */
export interface EbayCategoryShotPromptOptions {
  rules?: EbayImageRuleState
  presence?: EbayImageModelPresence
}

/** 出图模式提示词：PURE=eBay 纯图严禁文字；TEXT_COMBO=亚马逊风格允许简洁卖点文字图层 */
export function buildCategoryGenerationPrompt(card: EbayCategoryShotCard, facts: EbayMarketingFacts, mode: EbayImageOutputMode, options?: EbayCategoryShotPromptOptions): string {
  const styled = !!options
  const base = [
    `Create ${CATEGORY_TITLES[card.category]} for an e-commerce listing.`,
    `Shot requirement: ${card.instruction}`,
    card.framing ? `Framing: ${card.framing}` : '',
    card.setStatement || '',
    card.factsLine ? `Product facts: ${card.factsLine}` : '',
    `Why buyers want it: ${facts.purchaseReason}`,
    // 勾选规则时改由规则行承载（措辞更强且可关），不再重复输出旧的两行
    styled ? '' : 'Keep the sellable product identity, structure, proportions, color, material and packaging exactly as in the reference images.',
    styled ? '' : 'No watermark, no border, no promotional badge, no measurement labels.'
  ].filter(Boolean)
  if (styled) {
    base.push(...buildRulePromptLines(
      options.rules ?? DEFAULT_EBAY_IMAGE_RULES,
      options.presence ?? DEFAULT_EBAY_IMAGE_MODEL_PRESENCE,
      mode, card.category, card.siblingCount ?? 1
    ))
  }
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
