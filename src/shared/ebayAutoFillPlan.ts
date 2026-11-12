/**
 * R2：「自动填写 / 固定填写」的裁决层（R2 口径：页内脚本只操作现网控件，收不收/写不写全在这里离线可复算）。
 * 固定填写预设按店铺持久化（渲染器 scopedStorage），这里只负责规范化与出计划：
 *   · 三态开关（null=不改动）区分「空预设什么都不写」与「显式关」；
 *   · 费用项（推广常规/优先、慈善）默认关，未开启一律不写，避免替用户产生费用义务；
 *   · 慈善机构即使开启也不代选机构（现网是编辑弹窗人工选），只如实点名；
 *   · 政策 combobox 只带政策编号，显示文本由主进程按本页政策模型映射（同 prepare 链路口径）。
 */

export interface EbayFixedFillPreset {
  /** 物品状况：''=不改动；现网 pills 只有 New/Used */
  condition: '' | 'New' | 'Used'
  /** 允许议价；null=不改动 */
  bestOfferEnabled: boolean | null
  /** 添加批量购买价格；null=不改动（折扣档位现网需人工设，开关只写开/关） */
  volumePricingEnabled: boolean | null
  /** 商品文件（物品披露信息段内唯一开关）；null=不改动 */
  productDocumentsEnabled: boolean | null
  shippingPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  itemLocation: string
  postalCode: string
  /** 推广·常规：费用项，默认关 */
  promotedRegularEnabled: boolean
  /** 推广·优先：费用项，默认关 */
  promotedPriorityEnabled: boolean
  /** 慈善机构：费用项，默认关；开启也只记录意愿，不代选机构 */
  charityEnabled: boolean
}

export type EbayFixedFillRowKind = 'condition' | 'switch' | 'combobox' | 'preferences'

export interface EbayFixedFillRow {
  key: string
  label: string
  kind: EbayFixedFillRowKind
  value: string | boolean
  fee: boolean
}

export interface EbayFixedFillPlan {
  rows: EbayFixedFillRow[]
  skipped: Array<{ key: string; label: string; reason: string }>
}

export const FEE_PRESET_KEYS = ['promotedRegularEnabled', 'promotedPriorityEnabled', 'charityEnabled'] as const

export function defaultEbayFixedFillPreset(): EbayFixedFillPreset {
  return {
    condition: '',
    bestOfferEnabled: null,
    volumePricingEnabled: null,
    productDocumentsEnabled: null,
    shippingPolicyId: '',
    paymentPolicyId: '',
    returnPolicyId: '',
    itemLocation: '',
    postalCode: '',
    promotedRegularEnabled: false,
    promotedPriorityEnabled: false,
    charityEnabled: false
  }
}

const asBool = (value: unknown): boolean => value === true || value === 'true'
const asTriState = (value: unknown): boolean | null => {
  if (value === null || value === undefined || value === '') return null
  if (value === true || value === 'true') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return null
}
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export function normalizeEbayFixedFillPreset(raw: unknown): EbayFixedFillPreset {
  const base = defaultEbayFixedFillPreset()
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Record<string, unknown>
  const condition = asText(input.condition)
  return {
    condition: condition === 'New' || condition === 'Used' ? condition : '',
    bestOfferEnabled: asTriState(input.bestOfferEnabled),
    volumePricingEnabled: asTriState(input.volumePricingEnabled),
    productDocumentsEnabled: asTriState(input.productDocumentsEnabled),
    shippingPolicyId: asText(input.shippingPolicyId),
    paymentPolicyId: asText(input.paymentPolicyId),
    returnPolicyId: asText(input.returnPolicyId),
    itemLocation: asText(input.itemLocation),
    postalCode: asText(input.postalCode),
    promotedRegularEnabled: asBool(input.promotedRegularEnabled),
    promotedPriorityEnabled: asBool(input.promotedPriorityEnabled),
    charityEnabled: asBool(input.charityEnabled)
  }
}

const LABELS: Record<string, string> = {
  condition: '物品状况',
  bestOfferEnabled: '允许议价',
  vpSelection: '添加批量购买价格',
  productDocumentsEnabled: '商品文件',
  shippingPolicyId: '运送政策',
  paymentPolicyId: '付款政策',
  returnPolicyId: '退货政策',
  itemLocation: '物品所在地',
  postalCode: '邮编',
  promotedRegularEnabled: '推广·常规',
  promotedPriorityEnabled: '推广·优先',
  charityEnabled: '慈善机构'
}

export function ebayFixedFillPlan(preset: EbayFixedFillPreset): EbayFixedFillPlan {
  const rows: EbayFixedFillRow[] = []
  const skipped: Array<{ key: string; label: string; reason: string }> = []
  const push = (key: string, kind: EbayFixedFillRowKind, value: string | boolean, fee = false) => {
    rows.push({ key, label: LABELS[key] || key, kind, value, fee })
  }
  if (preset.condition) push('condition', 'condition', preset.condition)
  if (preset.bestOfferEnabled !== null) push('bestOfferEnabled', 'switch', preset.bestOfferEnabled)
  if (preset.volumePricingEnabled !== null) push('vpSelection', 'switch', preset.volumePricingEnabled)
  if (preset.productDocumentsEnabled !== null) push('productDocumentsEnabled', 'switch', preset.productDocumentsEnabled)
  if (preset.shippingPolicyId) push('shippingPolicyId', 'combobox', preset.shippingPolicyId)
  if (preset.paymentPolicyId) push('paymentPolicyId', 'combobox', preset.paymentPolicyId)
  if (preset.returnPolicyId) push('returnPolicyId', 'preferences', preset.returnPolicyId)
  if (preset.itemLocation) push('itemLocation', 'preferences', preset.itemLocation)
  if (preset.postalCode) push('postalCode', 'preferences', preset.postalCode)
  for (const key of ['promotedRegularEnabled', 'promotedPriorityEnabled'] as const) {
    if (preset[key]) push(key, 'switch', true, true)
    else skipped.push({ key, label: LABELS[key], reason: '费用项预设未开启，不写入' })
  }
  if (preset.charityEnabled) {
    skipped.push({ key: 'charityEnabled', label: LABELS.charityEnabled, reason: '慈善机构需人工在页面编辑弹窗选择机构，APP 不代选；预设开启仅记录意愿' })
  } else {
    skipped.push({ key: 'charityEnabled', label: LABELS.charityEnabled, reason: '费用项预设未开启，不写入' })
  }
  return { rows, skipped }
}