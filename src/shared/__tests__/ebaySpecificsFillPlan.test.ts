import { describe, expect, it } from 'vitest'
import {
  applyLlmSpecificAnswers, planEbaySpecificsFill, specificValueIssue,
  type EbaySpecificsFillFact
} from '../ebaySpecificsFillPlan'
import type { EbayItemSpecificSlot } from '../ebayItemSpecificsModel'

/**
 * H3：「类目属性填写」键的裁决全在这里（R2 口径：页内脚本只回原文，判据留 shared 纯函数）。
 * 槽位形状照 2026-11-11 现网 AddItem（~/.yandu-acceptance/2026-11-11-G1/ 与 2026-11-09-R5）：
 * 菜单行静态 DOM 里没有候选值（options 为空，点开才远程检索），Yes/No 是 pill，
 * California Prop 65 Warning 是带 0/800 计数的 textarea，UPC 是 Enter number 输入行。
 * 五硬要求落在判据里：人工值不覆盖、空值不收、枚举限白名单、超长不收；来源只可能是 ENUM_MATCH（本地值匹配）或 AI（LLM 复核后）。
 */

const slot = (patch: Partial<EbayItemSpecificSlot>): EbayItemSpecificSlot => ({
  name: '', group: 'ESSENTIAL', groupLabel: 'Required', control: 'MENU', required: false, placeholder: '',
  placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [], y: 0, ...patch
})

const SLOTS: EbayItemSpecificSlot[] = [
  slot({ name: 'Brand', required: true, y: 1477 }),
  slot({ name: 'Color', group: 'OPTIONAL', groupLabel: 'Additional (optional)', options: [{ text: 'Red', pressed: false }, { text: 'Black', pressed: false }], y: 1700 }),
  slot({ name: 'Universal Fitment', group: 'OPTIONAL', groupLabel: 'Additional (optional)', control: 'YESNO', options: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], y: 2177 }),
  slot({ name: 'California Prop 65 Warning', group: 'OPTIONAL', control: 'TEXTAREA', maxLength: 800, counter: '0/800', y: 2773 }),
  slot({ name: 'UPC', group: 'OPTIONAL', control: 'TEXT', placeholder: 'Enter number', y: 3201 })
]

const local = (...rows: Array<[string, string, ('ENUM_MATCH' | 'MANUAL' | 'AI')?]>): EbaySpecificsFillFact[] =>
  rows.map(([name, value, source]) => ({ name, value, source: source || 'ENUM_MATCH' }))

describe('ebaySpecificsFillPlan · 值能不能进槽位', () => {
  it('空值、超长度一律不收并给中文原因', () => {
    expect(specificValueIssue(SLOTS[3], '   ')).toBe('值为空')
    expect(specificValueIssue(SLOTS[3], 'x'.repeat(801))).toContain('800')
    expect(specificValueIssue(SLOTS[3], 'x'.repeat(800))).toBe('')
  })

  it('Yes/No 槽位只收是/否语义并归一，其它词拒收', () => {
    expect(specificValueIssue(SLOTS[2], '也许')).not.toBe('')
    expect(specificValueIssue(SLOTS[2], 'yes')).toBe('')
    expect(specificValueIssue(SLOTS[2], '否')).toBe('')
  })

  it('带候选值的槽位限白名单；静态没候选值的菜单行不收空但不拦真值', () => {
    expect(specificValueIssue(SLOTS[1], 'Blue')).not.toBe('')
    expect(specificValueIssue(SLOTS[1], 'red')).toBe('')
    expect(specificValueIssue(SLOTS[0], 'Unbranded')).toBe('')
  })
})

