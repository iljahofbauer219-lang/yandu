import { describe, expect, it } from 'vitest'
import {
  ebayMenuCaptureState, parseEbayItemSpecificsSection,
  type EbayItemSpecificsRawRow
} from '../ebayItemSpecificsModel'

/**
 * J 批：菜单候选捕获的失败态判据（R2 口径——页内只抄「按钮找到没/面板在不在/候选原文/面板占位原文」，
 * 是不是自行输入、失败归哪一类全留在这里）。
 * fixtures 照 2026-11-11 现网 AddItem（draftId=5313426786423 与 5314037626622）逐行抄回：
 * ~/.yandu-acceptance/2026-11-11-J1/J1-premounted-options.json（未点开面板就已挂好的候选与总数）、
 * J1-label-match-replay.json（labelText 被 clean 压平后粘上 meta 行的原文）、
 * J1-option-label-markup.json（候选 span 里还套一层 textual-display 别名 span）。
 */
const row = (patch: Partial<EbayItemSpecificsRawRow>): EbayItemSpecificsRawRow => ({
  name: '', id: '', tag: 'BUTTON',
  controlClass: 'se-expand-button__button fake-menu-button__button btn btn--fluid btn--truncated btn--form',
  labelText: '', labelClass: 'summary__attributes--label', text: '', value: '',
  placeholder: '', panelPlaceholder: 'Search or enter your own', maxLength: '', valueText: '', y: 0, ...patch
})

const sectionOfRows = (rows: EbayItemSpecificsRawRow[]) =>
  parseEbayItemSpecificsSection({ rows, groups: [], toggles: [], customAction: '', collapsed: undefined })

describe('ebayMenuCaptureState · 捕获失败态与自行输入判据', () => {
  it('读到候选就不算失败，也不当成自行输入', () => {
    expect(ebayMenuCaptureState({ menuButtonFound: true, menuPanelFound: true, menuOptions: ['Detachable', 'Integrated'], panelPlaceholder: 'Search or enter your own' }))
      .toEqual({ issue: '', freeText: false })
  })

  it('按钮没找到 → NO_BUTTON；面板不在 → NO_PANEL，两者不混', () => {
    expect(ebayMenuCaptureState({ menuButtonFound: false, menuPanelFound: false, menuOptions: [] }).issue).toBe('NO_BUTTON')
    expect(ebayMenuCaptureState({ menuButtonFound: true, menuPanelFound: false, menuOptions: [] }).issue).toBe('NO_PANEL')
  })

  it('面板在但一条候选都没有：占位是 Enter your own 才算自行输入，检索占位仍是捕获失败', () => {
    expect(ebayMenuCaptureState({ menuButtonFound: true, menuPanelFound: true, menuOptions: [], panelPlaceholder: 'Enter your own' }))
      .toEqual({ issue: 'NO_LIST', freeText: true })
    expect(ebayMenuCaptureState({ menuButtonFound: true, menuPanelFound: true, menuOptions: [], panelPlaceholder: 'Search or enter your own' }))
      .toEqual({ issue: 'NO_LIST', freeText: false })
  })

  it('两个事实都缺（旧缓存或非菜单行）一律不谎报失败', () => {
    expect(ebayMenuCaptureState({})).toEqual({ issue: '', freeText: false })
    expect(ebayMenuCaptureState({ menuOptions: [] })).toEqual({ issue: '', freeText: false })
  })
})

