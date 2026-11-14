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
  /** 数量：默认2；''=不改动；固定填写写入现网数量框 */
  quantity: string
  /** 允许议价；null=不改动 */
  bestOfferEnabled: boolean | null
  /** 添加批量购买价格；null=不改动。开→开关打开并按预设三档写折扣；关→关闭 */
  volumePricingEnabled: boolean | null
  /** 批量折扣三档（购买2/3/4件+）百分比，默认5/7/10，仅「开」时写入 */
  volumeTier2: string
  volumeTier3: string
  volumeTier4: string
  /** 商品文件（物品披露信息段内唯一开关）；null=不改动 */
  productDocumentsEnabled: boolean | null
  shippingPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  itemLocation: string
  postalCode: string
  /** 推广·常规：费用项，默认开（用户授权）；关闭则不写 */
  promotedRegularEnabled: boolean
  /** 推广·常规广告费率百分比，默认5，可调；空=不写费率 */
  promotedRegularRate: string
  /** 推广·优先：费用项，默认关 */
  promotedPriorityEnabled: boolean
  /** 慈善机构：费用项，默认关；开启也只记录意愿，不代选机构 */
  charityEnabled: boolean
}

export type EbayFixedFillRowKind = 'condition' | 'switch' | 'combobox' | 'preferences' | 'text'

export interface EbayFixedFillRow {
  key: string
  label: string
  kind: EbayFixedFillRowKind
  value: string | boolean
  fee: boolean
  tiers?: Record<string, string>
  rate?: string
}

export interface EbayFixedFillPlan {
  rows: EbayFixedFillRow[]
  skipped: Array<{ key: string; label: string; reason: string }>
}

export const FEE_PRESET_KEYS = ['promotedRegularEnabled', 'promotedPriorityEnabled', 'charityEnabled'] as const

export function defaultEbayFixedFillPreset(): EbayFixedFillPreset {
  return {
    condition: '',
    quantity: '2',
    bestOfferEnabled: null,
    volumePricingEnabled: null,
    volumeTier2: '5',
    volumeTier3: '7',
    volumeTier4: '10',
    productDocumentsEnabled: null,
    shippingPolicyId: '',
    paymentPolicyId: '',
    returnPolicyId: '',
    itemLocation: '',
    postalCode: '',
    promotedRegularEnabled: true,
    promotedRegularRate: '5',
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
    quantity: input.quantity === undefined || input.quantity === null ? '2' : asText(input.quantity),
    bestOfferEnabled: asTriState(input.bestOfferEnabled),
    volumePricingEnabled: asTriState(input.volumePricingEnabled),
    volumeTier2: asText(input.volumeTier2) || '5',
    volumeTier3: asText(input.volumeTier3) || '7',
    volumeTier4: asText(input.volumeTier4) || '10',
    productDocumentsEnabled: asTriState(input.productDocumentsEnabled),
    shippingPolicyId: asText(input.shippingPolicyId),
    paymentPolicyId: asText(input.paymentPolicyId),
    returnPolicyId: asText(input.returnPolicyId),
    itemLocation: asText(input.itemLocation),
    postalCode: asText(input.postalCode),
    promotedRegularEnabled: input.promotedRegularEnabled === undefined || input.promotedRegularEnabled === null ? true : asBool(input.promotedRegularEnabled),
    promotedRegularRate: asText(input.promotedRegularRate) || '5',
    promotedPriorityEnabled: asBool(input.promotedPriorityEnabled),
    charityEnabled: asBool(input.charityEnabled)
  }
}

const LABELS: Record<string, string> = {
  condition: '物品状况',
  quantity: '数量',
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
  if (preset.quantity.trim()) push('quantity', 'text', preset.quantity.trim())
  if (preset.bestOfferEnabled !== null) push('bestOfferEnabled', 'switch', preset.bestOfferEnabled)
  if (preset.volumePricingEnabled !== null) rows.push({ key: 'vpSelection', label: LABELS.vpSelection, kind: 'switch', value: preset.volumePricingEnabled, fee: false, tiers: { 2: preset.volumeTier2, 3: preset.volumeTier3, 4: preset.volumeTier4 } })
  if (preset.productDocumentsEnabled !== null) push('productDocumentsEnabled', 'switch', preset.productDocumentsEnabled)
  if (preset.shippingPolicyId) push('shippingPolicyId', 'combobox', preset.shippingPolicyId)
  if (preset.paymentPolicyId) push('paymentPolicyId', 'combobox', preset.paymentPolicyId)
  if (preset.returnPolicyId) push('returnPolicyId', 'preferences', preset.returnPolicyId)
  if (preset.itemLocation) push('itemLocation', 'preferences', preset.itemLocation)
  if (preset.postalCode) push('postalCode', 'preferences', preset.postalCode)
  for (const key of ['promotedRegularEnabled', 'promotedPriorityEnabled'] as const) {
    if (preset[key]) rows.push({ key, label: LABELS[key], kind: 'switch', value: true, fee: true, ...(key === 'promotedRegularEnabled' ? { rate: preset.promotedRegularRate } : {}) })
    else skipped.push({ key, label: LABELS[key], reason: '费用项预设未开启，不写入' })
  }
  if (preset.charityEnabled) {
    skipped.push({ key: 'charityEnabled', label: LABELS.charityEnabled, reason: '慈善机构需人工在页面编辑弹窗选择机构，APP 不代选；预设开启仅记录意愿' })
  } else {
    skipped.push({ key: 'charityEnabled', label: LABELS.charityEnabled, reason: '费用项预设未开启，不写入' })
  }
  return { rows, skipped }
}