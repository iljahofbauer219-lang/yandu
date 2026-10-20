import type { EbayImageCategory, EbayImageOutputMode } from './ebayImageCategoryPlan'

export type EbayImageRuleId =
  | 'FIDELITY'
  | 'DISTINCT'
  | 'FACTS_ONLY'
  | 'PLATFORM'
  | 'CLEAN_FRAME'
  | 'COLOR_TRUE'
  | 'SET_COMPLETE'
  | 'SOUND_STRUCTURE'
  | 'SCALE_TRUE'

export interface EbayImageRuleDefinition {
  id: EbayImageRuleId
  label: string
  detail: string
  /** 锁定的规则在界面上置灰不可关：关掉即等于生成不合规或不可用的图 */
  locked: boolean
}

/** 生图核心规则清单（中文给用户看，英文行进提示词给模型看） */
export const EBAY_IMAGE_RULES: EbayImageRuleDefinition[] = [
  { id: 'FIDELITY', label: '商品 100% 还原', detail: '外形、轮廓、缝线、开孔、五金、配件、颜色、材质与比例一律照原图，不改款不美化', locked: true },
  { id: 'DISTINCT', label: '同类不重复', detail: '同一类多张必须机位、景别、构图各不相同；检测到雷同自动换参照重出', locked: true },
  { id: 'FACTS_ONLY', label: '只用事实卡', detail: '痛点、场景与卖点只取事实卡条目，不编造功能、参数或认证', locked: false },
  { id: 'PLATFORM', label: '按平台规则出图', detail: '当前平台图片规范内置进提示词（eBay 纯白底无文字，亚马逊可加简洁卖点）', locked: true },
  { id: 'CLEAN_FRAME', label: '无水印边框角标', detail: '不加水印、外框、促销徽章、价格、星标与任何附加文字', locked: false },
  { id: 'COLOR_TRUE', label: '颜色真实不偏色', detail: '不做调色与滤镜，屏幕上颜色与实物一致', locked: false },
  { id: 'SET_COMPLETE', label: '套装同框齐件', detail: 'N 件套必须同框出现 N 件，不出单件', locked: false },
  { id: 'SOUND_STRUCTURE', label: '结构合理无畸变', detail: '不出现多余或缺失的肢体与部件，透视与投影正确，表面无乱码文字', locked: false },
  { id: 'SCALE_TRUE', label: '尺寸不夸大', detail: '保持真实比例，不用误导大小的参照物', locked: false }
]

export type EbayImageRuleState = Record<EbayImageRuleId, boolean>

export const DEFAULT_EBAY_IMAGE_RULES: EbayImageRuleState = {
  FIDELITY: true, DISTINCT: true, FACTS_ONLY: true, PLATFORM: true, CLEAN_FRAME: true, COLOR_TRUE: true, SET_COMPLETE: true, SOUND_STRUCTURE: true, SCALE_TRUE: true
}

/** 旧持久化数据缺字段或含已废弃键时的归一化：锁定项永远为真 */
export function normalizeEbayImageRules(input?: Partial<Record<string, unknown>> | null): EbayImageRuleState {
  const source = input && typeof input === 'object' ? input : {}
  const next = { ...DEFAULT_EBAY_IMAGE_RULES }
  for (const rule of EBAY_IMAGE_RULES) {
    if (rule.locked) { next[rule.id] = true; continue }
    const value = (source as Record<string, unknown>)[rule.id]
    if (typeof value === 'boolean') next[rule.id] = value
  }
  return next
}

export type EbayImageModelPresence = 'NONE' | 'HANDS' | 'HUMAN' | 'HUMAN_PET'

export interface EbayImageModelPresenceOption {
  id: EbayImageModelPresence
  label: string
  detail: string
}

/** 模特选项：默认不出现人物/动物（主图与细节图任何情况下都不出现） */
export const EBAY_IMAGE_MODEL_PRESENCE_OPTIONS: EbayImageModelPresenceOption[] = [
  { id: 'NONE', label: '不出现人物/动物', detail: '只出商品本体与场景，最稳' },
  { id: 'HANDS', label: '仅出现手部', detail: '用于演示调节、安装等动作' },
  { id: 'HUMAN', label: '允许 1 位人物', detail: '痛点图与场景图使用，人物不抢商品' },
  { id: 'HUMAN_PET', label: '允许 1 位人物 + 1 只宠物', detail: '仅场景图，宠物作配角' }
]

