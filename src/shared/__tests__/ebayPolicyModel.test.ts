import { describe, expect, it } from 'vitest'
import { EBAY_POLICY_MODEL_FIELDS, parseEbayPolicyModel } from '../ebayPolicyModel'

/**
 * R2 真机 fixtures：2026-11-08 从 Seller Hub 修改页（ebay.com/lstng?draftId=5303065810623&mode=ReviseItem）
 * 内嵌模型里按 "paymentPolicy"/"shippingPolicy"/"returnPolicy" 锚点原样切下来的三段 JSON，未做任何加工。
 * 现网事实：政策控件是 input[role=combobox]，控件 value 只有「名称 + 在架数」，编号只存在于这三段模型里；
 * 退货政策连控件都没有渲染出来，所以「读下拉」这条路永远拿不到它。
 */
const PAYMENT_MODEL = `{"name":"paymentPolicyId","value":257211994013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Payment policy"}]},"help":{"title":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Select a payment policy"}]},"messageText":[{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Select a payment policy"}]}]},"ghostText":"Choose a policy","readOnly":false,"options":[{"value":257211994013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"eBay immediate payment"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"[3409 listings]"}]}},{"value":257217501013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"eBay Managed Payments (257217501013)"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"[1 listing]"}]}}]}`
const SHIPPING_MODEL = `{"name":"shippingPolicyId","value":266273287013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Shipping policy"}]},"help":{"title":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Select a shipping policy"}]},"messageText":[{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Select a shipping policy"}]}]},"ghostText":"Choose a policy","readOnly":false,"options":[{"value":262233981013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"云仓包邮"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"美国小中包邮"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(1901 listings)"}]}},{"value":266273287013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"中国直邮包邮"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(1515 listings)"}]}},{"value":265556337013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Flat: Other free, same business day (265556337013)"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(1 listing)"}]}}]}`
const RETURN_MODEL = `{"name":"returnsPolicyId","value":262373278013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Return policy"}]},"help":{"title":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Select a return policy"}]},"messageText":[{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Select a return policy"}]}]},"ghostText":"Choose a policy","readOnly":false,"options":[{"value":262373278013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"14天大健云仓退货"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(3407 listings)"}]}},{"value":265556336013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"free 30 days money back (265556336013)"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(1 listing)"}]}},{"value":266305371013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"30 days money back (266305371013)"}]},"description":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(1 listing)"}]}}]}`

describe('parseEbayPolicyModel · 现网模型三段原文', () => {
  it('付款：编号取自模型 option.value，名称与在架数分列，选中项跟着模型当前值', () => {
    expect(parseEbayPolicyModel('paymentPolicy', PAYMENT_MODEL)).toStrictEqual([
      { kind: 'PAYMENT', label: 'eBay immediate payment', policyId: '257211994013', listingCount: 3409, selected: true },
      { kind: 'PAYMENT', label: 'eBay Managed Payments', policyId: '257217501013', listingCount: 1, selected: false }
    ])
  })

  it('运输：三条全带出，当前值命中的那条才算选中（模型 value 是第二个选项）', () => {
    const rows = parseEbayPolicyModel('shippingPolicy', SHIPPING_MODEL)
    expect(rows).toHaveLength(3)
    expect(rows.map(row=>row.policyId)).toEqual(['262233981013', '266273287013', '265556337013'])
    expect(rows.filter(row=>row.selected).map(row=>row.policyId)).toEqual(['266273287013'])
    expect(rows.map(row=>row.listingCount)).toEqual([1901, 1515, 1])
  })

  it('运输：名称尾部自带的 (编号) 只从 label 剥掉，policyId 一律以模型 option.value 为准', () => {
    const rows = parseEbayPolicyModel('shippingPolicy', SHIPPING_MODEL)
    expect(rows[2].label).toBe('Flat: Other free, same business day')
    expect(rows[2].policyId).toBe('265556337013')
  })

  it('退货：锚点叫 returnPolicy、模型内部字段叫 returnsPolicyId，两者都归到 RETURN 类', () => {
    const rows = parseEbayPolicyModel('returnPolicy', RETURN_MODEL)
    expect(rows.map(row=>row.kind)).toEqual(['RETURN', 'RETURN', 'RETURN'])
    expect(rows[0]).toStrictEqual({ kind: 'RETURN', label: '14天大健云仓退货', policyId: '262373278013', listingCount: 3407, selected: true })
  })

  it('类别清单与模型锚点一一对应，发货（handlingTime）绝不混进来', () => {
    expect(EBAY_POLICY_MODEL_FIELDS).toEqual(['paymentPolicy', 'shippingPolicy', 'returnPolicy'])
  })
})

describe('parseEbayPolicyModel · 缺口与脏值不抛错', () => {
  it('原文残缺或 JSON 语法坏了 → 空数组，绝不把「读取刊登规则」这个动作打断', () => {
    for (const broken of ['', '   ', '{"name":"paymentPolicyId"', '{"options":"不是数组"}', '{}']) {
      expect(parseEbayPolicyModel('paymentPolicy', broken), JSON.stringify(broken)).toEqual([])
    }
  })

  it('选项值不是纯数字编号 → 该行只带名字不带 policyId，让逐类「解析不出编号」点名仍能触发', () => {
    const synthetic = '{"name":"handlingDuration","value":6,"options":[{"value":6,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"6 business days"}]}}]}'
    expect(parseEbayPolicyModel('paymentPolicy', synthetic)).toStrictEqual([
      { kind: 'PAYMENT', label: '6 business days', selected: false }
    ])
  })

  it('模型没有当前值（ghostText「Choose a policy」状态）→ 一条都不算选中', () => {
    const synthetic = '{"name":"paymentPolicyId","ghostText":"Choose a policy","options":[{"value":257211994013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"eBay immediate payment"}]}}]}'
    expect(parseEbayPolicyModel('paymentPolicy', synthetic)).toStrictEqual([
      { kind: 'PAYMENT', label: 'eBay immediate payment', policyId: '257211994013', selected: false }
    ])
  })

  it('在架数量词写成「件」或带千分位也要读成数字，读不出就当没这个字段', () => {
    const synthetic = '{"name":"shippingPolicyId","value":262233981013,"options":[{"value":262233981013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"标准运输"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"(2,050 件)"}]}},{"value":266273287013,"label":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"其它"}]},"listingCount":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"暂无"}]}}]}'
    const rows = parseEbayPolicyModel('shippingPolicy', synthetic)
    expect(rows[0].listingCount).toBe(2050)
    expect(rows[1].listingCount === undefined).toBe(true)
  })
})
