import { extractPolicyIdFromLabel } from './ebayListingForm'
import type { EbayBusinessPolicyKind, EbayScrapedPolicyOption } from './contracts'

/**
 * R2：Seller Hub 新版修改页（ebay.com/lstng）的政策控件是 input[role=combobox]，控件 value 里只有
 * 「政策名称 + 在架数」（`eBay immediate payment [3409 listings]`），政策编号只存在于页面内嵌的
 * Helix 模型里，而退货政策在那一页连控件都没渲染。所以抓取改读模型，页内脚本只负责把
 * "paymentPolicy"/"shippingPolicy"/"returnPolicy" 三个锚点的对象原文切出来，映射与判据全留在这里，
 * 这样这一段可以离线跑现网 fixtures（回归锁在 src/shared/__tests__/ebayPolicyModel.test.ts）。
 * 锚点固定这三个类别：模型的 handlingTime 是 handlingDuration，可选值是 0–12 的天数而不是政策编号，
 * 混进来只会在政策库里造出编号对不上的假资产。
 */
export type EbayPolicyModelField = 'paymentPolicy' | 'shippingPolicy' | 'returnPolicy'

export const EBAY_POLICY_MODEL_FIELDS: EbayPolicyModelField[] = ['paymentPolicy', 'shippingPolicy', 'returnPolicy']

const EBAY_POLICY_MODEL_KINDS: Record<EbayPolicyModelField, EbayBusinessPolicyKind> = {
  paymentPolicy: 'PAYMENT',
  shippingPolicy: 'SHIPPING',
  returnPolicy: 'RETURN'
}

interface EbayPolicyModelOption {
  value?: unknown
  label?: unknown
  listingCount?: unknown
}

/** 模型里的文案统一是 {_type:'TextualDisplay',textSpans:[{text}]}；缺结构就当没有这段文字。 */
function spansText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const spans = (value as { textSpans?: unknown }).textSpans
  if (!Array.isArray(spans)) return ''
  return spans.map(span => {
    const text = (span as { text?: unknown })?.text
    return typeof text === 'string' ? text : ''
  }).join('')
}

/** 在架数量词现网有两种写法：`[3409 listings]` 与 `(1515 listings)`，还有单数 `1 listing`。 */
function listingCountOf(text: string): number | undefined {
  const normalised = text.replace(/[[\]()]/g, '').replace(/\s+/g, ' ').trim()
  const count = normalised.match(/^(\d[\d,]*)\s*(?:listings?|件)$/i)?.[1]
  return count === undefined ? undefined : Number(count.replace(/,/g, ''))
}

/**
 * 缺陷 (a)：现网政策控件是 input[role=combobox]，框里存的是「名称 + 在架数」，政策编号只在这些模型选项里。
 * 要选中一项政策就得先把 编号 → 选项显示文本 换出来，所以这里的 text 必须是 DOM 里真会出现的那一整串：
 * 名称原文（不剥尾部编号，剥了就跟 option 文本对不上）+ 空格 + 在架数原文。
 * 控件名同样取模型自己的 name（退货在模型里叫 returnsPolicyId），eBay 改名时代码不用动。
 * 选项值不是纯数字编号的直接不产出——那是 handlingDuration 这类「6 business days」的天数选项，
 * 混进来只会在页面上点出一个谁都不认识的选择。
 */
export interface EbayPolicyChoice {
  id: string
  text: string
}

export interface EbayPolicyModelChoices {
  controlName: string
  options: EbayPolicyChoice[]
}

export function parseEbayPolicyModelChoices(raw: string): EbayPolicyModelChoices {
  let model: { name?: unknown; options?: unknown }
  try {
    model = JSON.parse(String(raw || '')) as { name?: unknown; options?: unknown }
  } catch {
    return { controlName: '', options: [] }
  }
  if (!model || typeof model !== 'object' || !Array.isArray(model.options)) return { controlName: '', options: [] }
  const options: EbayPolicyChoice[] = []
  for (const option of model.options as EbayPolicyModelOption[]) {
    if (!option || typeof option !== 'object') continue
    const id = String(option.value ?? '').trim()
    const name = spansText(option.label).replace(/\s+/g, ' ').trim()
    if (!/^\d{6,}$/.test(id) || !name) continue
    const listingCount = spansText(option.listingCount).replace(/\s+/g, ' ').trim()
    options.push({ id, text: listingCount ? `${name} ${listingCount}` : name })
  }
  return { controlName: typeof model.name === 'string' ? model.name.trim() : '', options }
}

export function parseEbayPolicyModel(field: EbayPolicyModelField, raw: string): EbayScrapedPolicyOption[] {
  let model: { value?: unknown; options?: unknown }
  try {
    model = JSON.parse(String(raw || '')) as { value?: unknown; options?: unknown }
  } catch {
    return []
  }
  if (!model || typeof model !== 'object' || !Array.isArray(model.options)) return []
  const kind = EBAY_POLICY_MODEL_KINDS[field]
  const selectedId = model.value === undefined || model.value === null ? '' : String(model.value)
  const rows: EbayScrapedPolicyOption[] = []
  for (const option of model.options as EbayPolicyModelOption[]) {
    if (!option || typeof option !== 'object') continue
    const name = spansText(option.label).replace(/\s+/g, ' ').trim()
    if (!name) continue
    const optionId = String(option.value ?? '').trim()
    const policyId = /^\d{6,}$/.test(optionId) ? optionId : undefined
    const listingCount = listingCountOf(spansText(option.listingCount))
    rows.push({
      kind,
      label: extractPolicyIdFromLabel(name).label || name,
      ...(policyId ? { policyId } : {}),
      ...(listingCount === undefined ? {} : { listingCount }),
      selected: Boolean(policyId) && optionId === selectedId
    })
  }
  return rows
}
