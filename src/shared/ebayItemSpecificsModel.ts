/**
 * eBay 修改页 ITEM SPECIFICS 段的原文 → 本地可读的属性槽位。
 * 口径与 R2 政策模型一致：页内脚本只抄 DOM 原文（控件 name/id/class/标签列文本与类/占位/长度上限/值列可见文字/行 y），
 * 分组、控件类型、必填、建议值、计数这些判据全部留在这里，方便拿现网 fixtures 离线复验
 * （src/shared/__tests__/ebayItemSpecificsModel.test.ts）。
 */

export interface EbayItemSpecificsRawRow {
  /** 控件 name 原文，如 attributes.Brand / search-box-attributesType */
  name: string
  /** 控件 id 原文，现网在里面带 [..[ESSENTIAL]] / [..[OPTIONAL]] 分组记号 */
  id: string
  /** 控件标签名原文：BUTTON|INPUT|TEXTAREA|SELECT */
  tag: string
  /** 控件 class 原文，判菜单按钮用 */
  controlClass: string
  /** 标签列可见原文，必填时尾部带 * */
  labelText: string
  /** 标签列 class 原文，必填时含 required-field */
  labelClass: string
  /** 控件可见文本原文（菜单按钮的当前值） */
  text: string
  /** 输入控件的 value 原文 */
  value: string
  placeholder: string
  /** 菜单按钮面板里搜索框的占位原文 */
  panelPlaceholder: string
  maxLength: string
  /** 值列整块可见原文，Suggested 行与 0/800 计数都在这里 */
  valueText: string
  /** 行左上角文档纵坐标，读不到 id 记号时用来跟分组标题对齐 */
  y: number
}

export interface EbayItemSpecificsRaw {
  groups: Array<{ text: string; y: number }>
  rows: EbayItemSpecificsRawRow[]
}

export interface EbayItemSpecificSlot {
  name: string
  group: 'ESSENTIAL' | 'OPTIONAL'
  control: 'MENU' | 'TEXT' | 'TEXTAREA'
  required: boolean
  placeholder: string
  /** 现网原文里的长度上限；没有则 0 */
  maxLength: number
  value: string
  suggested: string
  counter: string
  y: number
}

const ATTRIBUTE_NAME = /^(?:search-box-)?attributes[._-]?(.+)$/i
const MENU_CLASS = /fake-menu-button__button|se-expand-button__button|combobox__control|menu__control/i
const NON_SLOT_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'])

const clean = (value?: string): string => (value || '').replace(/\s+/g, ' ').trim()

/** attributes.Manufacturer Warranty 现网就带空格；只给 search-box 那种驼峰面板名补空格。 */
const slotName = (rawName: string): string => {
  const matched = clean(rawName).match(ATTRIBUTE_NAME)
  if (!matched) return ''
  return clean(matched[1].replace(/([a-z])([A-Z])/g, '$1 $2'))
}

/** 现网把建议值写成「Suggested: xxx」，改版后连冒号都没有（Suggested12 V），所以冒号与空格都可省。 */
const SUGGESTED = /Suggested:?\s*(\S.*)/i
const COUNTER = /\d+\s*\/\s*\d+/

export function parseEbayItemSpecifics(raw?: EbayItemSpecificsRaw): EbayItemSpecificSlot[] {
  const rows = Array.isArray(raw?.rows) ? raw!.rows : []
  const groups = Array.isArray(raw?.groups) ? raw!.groups : []
  const optionalY = groups.find(group => /optional/i.test(clean(group.text)))?.y
  const seen = new Set<string>()
  const slots: EbayItemSpecificSlot[] = []
  for (const row of rows) {
    const name = slotName(row?.name || '')
    const tag = clean(row?.tag).toUpperCase()
    if (!name || !NON_SLOT_TAGS.has(tag)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const controlClass = clean(row.controlClass)
    const control = MENU_CLASS.test(controlClass) || tag === 'SELECT' ? 'MENU'
      : tag === 'TEXTAREA' ? 'TEXTAREA'
        : tag === 'BUTTON' ? 'MENU'
          : 'TEXT'
    const placeholder = control === 'MENU' ? clean(row.panelPlaceholder) || clean(row.placeholder) : clean(row.placeholder)
    const maxLength = Number(row.maxLength)
    const valueText = clean(row.valueText)
    const id = clean(row.id)
    const suggested = valueText.match(SUGGESTED)?.[1] || ''
    slots.push({
      name,
      // id 里的分组记号是现网自己标的，比 y 准；没记号才退回 Optional 标题的 y。
      // 两种都读不到时一律按 OPTIONAL 记，绝不把行谎报成 Essential。
      group: /\[ESSENTIAL\]/i.test(id) ? 'ESSENTIAL'
        : /\[OPTIONAL\]/i.test(id) ? 'OPTIONAL'
          : optionalY === undefined || row.y >= optionalY ? 'OPTIONAL' : 'ESSENTIAL',
      control,
      required: /\*/.test(clean(row.labelText)) || /required-field/i.test(clean(row.labelClass)),
      placeholder,
      maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 0,
      value: clean(row.text) || clean(row.value),
      suggested,
      counter: valueText.match(COUNTER)?.[0] || '',
      y: row.y
    })
  }
  return slots
}
