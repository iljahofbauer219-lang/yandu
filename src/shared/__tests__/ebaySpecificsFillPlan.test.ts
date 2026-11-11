import { describe, expect, it } from 'vitest'
import {
  applyLlmSpecificAnswers, ebaySpecificsLlmOptions, ebaySpecificsUnfilledRows, planEbaySpecificsFill, specificValueIssue,
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

/**
 * K1：真机取证（2026-11-11 赛车座椅 3555cec2）——点「类目属性填写」后黄框菜单行仍空。
 * 两处根因：① 喂给 LLM 的候选取 slot.options（只有 Yes/No pill），菜单行一律 0 个候选，
 * 模型被告知「自由填写」于是自创 "Driver,Passenger"/"Racing,Bucket"/"PVC"，闭合白名单全拒；
 * ② 规则档只按英文同名匹配本地事实，而图文页抓来的规格是中文键（颜色/材质/产地），19 行全判「本地没有该属性的记录」。
 */
describe('ebaySpecificsLlmOptions · 喂给模型的候选必须是现网真捕获', () => {
  const menu = (patch: Partial<EbayItemSpecificSlot>): EbayItemSpecificSlot => slot({ name: 'Color', ...patch })

  it('菜单行取 menuOptions，不再因为 options 是 pill 专用而回空数组', () => {
    const captured = menu({ menuOptions: ['Beige', 'Black', 'Blue'], menuOptionsTotal: 16, menuOptionsComplete: false })
    expect(ebaySpecificsLlmOptions(captured)).toEqual(['Beige', 'Black', 'Blue'])
  })

  it('多选菜单行同样取捕获候选', () => {
    const multi = menu({ name: 'Placement on Vehicle', control: 'MENU_MULTI', menuMulti: true, menuOptions: ['Driver Side', 'Front', 'Passenger Side'], menuOptionsTotal: 8, menuOptionsComplete: true })
    expect(ebaySpecificsLlmOptions(multi)).toEqual(['Driver Side', 'Front', 'Passenger Side'])
  })

  it('Yes/No 行取 pill 原文；没捕获的菜单行回空数组，不编造候选', () => {
    expect(ebaySpecificsLlmOptions(SLOTS[2])).toEqual(['Yes', 'No'])
    expect(ebaySpecificsLlmOptions(menu({ menuCaptureIssue: 'NO_LIST', menuFreeText: true }))).toEqual([])
  })

  it('捕获候选与 pill 原文合并去重，大小写不敏感且保留首次拼写', () => {
    const mixed = menu({ menuOptions: ['Black', 'black', 'Red'], options: [{ text: 'RED', pressed: false }, { text: 'Blue', pressed: false }] })
    expect(ebaySpecificsLlmOptions(mixed)).toEqual(['Black', 'Red', 'Blue'])
  })
})

describe('planEbaySpecificsFill · 图文页中文键规格事实按别名进槽位（K1）', () => {
  const seats: EbayItemSpecificSlot[] = [
    slot({ name: 'Brand', required: true, menuOptions: ['Unbranded'], menuOptionsTotal: 10184 }),
    slot({ name: 'Color', group: 'OPTIONAL', menuOptions: ['Beige', 'Black', 'Blue'], menuOptionsTotal: 16, menuOptionsComplete: true }),
    slot({ name: 'Material', group: 'OPTIONAL', control: 'MENU_MULTI', menuMulti: true, menuOptions: ['Cloth', 'Faux Leather', 'Leather', 'Vinyl'], menuOptionsTotal: 11, menuOptionsComplete: true }),
    slot({ name: 'Country of Origin', group: 'OPTIONAL', menuOptions: ['Afghanistan', 'Albania'], menuOptionsTotal: 244 })
  ]

  it('颜色/产地/品牌照别名进对应槽位，值仍过同一套白名单与归一', () => {
    const plan = planEbaySpecificsFill(seats, {
      title: '2PC Universal Bucket Racing Seats', descriptionText: '',
      local: local(['颜色', 'black'], ['产地', 'China'], ['品牌', 'Unbranded'])
    })
    expect(plan.fills).toEqual([
      { name: 'Brand', value: 'Unbranded', source: 'ENUM_MATCH' },
      { name: 'Color', value: 'Black', source: 'ENUM_MATCH' },
      { name: 'Country of Origin', value: 'China', source: 'ENUM_MATCH' }
    ])
  })

  it('别名值不在闭合候选内照拒并点名，绝不换个相近候选冒充', () => {
    const plan = planEbaySpecificsFill(seats, { title: '', descriptionText: '', local: local(['材质', 'PVC']) })
    expect(plan.fills).toEqual([])
    expect(plan.skipped.find(item => item.name === 'Material')?.reason).toContain('白名单')
  })

  it('别名不覆盖人工值，也不凭空造出清单里没有的槽位', () => {
    const plan = planEbaySpecificsFill(seats, {
      title: '', descriptionText: '', local: local(['颜色', 'Black'], ['型号', 'W1739S00002'])
    }, local(['Color', 'Red', 'MANUAL']))
    expect(plan.fills).toEqual([])
    expect(plan.skipped.find(item => item.name === 'Color')?.reason).toContain('人工')
    expect(plan.fills.map(item => item.name)).not.toContain('Model')
  })

  it('英文同名直填不受别名影响（回归）', () => {
    const plan = planEbaySpecificsFill(seats, { title: '', descriptionText: '', local: local(['Color', 'Blue']) })
    expect(plan.fills).toEqual([{ name: 'Color', value: 'Blue', source: 'ENUM_MATCH' }])
  })
})

/**
 * K1：真机通知曾把「规则档跳过」当成「最终未填」上屏——Brand/Seat Type 明明被 AI 填上了，
 * 通知仍点名它们「本地没有该属性的记录」。未填清单必须按最终 fills 反推，逐行给真实原因。
 */
describe('ebaySpecificsUnfilledRows · 未填清单按最终结果反推（K1）', () => {
  const slots = [
    slot({ name: 'Brand', required: true }),
    slot({ name: 'Color', group: 'OPTIONAL' }),
    slot({ name: 'Seat Type', group: 'OPTIONAL' }),
    slot({ name: 'UPC', group: 'OPTIONAL', control: 'TEXT' })
  ]
  const ruleSkipped = [
    { name: 'Brand', reason: '本地没有该属性的记录' },
    { name: 'Color', reason: '本地没有该属性的记录' },
    { name: 'Seat Type', reason: '本地没有该属性的记录' },
    { name: 'UPC', reason: '本地没有该属性的记录' }
  ]

  it('被 AI 填上的行不再出现在未填清单里，哪怕规则档跳过过它', () => {
    const fills = [
      { name: 'Brand', value: 'Unbranded', source: 'AI' as const },
      { name: 'Color', value: 'Black', source: 'ENUM_MATCH' as const },
      { name: 'Seat Type', value: 'Bucket Seat With Headrest', source: 'AI' as const }
    ]
    expect(ebaySpecificsUnfilledRows(slots, fills, ruleSkipped)).toEqual([
      { name: 'UPC', reason: '本地没有该属性的记录' }
    ])
  })

  it('模型没作答或答案被拒的行给真实原因，不冒充规则档原因', () => {
    const fills = [{ name: 'Color', value: 'Black', source: 'ENUM_MATCH' as const }]
    const rows = ebaySpecificsUnfilledRows(slots, fills, [{ name: 'Color', reason: '本地没有该属性的记录' }])
    expect(rows.map(r => r.name)).toEqual(['Brand', 'Seat Type', 'UPC'])
    expect(rows.every(r => r.reason === 'AI 复核未给出可收的值')).toBe(true)
  })

  it('全部填上时未填清单为空；大小写不敏感认同名', () => {
    const fills = slots.map(s => ({ name: s.name.toLowerCase(), value: 'x', source: 'AI' as const }))
    expect(ebaySpecificsUnfilledRows(slots, fills, ruleSkipped)).toEqual([])
  })
})