describe('ebayItemSpecificsModel · J 批捕获事实进槽位', () => {
  it('菜单行带出失败态与自行输入标记；输入行一律空标记', () => {
    const free = sectionOfRows([row({
      name: 'attributes.Manufacturer Part Number', labelText: 'Manufacturer Part Number',
      panelPlaceholder: 'Enter your own', menuButtonFound: true, menuPanelFound: true, menuOptions: [], menuOptionsTotal: 0
    })]).slots[0]
    expect(free.control).toBe('MENU')
    expect(free.menuCaptureIssue).toBe('NO_LIST')
    expect(free.menuFreeText).toBe(true)
    const broken = sectionOfRows([row({
      name: 'attributes.Color', labelText: 'Color ~ 37.5K searches',
      menuButtonFound: true, menuPanelFound: false, menuOptions: []
    })]).slots[0]
    expect(broken.menuCaptureIssue).toBe('NO_PANEL')
    expect(broken.menuFreeText).toBe(false)
    const input = sectionOfRows([row({
      name: 'attributes.UPC', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'UPC', placeholder: 'Enter number'
    })]).slots[0]
    expect(input.menuCaptureIssue).toBe('')
    expect(input.menuFreeText).toBe(false)
  })

  it('J1 回归：labelText 被压平粘上 meta 行的那 7 行，槽位名与候选照旧正确（捕获改按控件 name 绑行）', () => {
    const live = sectionOfRows([
      row({ name: 'attributes.Placement on Vehicle', labelText: 'Placement on Vehicle ~ 67.9K searches', menuButtonFound: true, menuPanelFound: true, menuMulti: true, menuOptions: ['Driver Side', 'Front', 'Left', 'Passenger Side', 'Rear', 'Right', 'Second Row', 'Third Row'], menuOptionsTotal: 8 }),
      row({ name: 'attributes.Color', labelText: 'Color ~ 37.5K searches', menuButtonFound: true, menuPanelFound: true, menuOptions: ['Beige', 'Black', 'Blue', 'Brown', 'Clear', 'Gold', 'Gray', 'Green', 'Multicolor', 'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'White', 'Yellow'], menuOptionsTotal: 16 }),
      row({ name: 'attributes.Seat Type', labelText: 'Seat Type Trending', menuButtonFound: true, menuPanelFound: true, menuOptions: ['Bucket Seat With Headrest', 'Bucket Seat Without Headrest', 'Full Set', 'Solid Bench With Headrest', 'Solid Bench Without Headrest', 'Split Bench With Headrest', 'Split Bench Without Headrest'], menuOptionsTotal: 7 }),
      row({ name: 'attributes.Headrest Type', labelText: 'Headrest Type', menuButtonFound: true, menuPanelFound: true, menuOptions: ['Detachable', 'Integrated'], menuOptionsTotal: 2 })
    ]).slots
    expect(live.map(slot => slot.name)).toEqual(['Placement on Vehicle', 'Color', 'Seat Type', 'Headrest Type'])
    expect(live[0].control).toBe('MENU_MULTI')
    expect(live[0].menuOptions).toHaveLength(8)
    expect(live[0].menuOptionsComplete).toBe(true)
    expect(live[0].menuCaptureIssue).toBe('')
    expect(live[1].menuOptions).toHaveLength(16)
    expect(live[1].menuOptionsComplete).toBe(true)
    expect(live[2].menuOptions).toHaveLength(7)
    expect(live[3].menuOptions).toEqual(['Detachable', 'Integrated'])
    expect(live.every(slot => slot.menuFreeText === false)).toBe(true)
  })

  it('虚拟化大列表仍只闭合到已渲染那一页：Brand 50/10184、Country of Origin 50/244 都不算白名单闭合', () => {
    const slots = sectionOfRows([
      row({ name: 'attributes.Brand', labelText: 'Brand *', labelClass: 'summary__attributes--label required-field', menuButtonFound: true, menuPanelFound: true, menuOptions: Array.from({ length: 50 }, (_, index) => `brand${index}`), menuOptionsTotal: 10184 }),
      row({ name: 'attributes.Country of Origin', labelText: 'Country of Origin ~ 365 searches', panelPlaceholder: 'Search', menuButtonFound: true, menuPanelFound: true, menuOptions: Array.from({ length: 50 }, (_, index) => `country${index}`), menuOptionsTotal: 244 })
    ]).slots
    expect(slots[0].menuOptionsComplete).toBe(false)
    expect(slots[0].required).toBe(true)
    expect(slots[1].menuOptionsTotal).toBe(244)
    expect(slots[1].menuOptionsComplete).toBe(false)
  })

  it('候选原文照抄：页内已剥掉别名 span 的 1-800-Radiator 不再被粘成 1-800-Radiator1 to 800', () => {
    const slot = sectionOfRows([row({
      name: 'attributes.Brand', labelText: 'Brand', menuButtonFound: true, menuPanelFound: true,
      menuOptions: ['Unbranded', '1-800-Radiator', '1st-racing'], menuOptionsTotal: 10184
    })]).slots[0]
    expect(slot.menuOptions).toEqual(['Unbranded', '1-800-Radiator', '1st-racing'])
  })
})