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
  /** 控件标签名原文：BUTTON|INPUT|TEXTAREA|SELECT|PILLS */
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
  /** AddItem 现网标签旁的 meta 按钮原文：「~ 67.9K searches」或「Trending」；ReviseItem 没有 */
  metaText?: string
  /** AddItem 现网 Yes/No 双 pill 的原文与 aria-pressed 选中态；别的控件没有 */
  pills?: Array<{ text: string; pressed: boolean }>
  /** 该行在读取当下是否可见；折叠态被现网摘掉的行不会进 rows，此位只作如实记录 */
  hidden?: boolean
}

export interface EbayItemSpecificsRaw {
  groups: Array<{ text: string; y: number; blurb?: string }>
  rows: EbayItemSpecificsRawRow[]
}

/**
 * AddItem 现网比 ReviseItem 多抄的三样原文：折叠开关按钮文字、加属性按钮文字、
 * 以及折叠态那一遍的行清单（读取时若页上是折叠的，先抄一遍再展开抄全量，两遍都只抄原文）。
 */
export interface EbayItemSpecificsSectionRaw extends EbayItemSpecificsRaw {
  toggles?: Array<{ text: string }>
  customAction?: string
  collapsed?: { rows: EbayItemSpecificsRawRow[]; toggles?: Array<{ text: string }> }
}

export interface EbayItemSpecificSlot {
  name: string
  group: 'ESSENTIAL' | 'OPTIONAL'
  /** 现网组标题原文（Required / Additional (optional) / Essential / Optional）；读不到则空串 */
  groupLabel: string
  control: 'MENU' | 'TEXT' | 'TEXTAREA' | 'YESNO'
  required: boolean
  placeholder: string
  /**
   * 控件里真正该画出来的原文。现网的菜单按钮不画 eBay 的检索占位，只画选中值（Brand 画 Unbranded，
   * Type 没选中就整块留白）；输入框与 textarea 才画自己的占位原文。判据留在这里，编辑器只照读。
   */
  placeholderShown: string
  /** 现网原文里的长度上限；没有则 0 */
  maxLength: number
  value: string
  suggested: string
  counter: string
  /** 标签旁 meta 按钮原文照抄；没有则空串 */
  meta: string
  /** meta 原文的类别判据：Trending 徽标与搜索量是两种画法 */
  metaKind: 'TRENDING' | 'SEARCH_COUNT' | ''
  /** Yes/No 双 pill 的原文与选中态；非 pill 控件为空数组 */
  options: Array<{ text: string; pressed: boolean }>
  y: number
}

/** 整段级原文：组标题带说明句、折叠开关两态文字、加属性按钮文字、折叠态行名清单。 */
export interface EbayItemSpecificsSection {
  slots: EbayItemSpecificSlot[]
  groups: Array<{ name: string; blurb: string }>
  toggleExpandedText: string
  toggleCollapsedText: string
  customActionText: string
  collapsedSlotNames: string[]
}

const ATTRIBUTE_NAME = /^(?:search-box-)?attributes[._-]?(.+)$/i
const MENU_CLASS = /fake-menu-button__button|se-expand-button__button|combobox__control|menu__control/i
const NON_SLOT_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'])
/** AddItem 现网 UPC 行的控件 name 不带 attributes 前缀，就认这一个全名。 */
const UPC_NAME = 'universalProductCode'
const TRENDING = /^trending$/i

const clean = (value?: string): string => (value || '').replace(/\s+/g, ' ').trim()

/** attributes.Manufacturer Warranty 现网就带空格；只给 search-box 那种驼峰面板名补空格。 */
const slotName = (rawName: string): string => {
  const matched = clean(rawName).match(ATTRIBUTE_NAME)
  if (!matched) return ''
  return clean(matched[1].replace(/([a-z])([A-Z])/g, '$1 $2'))
}

/** 行原文 → 槽位名：attributes 前缀优先，其次 UPC 全名，再次 pill 行的 ul[aria-label] 原名。 */
const rowName = (row: EbayItemSpecificsRawRow): string => {
  const prefixed = slotName(row?.name || '')
  if (prefixed) return prefixed
  const raw = clean(row?.name || '')
  if (raw.toLowerCase() === UPC_NAME.toLowerCase()) return 'UPC'
  if ((row?.pills ?? []).length) return raw
  return ''
}

/** 现网把建议值写成「Suggested: xxx」，改版后连冒号都没有（Suggested12 V），所以冒号与空格都可省。 */
const SUGGESTED = /Suggested:?\s*(\S.*)/i
const COUNTER = /\d+\s*\/\s*\d+/

