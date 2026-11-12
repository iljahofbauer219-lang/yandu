import { describe, expect, it } from 'vitest'
import {
  parseEbayItemSpecifics, parseEbayItemSpecificsCard, parseEbayItemSpecificsSection,
  type EbayItemSpecificsCardRaw, type EbayItemSpecificsRaw, type EbayItemSpecificsRawRow
} from '../ebayItemSpecificsModel'

/**
 * 2026-11-09 从 ebay.com/lstng?draftId=5306791224420&mode=ReviseItem 的 ITEM SPECIFICS 段
 * 逐行抄下来的原文（见 ~/.yandu-acceptance/2026-11-09-R5/R5-rows.json 与 R5-section.json），未加工：
 * 分组只有两个 h3（Essential y=1507 / Optional y=2006），必填只有 Brand（标签列带 * 且类名含 required-field），
 * 下拉是 button.fake-menu-button（候选值点开才远程检索，静态 DOM 里没有选项，只有面板搜索框的占位原文），
 * Suggested 与 0/800 计数都只是值列里的可见文字，分组另有 id 原文里的 [..[OPTIONAL]] 记号。
 * 口径与 R2 政策模型一致：页内脚本只回原文，分组/控件类型/必填/建议值/计数的判据全留在这里。
 */
const row = (patch: Partial<EbayItemSpecificsRawRow>): EbayItemSpecificsRawRow => ({
  name: '', id: '', tag: 'BUTTON',
  controlClass: 'se-expand-button__button fake-menu-button__button btn btn--fluid btn--truncated btn--form',
  labelText: '', labelClass: 'summary__attributes--label', text: '', value: '',
  placeholder: '', panelPlaceholder: 'Search or enter your own', maxLength: '', valueText: '', y: 0, ...patch
})

const menu = (name: string, y: number, patch: Partial<EbayItemSpecificsRawRow> = {}) =>
  row({ name: `attributes.${name}`, labelText: name, y, ...patch })

const GROUPS = [{ text: 'Essential', y: 1507 }, { text: 'Optional', y: 2006 }]

