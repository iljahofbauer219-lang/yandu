import type { EbayItemSpecificSlot } from './ebayItemSpecificsModel'

/**
 * 「类目属性填写」的裁决层（H3，R2 口径：页内脚本只回 DOM 原文，匹配与校验全在这里离线可复算）。
 * 输入是本地产品自己的真实内容（itemSpecifics / 标题 / 描述），输出是能进槽位的值与逐条跳过原因：
 *   · 人工值（source=MANUAL）绝不覆盖——五硬要求之一；
 *   · 空值不收；Yes/No 槽位只收是/否语义并归一成现网原文 Yes/No；
 *   · 带候选值的槽位限现网 options 白名单（大小写归一到现网原文），静态没候选值的菜单行不拦真值；
 *   · 带长度上限的槽位（如 California Prop 65 Warning 0/800）超长不收。
 * 来源只有两种：ENUM_MATCH＝本地值匹配进槽位；AI＝LLM 复核后经同一套校验收下。编造的值进不来。
 */

export interface EbaySpecificsFillFact {
  name: string
  value: string
  source?: string
}

export interface EbaySpecificsFillInput {
  title: string
  descriptionText: string
  local: EbaySpecificsFillFact[]
}

export interface EbaySpecificsFillRow {
  name: string
  value: string
  source: 'ENUM_MATCH' | 'AI'
}

export interface EbaySpecificsFillPlan {
  fills: EbaySpecificsFillRow[]
  skipped: Array<{ name: string; reason: string }>
}

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()

const YES_WORDS = ['yes', 'y', '是', '真', 'true']
const NO_WORDS = ['no', 'n', '否', '假', 'false']

function normalizeYesNo(rawValue: string): string {
  const value = rawValue.trim().toLowerCase()
  if (YES_WORDS.includes(value)) return 'Yes'
  if (NO_WORDS.includes(value)) return 'No'
  return rawValue.trim()
}

/** 菜单捕获候选：大小写不敏感命中后取现网拼写；多选值逐段归一再用逗号拼回。 */
function normalizeMenuValue(slot: EbayItemSpecificSlot, value: string): string {
  const captured = [...(slot.menuOptions || []), ...slot.options.map(option => option.text)]
  const pick = (part: string) => captured.find(option => sameName(option, part)) || part
  if (slot.control === 'MENU_MULTI') return value.split(',').map(part => pick(part.trim())).filter(Boolean).join(', ')
  return pick(value)
}

/** 把值归一到现网原文：Yes/No 归一；候选值按大小写不敏感命中后取现网拼写。 */
export function normalizeSpecificValue(slot: EbayItemSpecificSlot, rawValue: string): string {
  const value = rawValue.trim()
  if (slot.control === 'YESNO') return normalizeYesNo(value)
  if (slot.control === 'MENU' || slot.control === 'MENU_MULTI') return normalizeMenuValue(slot, value)
  const hit = slot.options.find(option => sameName(option.text, value))
  return hit ? hit.text : value
}

/** 值能不能进这个槽位：返回 '' 表示可收，否则是可直接上屏的中文原因。 */
export function specificValueIssue(slot: EbayItemSpecificSlot, rawValue: string): string {
  const value = rawValue.trim()
  if (!value) return '值为空'
  // Yes/No 与候选值白名单都要拿归一后的值比：本地记的「是/否」、大小写差异都算同一个值
  const normalized = normalizeSpecificValue(slot, value)
  if (slot.control === 'YESNO' && !['Yes', 'No'].includes(normalized)) return 'Yes/No 槽位只收 Yes 或 No'
  if (slot.control === 'MENU' || slot.control === 'MENU_MULTI') {
    // 白名单只在「捕获数==总数」时闭合；虚拟化大列表只读到一页，预拒会把真值挡在门外，交给写页按名检索复核
    const captured = slot.menuOptions || []
    if (captured.length && slot.menuOptionsComplete) {
      const parts = slot.control === 'MENU_MULTI' ? value.split(',').map(part => part.trim()).filter(Boolean) : [value]
      const bad = parts.find(part => !captured.some(option => sameName(option, part)))
      if (bad) return '不在现网候选值白名单内'
    }
    // 捕获不完整或没捕获时不预拒：继续走下面的 pill 白名单/长度判据，真值交给写页按名检索复核
  }
  if (slot.maxLength > 0 && value.length > slot.maxLength) return `超过长度上限 ${slot.maxLength}`
  if (slot.options.length && !slot.options.some(option => sameName(option.text, normalized))) return '不在现网候选值白名单内'
  return ''
}

/** 规则档：本地同名值匹配进槽位。人工值不覆盖、不收的值逐条点名原因。 */
export function planEbaySpecificsFill(slots: EbayItemSpecificSlot[], input: EbaySpecificsFillInput, existing: EbaySpecificsFillFact[] = []): EbaySpecificsFillPlan {
  const fills: EbaySpecificsFillRow[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  for (const slot of slots) {
    const manual = existing.find(item => sameName(item.name, slot.name) && item.source === 'MANUAL')
    if (manual) {
      skipped.push({ name: slot.name, reason: '已有人工值，不覆盖' })
      continue
    }
    const fact = input.local.find(item => sameName(item.name, slot.name))
    if (!fact || !fact.value.trim()) {
      skipped.push({ name: slot.name, reason: fact ? '值为空' : '本地没有该属性的记录' })
      continue
    }
    const issue = specificValueIssue(slot, fact.value)
    if (issue) {
      skipped.push({ name: slot.name, reason: issue })
      continue
    }
    fills.push({ name: slot.name, value: normalizeSpecificValue(slot, fact.value), source: 'ENUM_MATCH' })
  }
  return { fills, skipped }
}

/** LLM 档：模型答案过同一套校验才收（白名单/Yes-No/长度/空值），槽位不存在或同名重复一律丢弃。 */
export function applyLlmSpecificAnswers(slots: EbayItemSpecificSlot[], answers: Array<{ name: string; value: string }>): EbaySpecificsFillRow[] {
  const kept: EbaySpecificsFillRow[] = []
  const seen = new Set<string>()
  for (const answer of answers) {
    const slot = slots.find(item => sameName(item.name, answer.name))
    if (!slot || seen.has(slot.name)) continue
    if (specificValueIssue(slot, answer.value)) continue
    seen.add(slot.name)
    kept.push({ name: slot.name, value: normalizeSpecificValue(slot, answer.value), source: 'AI' })
  }
  return kept
}
