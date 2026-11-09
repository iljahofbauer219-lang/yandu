import { describe, expect, it } from 'vitest'
import {
  parseEbayItemSpecifics, parseEbayItemSpecificsCard,
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