export function parseEbayItemSpecificsSection(raw?: EbayItemSpecificsSectionRaw): EbayItemSpecificsSection {
  const rows = Array.isArray(raw?.rows) ? raw!.rows : []
  const groups = Array.isArray(raw?.groups) ? raw!.groups : []
  const headings = groups
    .map(group => ({ name: clean(group?.text), blurb: clean(group?.blurb), y: Number(group?.y) }))
    .filter(group => group.name)
    .sort((left, right) => left.y - right.y)
  const optionalY = headings.find(group => /optional/i.test(group.name))?.y
  const mapRow = (row: EbayItemSpecificsRawRow): EbayItemSpecificSlot | null => {
    const name = rowName(row)
    const pills = Array.isArray(row?.pills) ? row.pills : []
    const tag = clean(row?.tag).toUpperCase()
    if (!name || (!NON_SLOT_TAGS.has(tag) && !pills.length)) return null
    const controlClass = clean(row.controlClass)
    const control = pills.length ? 'YESNO'
      : MENU_CLASS.test(controlClass) || tag === 'SELECT' ? 'MENU'
        : tag === 'TEXTAREA' ? 'TEXTAREA'
          : tag === 'BUTTON' ? 'MENU'
            : 'TEXT'
    const placeholder = control === 'MENU' ? clean(row.panelPlaceholder) || clean(row.placeholder) : clean(row.placeholder)
    const maxLength = Number(row.maxLength)
    const valueText = clean(row.valueText)
    const id = clean(row.id)
    const suggested = valueText.match(SUGGESTED)?.[1] || ''
    const pressed = pills.find(pill => pill?.pressed)
    const value = control === 'YESNO' ? clean(pressed?.text) : clean(row.text) || clean(row.value)
    // 组归属：id 里的分组记号是现网自己标的，比 y 准；没记号才按行 y 落在哪个组标题下面认。
    const heading = headings.filter(item => item.y <= row.y).pop()
    const groupLabel = heading?.name || ''
    const meta = clean(row.metaText)
    return {
      name,
      group: /\[ESSENTIAL\]/i.test(id) ? 'ESSENTIAL'
        : /\[OPTIONAL\]/i.test(id) ? 'OPTIONAL'
          : /required|essential/i.test(groupLabel) ? 'ESSENTIAL'
            : heading ? 'OPTIONAL'
              : optionalY === undefined || row.y >= optionalY ? 'OPTIONAL' : 'ESSENTIAL',
      groupLabel,
      control,
      required: /\*/.test(clean(row.labelText)) || /required-field/i.test(clean(row.labelClass)) || /required/i.test(groupLabel),
      placeholder,
      placeholderShown: control === 'MENU' ? value : placeholder,
      maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 0,
      value,
      suggested,
      counter: valueText.match(COUNTER)?.[0] || '',
      meta,
      metaKind: TRENDING.test(meta) ? 'TRENDING' : meta ? 'SEARCH_COUNT' : '',
      options: pills.map(pill => ({ text: clean(pill?.text), pressed: Boolean(pill?.pressed) })),
      y: row.y
    }
  }
  const seen = new Set<string>()
  const slots: EbayItemSpecificSlot[] = []
  for (const row of rows) {
    const slot = mapRow(row)
    if (!slot) continue
    const key = slot.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    slots.push(slot)
  }
  const collapsed = raw?.collapsed
  const collapsedRows = Array.isArray(collapsed?.rows) ? collapsed!.rows : []
  const collapsedSlotNames = [...new Set(collapsedRows.map(rowName).filter(Boolean))]
  const expandedToggle = clean(raw?.toggles?.[0]?.text)
  const collapsedToggle = clean(collapsed?.toggles?.[0]?.text)
  return {
    slots,
    groups: headings.map(group => ({ name: group.name, blurb: group.blurb })),
    // 两遍都抄到时各归各态；只抄到一遍时，按现网开关文字认它当时是哪一态，另一态留空。
    toggleExpandedText: collapsedRows.length ? expandedToggle : /show less/i.test(expandedToggle) ? expandedToggle : '',
    toggleCollapsedText: collapsedRows.length ? collapsedToggle : /show more/i.test(expandedToggle) ? expandedToggle : '',
    customActionText: clean(raw?.customAction),
    collapsedSlotNames
  }
}

export function parseEbayItemSpecifics(raw?: EbayItemSpecificsRaw): EbayItemSpecificSlot[] {
  return parseEbayItemSpecificsSection(raw).slots
}

/**
 * ITEM SPECIFICS 段顶部那张 eBay.ai「Suggested item specifics」卡片的原文。
 * 页内脚本只抄三样：卡片整块可见文字、每个勾选项的标签原文与选中态、卡片内按钮原文；
 * 标题与说明的分界、「属性名: 建议值」的切分、Apply all 的认法都留在这里。
 */
export interface EbayItemSpecificsCardRaw {
  text: string
  options: Array<{ label: string; checked: boolean }>
  buttons: string[]
}

export interface EbaySuggestedSpecificItem {
  name: string
  value: string
  checked: boolean
}

export interface EbaySuggestedSpecificsCard {
  title: string
  blurb: string
  items: EbaySuggestedSpecificItem[]
  applyAll: string
}

const APPLY_ALL = /apply\s+all/i
/** 现网写成「Year Manufactured: 2020」；值里再出现的冒号不切第二次（Model: Suzuki: J20A 整段都算值）。 */
const SUGGESTION_LABEL = /^([^:]+):(.*)$/

export function parseEbayItemSpecificsCard(raw?: EbayItemSpecificsCardRaw): EbaySuggestedSpecificsCard | null {
  const options = Array.isArray(raw?.options) ? raw!.options : []
  const buttons = Array.isArray(raw?.buttons) ? raw!.buttons : []
  const items = options.flatMap(option => {
    const label = clean(option?.label)
    if (!label) return []
    const matched = label.match(SUGGESTION_LABEL)
    return [{
      name: clean(matched ? matched[1] : label),
      value: matched ? clean(matched[2]) : '',
      checked: Boolean(option?.checked)
    }]
  })
  // 卡片是 eBay.ai 现算的，同一张草稿页重载后就可能不再出现；读不到勾选项一律当它没渲染，
  // 绝不拿标题拼一张假卡片出来。
  if (!items.length) return null
  // 整块 innerText 里也含勾选项与按钮那几行，说明只能取剩下的散文行。
  const taken = new Set([...options.map(option => clean(option?.label)), ...buttons.map(clean)].filter(Boolean))
  const lines = (raw!.text || '').split('\n').map(clean).filter(Boolean)
  return {
    title: lines[0] || '',
    blurb: lines.slice(1).filter(line => !taken.has(line)).join(' '),
    items,
    applyAll: clean(buttons.find(button => APPLY_ALL.test(clean(button))))
  }
}
