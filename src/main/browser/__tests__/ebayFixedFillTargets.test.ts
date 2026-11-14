import { describe, expect, it } from 'vitest'
import { ebayFixedFillPageTargets } from '../ebayLocalFill'
import { defaultEbayFixedFillPreset, ebayFixedFillPlan } from '../../../shared/ebayAutoFillPlan'
import type { EbayPolicyModelChoices } from '../../../shared/ebayPolicyModel'

/**
 * R3：固定填写计划 → 页内目标描述符。页内脚本只按描述符操作现网控件，
 * 编号→显示文本仍走 ebayPolicyFillPlan 的三条判据（宁可不填也不按名称猜）。
 */
const models: Partial<Record<string, EbayPolicyModelChoices>> = {
  shippingPolicy: { controlName: 'shippingPolicyId', options: [{ id: '2585', text: '云仓包邮 （2585 件物品刊登）' }] },
  paymentPolicy: { controlName: 'paymentPolicyId', options: [{ id: '257217501013', text: 'eBay Managed Payments (257217501013) [1 件物品刊登]' }] }
}

describe('ebayFixedFillPageTargets · 控件形映射', () => {
  it('状况走 pills、开关按 name/aria/段归属、偏好走弹窗描述符', () => {
    const plan = ebayFixedFillPlan({
      ...defaultEbayFixedFillPreset(),
      condition: 'New', bestOfferEnabled: true, volumePricingEnabled: false,
      productDocumentsEnabled: true, promotedRegularEnabled: true,
      itemLocation: 'Guangdong', postalCode: '528000'
    })
    const { targets } = ebayFixedFillPageTargets(plan, models)
    const byKey = Object.fromEntries(targets.map(t => [t.key, t]))
    expect(byKey.condition).toMatchObject({ control: 'condition-pill', matcher: 'New', desired: 'New' })
    expect(byKey.bestOfferEnabled).toMatchObject({ control: 'switch-name', matcher: 'bestOfferEnabled', desired: true })
    expect(byKey.vpSelection).toMatchObject({ control: 'volume-pricing', matcher: 'vpSelection', desired: false })
    expect(byKey.productDocumentsEnabled).toMatchObject({ control: 'switch-section', matcher: '物品披露信息', desired: true })
    expect(byKey.promotedRegularEnabled).toMatchObject({ control: 'switch-aria', matcher: '切换为常规', desired: true, fee: true })
    expect(byKey.itemLocation).toMatchObject({ control: 'preferences', matcher: 'itemLocation', desired: 'Guangdong' })
    expect(byKey.postalCode).toMatchObject({ control: 'preferences', matcher: 'postalCode', desired: '528000' })
  })

  it('X：批量购买价格三态——开→volume-pricing 带默认档位；关→desired false；不改动→不出目标', () => {
    const on = ebayFixedFillPageTargets(ebayFixedFillPlan({ ...defaultEbayFixedFillPreset(), volumePricingEnabled: true }), models)
    expect(on.targets.find(t => t.key === 'vpSelection')).toMatchObject({ control: 'volume-pricing', matcher: 'vpSelection', desired: true, tiers: { 2: '5', 3: '7', 4: '10' } })
    const off = ebayFixedFillPageTargets(ebayFixedFillPlan({ ...defaultEbayFixedFillPreset(), volumePricingEnabled: false }), models)
    expect(off.targets.find(t => t.key === 'vpSelection')).toMatchObject({ control: 'volume-pricing', desired: false })
    const none = ebayFixedFillPageTargets(ebayFixedFillPlan(defaultEbayFixedFillPreset()), models)
    expect(none.targets.some(t => t.key === 'vpSelection')).toBe(false)
  })

  it('Y：预设三档折扣随计划下发，映射 tiers 用预设值而非固定默认', () => {
    const plan = ebayFixedFillPlan({ ...defaultEbayFixedFillPreset(), volumePricingEnabled: true, volumeTier2: '3', volumeTier3: '6', volumeTier4: '9' })
    expect(plan.rows.find(r => r.key === 'vpSelection')?.tiers).toEqual({ 2: '3', 3: '6', 4: '9' })
    const { targets } = ebayFixedFillPageTargets(plan, models)
    expect(targets.find(t => t.key === 'vpSelection')?.tiers).toEqual({ 2: '3', 3: '6', 4: '9' })
  })

  it('Z：预设数量默认2随计划下发映射 text-name；空=不改动不出目标', () => {
    const def = ebayFixedFillPlan(defaultEbayFixedFillPreset())
    expect(def.rows.find(r => r.key === 'quantity')).toMatchObject({ kind: 'text', value: '2' })
    const { targets } = ebayFixedFillPageTargets(def, models)
    expect(targets.find(t => t.key === 'quantity')).toMatchObject({ control: 'text-name', matcher: 'quantity', desired: '2' })
    const none = ebayFixedFillPlan({ ...defaultEbayFixedFillPreset(), quantity: '' })
    expect(none.rows.some(r => r.key === 'quantity')).toBe(false)
  })

  it('政策 combobox 复用编号→显示文本裁决；模型缺失则点名跳过不出目标', () => {
    const plan = ebayFixedFillPlan({ ...defaultEbayFixedFillPreset(), shippingPolicyId: '2585', paymentPolicyId: '999' })
    const { targets, skipped } = ebayFixedFillPageTargets(plan, models)
    const ship = targets.find(t => t.key === 'shippingPolicyId')
    expect(ship).toMatchObject({ control: 'combobox', matcher: 'shippingPolicyId', optionText: '云仓包邮 （2585 件物品刊登）', desired: '2585' })
    expect(targets.some(t => t.key === 'paymentPolicyId')).toBe(false)
    expect(skipped.some(s => s.key === 'paymentPolicyId')).toBe(true)
  })

  it('计划自带的 skipped（费用项未开启/慈善）原样并入', () => {
    const plan = ebayFixedFillPlan({ ...defaultEbayFixedFillPreset(), quantity: '' })
    const { targets, skipped } = ebayFixedFillPageTargets(plan, models)
    expect(targets).toEqual([])
    expect(skipped.some(s => s.key === 'promotedRegularEnabled')).toBe(true)
    expect(skipped.some(s => s.key === 'charityEnabled')).toBe(true)
  })
})