export const DEFAULT_EBAY_IMAGE_MODEL_PRESENCE: EbayImageModelPresence = 'NONE'

export function normalizeEbayImageModelPresence(input: unknown): EbayImageModelPresence {
  return EBAY_IMAGE_MODEL_PRESENCE_OPTIONS.some(option => option.id === input) ? input as EbayImageModelPresence : DEFAULT_EBAY_IMAGE_MODEL_PRESENCE
}

const PRESENCE_PROMPTS: Record<EbayImageModelPresence, string> = {
  NONE: 'No people, body parts or animals anywhere in the frame: show the product installed or standing on its own.',
  HANDS: 'At most one human hand may appear demonstrating the product. No faces, no full bodies, no animals.',
  HUMAN: 'Exactly one person may appear using the product, correctly clothed and anatomically correct, clearly secondary to the product. No animals.',
  HUMAN_PET: 'At most one person and one pet may appear in the scene, both anatomically correct and clearly secondary to the product.'
}

/** 主图任何选择下都不放人物/动物：eBay 主图只允许商品本体 */
export function modelPresencePrompt(presence: EbayImageModelPresence, category: EbayImageCategory): string {
  return category === 'HERO' ? PRESENCE_PROMPTS.NONE : PRESENCE_PROMPTS[normalizeEbayImageModelPresence(presence)]
}

/** 勾选规则 → 英文提示词行；平台行与模特行分别由 mode / presence 决定，此处不重复输出 */
export function buildRulePromptLines(state: EbayImageRuleState, presence: EbayImageModelPresence, mode: EbayImageOutputMode, category: EbayImageCategory, siblingCount: number): string[] {
  const rules = normalizeEbayImageRules(state)
  const lines: string[] = []
  if (rules.FIDELITY) lines.push('Product fidelity is absolute: reproduce the sellable product exactly as in the reference images — same silhouette, panel lines, stitching, cutouts, hardware, accessories, colour, material texture, part count and proportions. Never restyle, simplify, add or remove any component.')
  if (rules.DISTINCT && siblingCount > 1) lines.push(`This image must be clearly different from the other ${siblingCount - 1} image(s) of the same category: use a different camera angle, distance, crop and composition.`)
  if (rules.FACTS_ONLY) lines.push('Use only the marketing facts stated above for pain points, scenarios and claims. Do not invent features, specifications, materials, certifications or numbers that are not stated.')
  if (rules.CLEAN_FRAME) lines.push('No watermark, no border or frame, no promotional badge, no price or star graphics, no logos, no added text of any kind.')
  if (rules.COLOR_TRUE) lines.push('Keep colours true to the product: no colour grading, no tinting, no beautification that changes how the product itself looks.')
  if (rules.SET_COMPLETE) lines.push('Show the complete set of pieces together as supplied, never a subset.')
  if (rules.SOUND_STRUCTURE) lines.push('Anatomically and mechanically correct: no extra or missing limbs or parts, no warped structure, no garbled letters on any surface, correct perspective and shadows.')
  if (rules.SCALE_TRUE) lines.push('Keep the product at its real-world scale relative to its surroundings; do not exaggerate size and do not use props that imply a wrong size.')
  lines.push(modelPresencePrompt(presence, category))
  if (mode === 'TEXT_COMBO' && rules.FACTS_ONLY) lines.push('Any overlay text must repeat only the stated facts, in correct English spelling, and never cover the product.')
  return lines
}

const PLATFORM_LABELS: Record<EbayImageOutputMode, string> = { PURE: 'eBay 纯图无文字', TEXT_COMBO: '亚马逊可加卖点文字' }

/** ④ 区「本次生效规则」中文摘要，生成前一眼能看到规则是否被改动 */
export function describeActiveEbayImageRules(state: EbayImageRuleState, presence: EbayImageModelPresence, mode: EbayImageOutputMode): string {
  const rules = normalizeEbayImageRules(state)
  const labels = EBAY_IMAGE_RULES.filter(rule => rules[rule.id]).map(rule => rule.label)
  const presenceLabel = EBAY_IMAGE_MODEL_PRESENCE_OPTIONS.find(option => option.id === normalizeEbayImageModelPresence(presence))?.label || ''
  return `本次生效：${labels.join(' · ')} · 模特：${presenceLabel} · 平台：${PLATFORM_LABELS[mode]}`
}