const LIVE: EbayItemSpecificsRaw = {
  groups: GROUPS,
  rows: [
    menu('Brand', 1547, { text: 'Unbranded', labelClass: 'summary__attributes--label required-field', labelText: 'Brand *', valueText: 'Unbranded' }),
    menu('Type', 1603),
    row({
      name: 'attributes.Model', id: 's0-1-0-25-15-@ATTRIBUTES-1-34-4-2[2[ESSENTIAL]]-2-se-textbox', tag: 'INPUT',
      controlClass: 'textbox__control', labelText: 'Model', placeholder: 'Enter your own', panelPlaceholder: '',
      valueText: 'Suggested: Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0', y: 1659
    }),
    menu('Compressor Type', 1736),
    menu('Power Source', 1792),
    menu('Voltage', 1848, { valueText: 'Suggested12 V' }),
    menu('Power Phase', 1926),
    menu('Item Width', 2046),
    menu('MPN', 2158, { panelPlaceholder: 'Enter your own' }),
    menu('Manufacturer Warranty', 2214),
    menu('Energy Efficiency Ratio (EER)', 2605),
    menu('Year Manufactured', 2717, { panelPlaceholder: 'Search' }),
    row({
      name: 'attributes.California Prop 65 Warning',
      id: 's0-1-0-25-15-@ATTRIBUTES-1-34-4-27[13[OPTIONAL]]-4-se-textarea',
      tag: 'TEXTAREA', controlClass: 'textbox__control', labelText: 'California Prop 65 Warning',
      placeholder: 'Enter your own', panelPlaceholder: '', maxLength: '800', valueText: '0/800', y: 2773
    }),
    row({ name: 'attributes.Unit Quantity', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Unit Quantity', placeholder: 'Enter your own', y: 2853 }),
    row({ name: 'attributes.Durability Guarantee', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Durability Guarantee', placeholder: 'Enter the number of years (3-99)', y: 3021 }),
    // UPC 在现网不落 .summary__attributes--field 行容器里，id 原文自带 [20[OPTIONAL]] 记号
    row({
      name: 'attributes.UPC', id: 's0-1-0-25-15-@ATTRIBUTES-1-34-4-11[20[OPTIONAL]]-@field-se-textbox',
      tag: 'INPUT', controlClass: 'textbox__control', labelText: 'UPC', value: 'Does not apply',
      placeholder: 'Enter your own', panelPlaceholder: '', valueText: '', y: 3201
    }),
    // 同一个 Brand 的下拉面板里还藏着一个 search-box-attributesBrand，页内脚本会一并抓到
    row({ name: 'search-box-attributesBrand', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Brand', placeholder: 'Search or enter your own', panelPlaceholder: '', y: 1547 }),
    // 段外噪声：标题与描述控件的 name 不带 attributes 前缀，绝不能进清单
    row({ name: 'title', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Item title', placeholder: '', panelPlaceholder: '', y: 900 }),
    row({ name: 'description', tag: 'TEXTAREA', controlClass: 'se-rte__control', labelText: 'Description', placeholder: '', panelPlaceholder: '', y: 3400 })
  ]
}

describe('parseEbayItemSpecifics · 现网 ITEM SPECIFICS 原文', () => {
  it('分组优先认 id 原文的记号：没记号的行按 Optional 标题的 y 分界', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Brand')?.group).toBe('ESSENTIAL')
    expect(slots.find(item => item.name === 'Power Phase')?.group).toBe('ESSENTIAL')
    expect(slots.find(item => item.name === 'Model')?.group).toBe('ESSENTIAL')
    expect(slots.find(item => item.name === 'Item Width')?.group).toBe('OPTIONAL')
    expect(slots.find(item => item.name === 'UPC')?.group).toBe('OPTIONAL')
  })

  it('id 记号压过 y：现网把某一行挪到 Optional 区块里也不误报 Essential', () => {
    const slots = parseEbayItemSpecifics({
      groups: GROUPS,
      rows: [
        row({ name: 'attributes.Tonnage', id: 'x[7[OPTIONAL]]-se-menu-button', labelText: 'Tonnage', y: 1547 }),
        row({ name: 'attributes.Voltage', id: 'x[3[ESSENTIAL]]-se-menu-button', labelText: 'Voltage', y: 2900 })
      ]
    })
    expect(slots.map(item => item.group)).toEqual(['OPTIONAL', 'ESSENTIAL'])
  })

  it('控件形状按原文分类：菜单按钮=MENU、输入框=TEXT、textarea=TEXTAREA', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Brand')?.control).toBe('MENU')
    expect(slots.find(item => item.name === 'Model')?.control).toBe('TEXT')
    expect(slots.find(item => item.name === 'California Prop 65 Warning')?.control).toBe('TEXTAREA')
  })

  it('菜单判据取控件 class 原文：带菜单按钮类的 input 也算 MENU，原生 select 同样算 MENU', () => {
    const slots = parseEbayItemSpecifics({
      groups: GROUPS,
      rows: [
        row({ name: 'attributes.Country/Region of Manufacture', tag: 'INPUT', controlClass: 'combobox__control se-expand-button__button fake-menu-button__button', labelText: 'Country/Region of Manufacture', placeholder: '', y: 1600 }),
        row({ name: 'attributes.Certification', tag: 'SELECT', controlClass: 'menu__control', labelText: 'Certification', placeholder: '', y: 1660 }),
        row({ name: 'attributes.Model', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Model', placeholder: '', y: 1720 })
      ]
    })
    expect(slots.map(item => item.control)).toEqual(['MENU', 'MENU', 'TEXT'])
  })

  it('下拉行取面板搜索框原文当占位，输入行取自身占位', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Brand')?.placeholder).toBe('Search or enter your own')
    expect(slots.find(item => item.name === 'MPN')?.placeholder).toBe('Enter your own')
    expect(slots.find(item => item.name === 'Year Manufactured')?.placeholder).toBe('Search')
    expect(slots.find(item => item.name === 'Durability Guarantee')?.placeholder).toBe('Enter the number of years (3-99)')
  })

  it('必填只在标签带星号或 required-field 类时成立，现网只有 Brand 一条', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.filter(item => item.required).map(item => item.name)).toEqual(['Brand'])
    expect(slots.find(item => item.name === 'Type')?.required).toBe(false)
  })

  it('建议值与计数都从值列可见原文里解出：Suggested 前缀剥掉，计数原样带出，maxLength 转数字', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Model')?.suggested).toBe('Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0')
    expect(slots.find(item => item.name === 'Voltage')?.suggested).toBe('12 V')
    expect(slots.find(item => item.name === 'Brand')?.suggested).toBe('')
    const warning = slots.find(item => item.name === 'California Prop 65 Warning')
    expect(warning?.counter).toBe('0/800')
    expect(warning?.maxLength).toBe(800)
    expect(slots.find(item => item.name === 'UPC')?.counter).toBe('')
    expect(slots.find(item => item.name === 'UPC')?.maxLength).toBe(0)
  })

  it('当前值取控件可见原文：菜单按钮读选中项，输入框读 value', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Brand')?.value).toBe('Unbranded')
    expect(slots.find(item => item.name === 'UPC')?.value).toBe('Does not apply')
    expect(slots.find(item => item.name === 'Type')?.value).toBe('')
  })

  it('同名重复行只留第一条，且标题/描述这类非属性行绝不进清单', () => {
    const names = parseEbayItemSpecifics(LIVE).map(item => item.name)
    expect(names.filter(name => name === 'Brand')).toHaveLength(1)
    expect(names).not.toContain('Item title')
    expect(names).not.toContain('Description')
    expect(names).not.toContain('search-box-attributesBrand')
  })

  it('属性名取自控件 name 原文：带空格与括号的照抄，只出现驼峰面板名的行还原成词', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.map(item => item.name)).toContain('Energy Efficiency Ratio (EER)')
    expect(slots.map(item => item.name)).toContain('California Prop 65 Warning')
    expect(slots.map(item => item.name)).toContain('Manufacturer Warranty')
  })

  it('清单顺序就是页面顺序：Brand 打头，UPC 收尾', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots[0].name).toBe('Brand')
    expect(slots[slots.length - 1].name).toBe('UPC')
    expect(slots).toHaveLength(16)
  })

  it('没有分组标题也没有 id 记号时全部记 OPTIONAL，绝不把行谎报成 Essential', () => {
    const slots = parseEbayItemSpecifics({ groups: [], rows: [menu('Brand', 1547)] })
    expect(slots.map(item => item.group)).toEqual(['OPTIONAL'])
  })

  it('空清单与缺字段都只回空数组，不抛错', () => {
    expect(parseEbayItemSpecifics({ groups: GROUPS, rows: [] })).toEqual([])
    expect(parseEbayItemSpecifics(undefined as unknown as EbayItemSpecificsRaw)).toEqual([])
    expect(parseEbayItemSpecifics({ groups: GROUPS, rows: [{} as EbayItemSpecificsRawRow] })).toEqual([])
  })
})