describe('ebaySpecificsFillPlan · 按产品真实内容出填写计划', () => {
  it('本地同名值直填，大小写归一到现网候选原文，Yes/No 归一', () => {
    const plan = planEbaySpecificsFill(SLOTS, {
      title: '2PC Universal Bucket Racing Seats', descriptionText: '',
      local: local(['Brand', 'Unbranded'], ['color', 'RED'], ['Universal Fitment', '是'], ['UPC', '012345678905'])
    })
    expect(plan.fills).toEqual([
      { name: 'Brand', value: 'Unbranded', source: 'ENUM_MATCH' },
      { name: 'Color', value: 'Red', source: 'ENUM_MATCH' },
      { name: 'Universal Fitment', value: 'Yes', source: 'ENUM_MATCH' },
      { name: 'UPC', value: '012345678905', source: 'ENUM_MATCH' }
    ])
    expect(plan.skipped.map(item => item.name)).toEqual(['California Prop 65 Warning'])
    expect(plan.skipped[0].reason).toContain('本地没有')
  })

  it('人工值不覆盖、白名单外与空值不进计划，逐条点名原因', () => {
    const plan = planEbaySpecificsFill(SLOTS, {
      title: '', descriptionText: '',
      local: local(['Brand', ''], ['Color', 'Blue'], ['Universal Fitment', 'No'])
    }, local(['Universal Fitment', 'Yes', 'MANUAL']))
    expect(plan.fills).toEqual([])
    const reasons = Object.fromEntries(plan.skipped.map(item => [item.name, item.reason]))
    expect(reasons['Universal Fitment']).toContain('人工')
    expect(reasons['Brand']).toContain('空')
    expect(reasons['Color']).toContain('白名单')
  })
})

describe('ebaySpecificsFillPlan · LLM 复核答案只收白名单内', () => {
  it('白名单内收为 AI 来源，白名单外与坏槽位名丢弃', () => {
    const kept = applyLlmSpecificAnswers(SLOTS, [
      { name: 'Color', value: 'Black' },
      { name: 'Color', value: 'Purple' },
      { name: 'Material', value: 'Leather' },
      { name: 'Universal Fitment', value: 'No' }
    ])
    expect(kept).toEqual([
      { name: 'Color', value: 'Black', source: 'AI' },
      { name: 'Universal Fitment', value: 'No', source: 'AI' }
    ])
  })
})

describe('ebaySpecificsFillPlan · 菜单捕获选项的白名单口径（I2/I4）', () => {
  const menu = (patch: Partial<EbayItemSpecificSlot>): EbayItemSpecificSlot => ({
    name: 'Brand', group: 'ESSENTIAL', groupLabel: 'Required', control: 'MENU', required: true, placeholder: '',
    placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [],
    menuOptions: [], menuOptionsTotal: 0, menuOptionsComplete: false, menuMulti: false, y: 0, ...patch
  })

  it('白名单闭合的菜单槽：候选内收、候选外拒', () => {
    const slot = menu({ menuOptions: ['Unbranded', '16:1'], menuOptionsTotal: 2, menuOptionsComplete: true })
    expect(specificValueIssue(slot, 'Unbranded')).toBe('')
    expect(specificValueIssue(slot, 'MadeUp Brand')).not.toBe('')
  })

  it('虚拟化未闭合的菜单槽不拦真值：写页会按名检索复核，这里不预拒', () => {
    const slot = menu({ menuOptions: ['Unbranded'], menuOptionsTotal: 10184, menuOptionsComplete: false })
    expect(specificValueIssue(slot, 'Some Rare Brand')).toBe('')
  })

  it('多选槽收逗号子集，任一成员不在闭合候选内即拒', () => {
    const slot = menu({ name: 'Placement on Vehicle', control: 'MENU_MULTI', menuOptions: ['Driver Side', 'Front', 'Rear'], menuOptionsTotal: 3, menuOptionsComplete: true, menuMulti: true })
    expect(specificValueIssue(slot, 'Driver Side, Rear')).toBe('')
    expect(specificValueIssue(slot, 'Driver Side, Middle')).not.toBe('')
  })

  it('自行输入菜单与捕获失败的菜单一律不拦真值：没候选不是拒收的理由', () => {
    const freeText = menu({ name: 'Manufacturer Part Number', menuFreeText: true, menuCaptureIssue: 'NO_LIST' })
    expect(specificValueIssue(freeText, 'ABC-12345')).toBe('')
    const noButton = menu({ name: 'Color', menuCaptureIssue: 'NO_BUTTON' })
    expect(specificValueIssue(noButton, 'Black')).toBe('')
    const noPanel = menu({ name: 'Seat Type', menuCaptureIssue: 'NO_PANEL' })
    expect(specificValueIssue(noPanel, 'Bucket')).toBe('')
    const plan = planEbaySpecificsFill([freeText, noButton], {
      title: '', descriptionText: '',
      local: local(['Manufacturer Part Number', 'ABC-12345'], ['Color', 'Black'])
    })
    expect(plan.fills.map(item => item.name)).toEqual(['Manufacturer Part Number', 'Color'])
    expect(plan.skipped).toEqual([])
  })
})
