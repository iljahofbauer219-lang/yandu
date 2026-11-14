import { describe, expect, it } from 'vitest'
import {
  defaultEbayFixedFillPreset, ebayFixedFillPlan, normalizeEbayFixedFillPreset,
  type EbayFixedFillPreset
} from '../ebayAutoFillPlan'

/**
 * R2：固定填写预设的裁决层（R2 口径：页内只操作控件，收不收/写不写全在这里离线可复算）。
 * 费用项（推广常规/优先、慈善）默认关；未开启一律不写，避免替用户产生费用义务。
 * 慈善机构即使开启也不代选机构（现网是编辑弹窗人工选），只如实点名。
 */
describe('defaultEbayFixedFillPreset · 默认值', () => {
  it('AC：推广·常规默认开+费率5，其余费用项默认关、其余默认不改动', () => {
    const preset = defaultEbayFixedFillPreset()
    expect(preset.promotedRegularEnabled).toBe(true)
    expect(preset.promotedRegularRate).toBe('5')
    expect(preset.promotedPriorityEnabled).toBe(false)
    expect(preset.charityEnabled).toBe(false)
    expect(preset.condition).toBe('')
    expect(preset.bestOfferEnabled).toBeNull()
    expect(preset.volumePricingEnabled).toBeNull()
    expect(preset.productDocumentsEnabled).toBeNull()
    expect(preset.shippingPolicyId).toBe('')
  })
})

describe('normalizeEbayFixedFillPreset · 规范化', () => {
  it('布尔 coerce、枚举与字符串 trim，未知键丢弃', () => {
    const preset = normalizeEbayFixedFillPreset({
      condition: 'New', bestOfferEnabled: 'true', volumePricingEnabled: 0,
      shippingPolicyId: ' 2585 ', itemLocation: '  Guangdong ', postalCode: '528000',
      promotedRegularEnabled: 'yes', bogusKey: 'x'
    })
    expect(preset.condition).toBe('New')
    expect(preset.bestOfferEnabled).toBe(true)
    expect(preset.volumePricingEnabled).toBe(false)
    expect(preset.shippingPolicyId).toBe('2585')
    expect(preset.itemLocation).toBe('Guangdong')
    expect(preset.promotedRegularEnabled).toBe(false)
    expect((preset as unknown as Record<string, unknown>).bogusKey).toBeUndefined()
  })

  it('condition 只认 New/Used/空，其它归空', () => {
    expect(normalizeEbayFixedFillPreset({ condition: 'Refurbished' }).condition).toBe('')
    expect(normalizeEbayFixedFillPreset({ condition: 'Used' }).condition).toBe('Used')
  })

  it('非对象输入回默认预设', () => {
    expect(normalizeEbayFixedFillPreset(null)).toEqual(defaultEbayFixedFillPreset())
    expect(normalizeEbayFixedFillPreset('x')).toEqual(defaultEbayFixedFillPreset())
  })
})

describe('ebayFixedFillPlan · 固定填写计划', () => {
  const preset = (over: Partial<EbayFixedFillPreset> = {}): EbayFixedFillPreset => ({ ...defaultEbayFixedFillPreset(), ...over })

  it('空预设不产生任何写入行', () => {
    const plan = ebayFixedFillPlan(preset({ quantity: '', promotedRegularEnabled: false, promotedPriorityEnabled: false }))
    expect(plan.rows).toEqual([])
  })

  it('AC：推广·常规默认开启且带默认广告费率5，随计划下发', () => {
    const def = defaultEbayFixedFillPreset()
    expect(def.promotedRegularEnabled).toBe(true)
    expect(def.promotedRegularRate).toBe('5')
    const plan = ebayFixedFillPlan(def)
    const row = plan.rows.find(r => r.key === 'promotedRegularEnabled')
    expect(row?.fee).toBe(true)
    expect(row?.rate).toBe('5')
  })

  it('状况/开关/政策/偏好按预设出写入行，开关 false 也写（非费用项）', () => {
    const plan = ebayFixedFillPlan(preset({
      condition: 'New', bestOfferEnabled: true, volumePricingEnabled: false,
      shippingPolicyId: '2585', paymentPolicyId: '257217501013',
      itemLocation: 'Guangdong', postalCode: '528000', returnPolicyId: 'r1',
      productDocumentsEnabled: true
    }))
    const keys = plan.rows.map(row => row.key)
    expect(keys).toContain('condition')
    expect(keys).toContain('bestOfferEnabled')
    expect(keys).toContain('vpSelection')
    expect(keys).toContain('shippingPolicyId')
    expect(keys).toContain('paymentPolicyId')
    expect(keys).toContain('itemLocation')
    expect(keys).toContain('postalCode')
    expect(keys).toContain('returnPolicyId')
    expect(keys).toContain('productDocumentsEnabled')
    const vp = plan.rows.find(row => row.key === 'vpSelection')
    expect(vp?.value).toBe(false)
    expect(plan.rows.find(row => row.key === 'condition')?.value).toBe('New')
  })

  it('费用项未开启不写并点名；开启才出写入行且标 fee', () => {
    const off = ebayFixedFillPlan(preset({ promotedRegularEnabled: false, promotedPriorityEnabled: false }))
    expect(off.rows.some(row => row.fee)).toBe(false)
    expect(off.skipped.some(item => item.key === 'promotedRegularEnabled')).toBe(true)
    const on = ebayFixedFillPlan(preset({ promotedRegularEnabled: true, promotedPriorityEnabled: true }))
    const regular = on.rows.find(row => row.key === 'promotedRegularEnabled')
    expect(regular?.fee).toBe(true)
    expect(regular?.value).toBe(true)
    expect(on.rows.find(row => row.key === 'promotedPriorityEnabled')?.fee).toBe(true)
  })

  it('慈善即使开启也不代选机构，只点名人工处理', () => {
    const plan = ebayFixedFillPlan(preset({ charityEnabled: true }))
    expect(plan.rows.some(row => row.key === 'charityEnabled')).toBe(false)
    const skipped = plan.skipped.find(item => item.key === 'charityEnabled')
    expect(skipped?.reason).toContain('人工')
  })
})