/**
 * 2026-11-09 现网 ITEM SPECIFICS 段顶部那张 eBay.ai 建议卡（截图 ~/.yandu-acceptance/2026-11-09-R6/C01-ebay-live-item-specifics.png）。
 * 卡片是条件渲染的：同一张草稿页重载后就不再出现（R6 探针 cardVisibleNodes:0）。
 * 2026-11-09 19:52 已从真页 DOM 取回原文逐字对账（draftId=5307768937121，attributeCard.text 五行、
 * options 两条 checked:false、buttons 一条 Apply all），这份 fixture 就是那次导出的原文，不是截图转写。
 * 口径与行清单一致：页内脚本只抄卡片整块可见原文、每个勾选项的标签原文与选中态、按钮原文，
 * 标题/说明的分界、「属性名: 建议值」的切分和 Apply all 的认法全留在这里。
 */
const CARD: EbayItemSpecificsCardRaw = {
  text: 'Suggested item specifics\nQuickly add item specifics using info from your photos and title, powered by eBay.ai—this helps buyers find your item faster.\nYear Manufactured: 2020\nNumber of Compressors: 1\nApply all',
  options: [
    { label: 'Year Manufactured: 2020', checked: false },
    { label: 'Number of Compressors: 1', checked: false }
  ],
  buttons: ['Apply all']
}

