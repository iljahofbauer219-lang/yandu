import { describe, expect, it } from 'vitest'
import { applyLlmSpecificAnswers, inferEbaySpecificsYesNo } from '../ebaySpecificsFillPlan'
import type { EbayItemSpecificSlot } from '../ebayItemSpecificsModel'

/**
 * V 批：红框剩余行的三档裁决。YESNO 三件套无结构化源，只按描述/标题文字证据保守推断，
 * 证据原文随值返回（标来源）；无证据不造值。无源五项（Warranty/Interchange/Superseded/Prop65/UPC）
 * 只认本地真值，LLM 即便给出过校验的值也一律丢弃，绝不编造。
 */
const slot = (patch: Partial<EbayItemSpecificSlot>): EbayItemSpecificSlot => ({
  name: '', group: 'OPTIONAL', groupLabel: 'Additional (optional)', control: 'YESNO', required: false, placeholder: '',
  placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '',
  options: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], y: 0, ...patch
})

const SLOTS: EbayItemSpecificSlot[] = [
  slot({ name: 'Vintage Part' }),
  slot({ name: 'Universal Fitment' }),
  slot({ name: 'Performance Part' }),
  slot({ name: 'Brand', control: 'MENU', options: [] })
]

const DESC = 'These are aftermarket racing seats so will not compatible with the OEM features. Universal for 95% cars, please carefully CHECK the DIMENSIONS. Ergonomic Racing Seats designed ergomonically.'

describe('inferEbaySpecificsYesNo · YESNO 三件套按描述证据保守推断', () => {
  it('有证据按规则推断并回证据原文（证据必须是输入的子串，可标来源）', () => {
    const rows = inferEbaySpecificsYesNo(SLOTS, { title: '2PC Universal Bucket Racing Seats', descriptionText: DESC })
    const byName = Object.fromEntries(rows.map(row => [row.name, row]))
    expect(byName['Vintage Part'].value).toBe('No')
    expect(byName['Vintage Part'].evidence).toContain('aftermarket')
    expect(byName['Universal Fitment'].value).toBe('Yes')
    expect(byName['Universal Fitment'].evidence).toContain('Universal for 95% cars')
    expect(byName['Performance Part'].value).toBe('Yes')
    expect(byName['Performance Part'].evidence.toLowerCase()).toContain('racing')
    for (const row of rows) expect(DESC.includes(row.evidence)).toBe(true)
  })

  it('无证据不产生推断行（宁缺毋造）', () => {
    expect(inferEbaySpecificsYesNo(SLOTS, { title: 'Seat', descriptionText: 'A nice black seat.' })).toEqual([])
  })

  it('只作用 YESNO 槽位；同名菜单行不推断', () => {
    const rows = inferEbaySpecificsYesNo([slot({ name: 'Performance Part', control: 'MENU', options: [] })], { title: 'racing', descriptionText: 'racing seats' })
    expect(rows).toEqual([])
  })

  it('清单没有该槽位不产生行', () => {
    expect(inferEbaySpecificsYesNo([], { title: 'racing', descriptionText: DESC })).toEqual([])
  })

  it('标题证据同样计入（标题含 Universal）', () => {
    const rows = inferEbaySpecificsYesNo([slot({ name: 'Universal Fitment' })], { title: '2PC Universal Bucket Racing Seats', descriptionText: '' })
    expect(rows[0]?.value).toBe('Yes')
  })
})

describe('applyLlmSpecificAnswers · 无源五项 LLM 不得造值', () => {
  it('UPC/Prop65/Warranty/Interchange/Superseded 即便值过校验也丢弃；有候选真值的 Color 不受影响', () => {
    const slots = [
      slot({ name: 'UPC', control: 'TEXT', options: [] }),
      slot({ name: 'California Prop 65 Warning', control: 'TEXTAREA', maxLength: 800, options: [] }),
      slot({ name: 'Manufacturer Warranty', control: 'MENU', options: [] }),
      slot({ name: 'Interchange Part Number', control: 'MENU', options: [] }),
      slot({ name: 'Superseded Part Number', control: 'MENU', options: [] }),
      slot({ name: 'Color', control: 'MENU', options: [{ text: 'Black', pressed: false }] })
    ]
    const kept = applyLlmSpecificAnswers(slots, [
      { name: 'UPC', value: '012345678905' },
      { name: 'California Prop 65 Warning', value: 'WARNING: cancer' },
      { name: 'Manufacturer Warranty', value: '1 year' },
      { name: 'Interchange Part Number', value: 'X1' },
      { name: 'Superseded Part Number', value: 'X2' },
      { name: 'Color', value: 'Black' }
    ])
    expect(kept.map(row => row.name)).toEqual(['Color'])
  })
})