/**
 * 2026-11-12 中文原生状态现网 AddItem 草稿页（draftId=5318093449621）的建议卡原文形态：
 * 标题「建议物品详情」、说明句、全角冒号标签、按钮「全部应用」。只认英文标题/Apply all 会整卡漏读。
 */
const CARD_ZH: EbayItemSpecificsCardRaw = {
  text: '建议物品详情\n使用 eBay.ai 根据图片和标题中的信息快速添加物品详情，帮助买家更快地找到您的物品。\nColor： Red\nMaterial： Leather\n全部应用',
  options: [
    { label: 'Color： Red', checked: false },
    { label: 'Material： Leather', checked: false }
  ],
  buttons: ['全部应用']
}

describe('parseEbayItemSpecificsCard · 中文原生状态建议物品详情卡', () => {
  it('标题/说明/逐项建议/全部应用都按中文原文解出，全角冒号照切名与值', () => {
    const card = parseEbayItemSpecificsCard(CARD_ZH)
    expect(card?.title).toBe('建议物品详情')
    expect(card?.blurb).toBe('使用 eBay.ai 根据图片和标题中的信息快速添加物品详情，帮助买家更快地找到您的物品。')
    expect(card?.items).toEqual([
      { name: 'Color', value: 'Red', checked: false },
      { name: 'Material', value: 'Leather', checked: false }
    ])
    expect(card?.applyAll).toBe('全部应用')
  })

  it('中文卡没有勾选项时同样回 null，不凭标题拼假卡片', () => {
    expect(parseEbayItemSpecificsCard({ text: CARD_ZH.text, options: [], buttons: ['全部应用'] })).toBeNull()
  })
})

describe('parseEbayItemSpecificsCard · 现网 Suggested item specifics 卡片原文', () => {
  it('标题取第一行、说明取其余行，逐项建议按第一个冒号切名与值', () => {
    const card = parseEbayItemSpecificsCard(CARD)
    expect(card?.title).toBe('Suggested item specifics')
    expect(card?.blurb).toBe('Quickly add item specifics using info from your photos and title, powered by eBay.ai—this helps buyers find your item faster.')
    expect(card?.items).toEqual([
      { name: 'Year Manufactured', value: '2020', checked: false },
      { name: 'Number of Compressors', value: '1', checked: false }
    ])
  })

  it('Apply all 取按钮原文', () => {
    expect(parseEbayItemSpecificsCard(CARD)?.applyAll).toBe('Apply all')
  })

  it('勾选态照抄原文：勾上的项留 true，没勾的留 false', () => {
    const card = parseEbayItemSpecificsCard({
      ...CARD,
      options: [
        { label: 'Year Manufactured: 2020', checked: true },
        { label: 'Number of Compressors: 1', checked: false }
      ]
    })
    expect(card?.items.map(item => item.checked)).toEqual([true, false])
  })

  it('建议值里带冒号时只切第一个：95200-64JB1 这种带冒号的值不被截断', () => {
    const card = parseEbayItemSpecificsCard({ ...CARD, options: [{ label: 'Model: Suzuki: J20A', checked: false }], buttons: [] })
    expect(card?.items).toEqual([{ name: 'Model', value: 'Suzuki: J20A', checked: false }])
  })

  it('标签没有冒号时整条当属性名、建议值留空，不猜', () => {
    const card = parseEbayItemSpecificsCard({ ...CARD, options: [{ label: 'Brand', checked: false }], buttons: [] })
    expect(card?.items).toEqual([{ name: 'Brand', value: '', checked: false }])
  })

  it('按钮原文里没有 Apply all 时留空串，绝不伪造一个按钮', () => {
    expect(parseEbayItemSpecificsCard({ ...CARD, buttons: ['Show more'] })?.applyAll).toBe('')
  })

  it('卡片没渲染出来就回 null：原文缺失、整块空文、没有勾选项三种都算没卡片', () => {
    expect(parseEbayItemSpecificsCard(undefined as unknown as EbayItemSpecificsCardRaw)).toBeNull()
    expect(parseEbayItemSpecificsCard({ text: '', options: [], buttons: [] })).toBeNull()
    expect(parseEbayItemSpecificsCard({ text: CARD.text, options: [], buttons: ['Apply all'] })).toBeNull()
  })

  it('缺字段与脏原文都不抛错：options 非数组时按没有卡片处理', () => {
    expect(parseEbayItemSpecificsCard({ text: CARD.text } as unknown as EbayItemSpecificsCardRaw)).toBeNull()
    expect(parseEbayItemSpecificsCard({ text: 'Suggested item specifics', options: [{} as { label: string; checked: boolean }], buttons: [] })).toBeNull()
  })
})

describe('parseEbayItemSpecifics · 控件里该画什么原文（现网菜单按钮不画占位）', () => {
  it('菜单行的占位画线上原值：Brand 画 Unbranded，没原值的 Type 就什么都不画', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Brand')?.placeholderShown).toBe('Unbranded')
    expect(slots.find(item => item.name === 'Type')?.placeholderShown).toBe('')
  })

  it('输入行与 textarea 行画自身占位原文，eBay 的检索占位只在菜单行被换掉', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Model')?.placeholderShown).toBe('Enter your own')
    expect(slots.find(item => item.name === 'Durability Guarantee')?.placeholderShown).toBe('Enter the number of years (3-99)')
    expect(slots.find(item => item.name === 'California Prop 65 Warning')?.placeholderShown).toBe('Enter your own')
    expect(slots.find(item => item.name === 'UPC')?.placeholderShown).toBe('Enter your own')
  })

  it('placeholder 原文仍然照抄，面板检索占位不被画法判据覆盖', () => {
    const slots = parseEbayItemSpecifics(LIVE)
    expect(slots.find(item => item.name === 'Brand')?.placeholder).toBe('Search or enter your own')
    expect(slots.find(item => item.name === 'Year Manufactured')?.placeholder).toBe('Search')
  })
})

/**
 * 2026-11-09 22:1x 现网 AddItem 草稿页（draftId=5307809928220&mode=AddItem）ITEM SPECIFICS 段原文，
 * 经运行中应用内该页视图导出（展开态 19 行 + 点 Show less 后的折叠态 10 行，导出后已点回 Show less 复原）。
 * 与 ReviseItem 同容器 .summary__attributes，但形状多四样：Yes/No 双 pill、标签旁「~ x searches」/「Trending」
 * meta、textarea 的 0/800 计数、组标题带说明句；UPC 行控件 name 是 universalProductCode 而不是 attributes.*。
 */
const ADD_ITEM_ROW = (over: Record<string, unknown>) => ({
  id: '', labelClass: '', text: '', panelPlaceholder: '', hidden: false, pills: [], metaText: '',
  ...over
}) as unknown as EbayItemSpecificsRawRow
const MENU_CLS = 'se-expand-button__button fake-menu-button__button btn btn--fluid btn--truncated btn--form'
const ADD_ITEM: EbayItemSpecificsRaw & { toggles: Array<{ text: string }>; customAction: string; collapsed?: { rows: EbayItemSpecificsRawRow[]; toggles: Array<{ text: string }> } } = {
  groups: [
    { text: 'Required', y: 1417, blurb: 'Buyers need these details to find your item.' },
    { text: 'Additional (optional)', y: 1557, blurb: 'Buyers also search for these details.' }
  ] as Array<{ text: string; y: number; blurb?: string }>,
  rows: [
    ADD_ITEM_ROW({ name: 'attributes.Brand', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Brand', y: 1477 }),
    ADD_ITEM_ROW({ name: 'attributes.Placement on Vehicle', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Placement on Vehicle ~ 67.9K searches', metaText: '~ 67.9K searches', y: 1617 }),
    ADD_ITEM_ROW({ name: 'attributes.Color', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Color ~ 37.5K searches', metaText: '~ 37.5K searches', y: 1673 }),
    ADD_ITEM_ROW({ name: 'attributes.Features', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Features ~ 19.3K searches', metaText: '~ 19.3K searches', y: 1729 }),
    ADD_ITEM_ROW({ name: 'attributes.Seat Type', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Seat Type Trending', metaText: 'Trending', y: 1785 }),
    ADD_ITEM_ROW({ name: 'attributes.Headrest Type', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Headrest Type', y: 1841 }),
    ADD_ITEM_ROW({ name: 'attributes.Manufacturer Part Number', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Manufacturer Part Number', y: 1897 }),
    ADD_ITEM_ROW({ name: 'attributes.OE/OEM Part Number', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'OE/OEM Part Number', y: 1953 }),
    ADD_ITEM_ROW({ name: 'attributes.Material', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Material ~ 28K searches', metaText: '~ 28K searches', y: 2009 }),
    ADD_ITEM_ROW({ name: 'attributes.Items Included', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Items Included ~ 2.1K searches', metaText: '~ 2.1K searches', y: 2065 }),
    ADD_ITEM_ROW({ name: 'attributes.Country of Origin', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Country of Origin ~ 365 searches', metaText: '~ 365 searches', y: 2121 }),
    ADD_ITEM_ROW({ name: 'Vintage Part', tag: 'PILLS', controlClass: '', labelText: 'Vintage Part ~ 209 searches', metaText: '~ 209 searches', pills: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], valueText: 'Yes No', y: 2177 }),
    ADD_ITEM_ROW({ name: 'Universal Fitment', tag: 'PILLS', controlClass: '', labelText: 'Universal Fitment ~ 104 searches', metaText: '~ 104 searches', pills: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], valueText: 'Yes No', y: 2233 }),
    ADD_ITEM_ROW({ name: 'Performance Part', tag: 'PILLS', controlClass: '', labelText: 'Performance Part', pills: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], valueText: 'Yes No', y: 2289 }),
    ADD_ITEM_ROW({ name: 'attributes.Manufacturer Warranty', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Manufacturer Warranty', y: 2345 }),
    ADD_ITEM_ROW({ name: 'attributes.Interchange Part Number', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Interchange Part Number', y: 2401 }),
    ADD_ITEM_ROW({ name: 'attributes.Superseded Part Number', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Superseded Part Number', y: 2457 }),
    ADD_ITEM_ROW({ name: 'attributes.California Prop 65 Warning', tag: 'TEXTAREA', controlClass: 'textbox__control', labelText: 'California Prop 65 Warning', placeholder: 'Enter your own', maxLength: '800', valueText: '0/800', y: 2513 }),
    ADD_ITEM_ROW({ name: 'universalProductCode', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'UPC', placeholder: 'Enter number', maxLength: '20', y: 2591 })
  ],
  toggles: [{ text: 'Show less' }],
  customAction: 'Add custom item specific',
  collapsed: {
    rows: [
      ADD_ITEM_ROW({ name: 'attributes.Brand', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Brand', y: 1477 }),
      ADD_ITEM_ROW({ name: 'attributes.Placement on Vehicle', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Placement on Vehicle ~ 67.9K searches', metaText: '~ 67.9K searches', y: 1617 }),
      ADD_ITEM_ROW({ name: 'attributes.Color', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Color ~ 37.5K searches', metaText: '~ 37.5K searches', y: 1673 }),
      ADD_ITEM_ROW({ name: 'attributes.Features', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Features ~ 19.3K searches', metaText: '~ 19.3K searches', y: 1729 }),
      ADD_ITEM_ROW({ name: 'attributes.Seat Type', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Seat Type Trending', metaText: 'Trending', y: 1785 }),
      ADD_ITEM_ROW({ name: 'attributes.Headrest Type', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Headrest Type', y: 1841 }),
      ADD_ITEM_ROW({ name: 'attributes.Manufacturer Part Number', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Manufacturer Part Number', y: 1897 }),
      ADD_ITEM_ROW({ name: 'attributes.OE/OEM Part Number', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'OE/OEM Part Number', y: 1953 }),
      ADD_ITEM_ROW({ name: 'attributes.Material', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Material ~ 28K searches', metaText: '~ 28K searches', y: 2009 }),
      ADD_ITEM_ROW({ name: 'attributes.Items Included', tag: 'BUTTON', controlClass: MENU_CLS, labelText: 'Items Included ~ 2.1K searches', metaText: '~ 2.1K searches', y: 2065 })
    ],
    toggles: [{ text: 'Show more' }]
  }
}

describe('parseEbayItemSpecificsSection · AddItem 现网原文（图1-4 形状）', () => {
  it('19 行全读回：UPC 走 universalProductCode 认名，Yes/No 双 pill 认成 YESNO 控件', () => {
    const section = parseEbayItemSpecificsSection(ADD_ITEM)
    expect(section.slots).toHaveLength(19)
    const upc = section.slots.find(item => item.name === 'UPC')
    expect(upc).toMatchObject({ control: 'TEXT', placeholder: 'Enter number', maxLength: 20 })
    const pills = section.slots.find(item => item.name === 'Vintage Part')
    expect(pills?.control).toBe('YESNO')
    expect(pills?.options).toEqual([{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }])
    expect(pills?.value).toBe('')
  })

  it('pill 的选中态就是值：aria-pressed 落在 Yes 上值就是 Yes', () => {
    const pressed = { ...ADD_ITEM, rows: ADD_ITEM.rows.map(row => (row.name === 'Universal Fitment' ? { ...row, pills: [{ text: 'Yes', pressed: true }, { text: 'No', pressed: false }], valueText: 'Yes No' } : row)) }
    const section = parseEbayItemSpecificsSection(pressed)
    expect(section.slots.find(item => item.name === 'Universal Fitment')?.value).toBe('Yes')
  })

  it('标签旁 meta 原文照抄并分类：搜索量与 Trending 不混', () => {
    const section = parseEbayItemSpecificsSection(ADD_ITEM)
    expect(section.slots.find(item => item.name === 'Placement on Vehicle')).toMatchObject({ meta: '~ 67.9K searches', metaKind: 'SEARCH_COUNT' })
    expect(section.slots.find(item => item.name === 'Seat Type')).toMatchObject({ meta: 'Trending', metaKind: 'TRENDING' })
    expect(section.slots.find(item => item.name === 'Brand')?.metaKind).toBe('')
  })

  it('textarea 行照抄占位与 0/800 计数', () => {
    const section = parseEbayItemSpecificsSection(ADD_ITEM)
    expect(section.slots.find(item => item.name === 'California Prop 65 Warning')).toMatchObject({ control: 'TEXTAREA', placeholder: 'Enter your own', counter: '0/800', maxLength: 800 })
  })

  it('组标题带说明句照抄，行按 y 归组：Required 与 Additional (optional)', () => {
    const section = parseEbayItemSpecificsSection(ADD_ITEM)
    expect(section.groups).toEqual([
      { name: 'Required', blurb: 'Buyers need these details to find your item.' },
      { name: 'Additional (optional)', blurb: 'Buyers also search for these details.' }
    ])
    expect(section.slots.find(item => item.name === 'Brand')).toMatchObject({ groupLabel: 'Required', group: 'ESSENTIAL' })
    expect(section.slots.find(item => item.name === 'Color')).toMatchObject({ groupLabel: 'Additional (optional)', group: 'OPTIONAL' })
  })

  it('折叠开关与加属性按钮原文照抄，折叠态行名单独回传供镜像本地折叠', () => {
    const section = parseEbayItemSpecificsSection(ADD_ITEM)
    expect(section.toggleExpandedText).toBe('Show less')
    expect(section.toggleCollapsedText).toBe('Show more')
    expect(section.customActionText).toBe('Add custom item specific')
    expect(section.collapsedSlotNames).toEqual(['Brand', 'Placement on Vehicle', 'Color', 'Features', 'Seat Type', 'Headrest Type', 'Manufacturer Part Number', 'OE/OEM Part Number', 'Material', 'Items Included'])
  })

  it('ReviseItem 旧原文走同一入口不回归：菜单原值画法与分组照旧', () => {
    const section = parseEbayItemSpecificsSection(LIVE)
    expect(section.slots.find(item => item.name === 'Brand')?.placeholderShown).toBe('Unbranded')
    expect(section.slots.find(item => item.name === 'Type')?.placeholderShown).toBe('')
    expect(section.toggleExpandedText).toBe('')
    expect(section.collapsedSlotNames).toEqual([])
  })
})

/**
 * I2：菜单槽位的下拉选项原文（2026-11-11 现网导出 ~/.yandu-acceptance/2026-11-11-I1/I1-menu-panels.json）。
 * 现网两形：Brand 面板是 .menu__items 单选列表且虚拟化（头部原文「Rendered 50 out of 10184 options in …」），
 * Placement on Vehicle 面板是 .filter-menu__items 复选列表（无原生 checkbox，多选靠类名判）。
 * 判据留在这里：捕获数==总数才算白名单闭合；复选形判 MENU_MULTI；非菜单行一律空。
 */
describe('ebayItemSpecificsModel · 菜单面板选项捕获', () => {
  const menuRow = (patch: Record<string, unknown> = {}) => ({
    name: 'attributes.Brand', id: '', tag: 'BUTTON', controlClass: 'se-expand-button__button fake-menu-button__button btn',
    labelText: 'Brand *', labelClass: 'summary__attributes--label required-field', text: '', value: '', placeholder: '',
    panelPlaceholder: 'Search or enter your own', maxLength: '', valueText: '', y: 1545, ...patch
  })
  const sectionOfRows = (rows: unknown[]) => parseEbayItemSpecificsSection({
    rows, groups: [], toggles: [], customAction: '', collapsed: undefined
  } as never)

  it('单选形面板：选项与总数照抄，捕获数等于总数即白名单闭合', () => {
    const slot = sectionOfRows([menuRow({ menuOptions: ['Unbranded', '1', '16:1'], menuOptionsTotal: 3, menuMulti: false })]).slots[0]
    expect(slot.control).toBe('MENU')
    expect(slot.menuOptions).toEqual(['Unbranded', '1', '16:1'])
    expect(slot.menuOptionsTotal).toBe(3)
    expect(slot.menuOptionsComplete).toBe(true)
    expect(slot.menuMulti).toBe(false)
  })

  it('虚拟化大列表只捕获一页：完整标记为假，白名单不闭合交给写页按名复核', () => {
    const slot = sectionOfRows([menuRow({ menuOptions: Array.from({ length: 50 }, (_, index) => `opt${index}`), menuOptionsTotal: 10184, menuMulti: false })]).slots[0]
    expect(slot.menuOptionsComplete).toBe(false)
    expect(slot.menuOptionsTotal).toBe(10184)
  })

  it('复选形面板判 MENU_MULTI；非菜单行四个新字段一律空值', () => {
    const multi = sectionOfRows([menuRow({ name: 'attributes.Placement on Vehicle', labelText: 'Placement on Vehicle', labelClass: 'summary__attributes--label', menuOptions: ['Driver Side', 'Front'], menuOptionsTotal: 8, menuMulti: true })]).slots[0]
    expect(multi.control).toBe('MENU_MULTI')
    expect(multi.menuMulti).toBe(true)
    const input = sectionOfRows([{ ...menuRow(), name: 'attributes.UPC', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'UPC', labelClass: 'summary__attributes--label', placeholder: 'Enter number' }]).slots[0]
    expect(input.menuOptions).toEqual([])
    expect(input.menuOptionsTotal).toBe(0)
    expect(input.menuOptionsComplete).toBe(false)
    expect(input.menuMulti).toBe(false)
  })
})
