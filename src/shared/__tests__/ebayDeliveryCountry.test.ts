import { describe, expect, it } from 'vitest'
import {
  EBAY_DELIVERY_MANUAL_URL,
  EBAY_DELIVERY_OPTIONS,
  ebayDeliveryAlpha3,
  ebayDeliveryLabel,
  isEbayListingFormUrl,
  parseEbayPreferencePost,
  readEbayDeliveryCountry,
  readEbayDeliveryPostal,
  resolveEbayDeliveryCountry,
  resolvePostalRetention
} from '../ebayDeliveryCountry'

describe('收货地二选一 · 选项与映射', () => {
  it('只有美国与中国两项，美国在前', () => {
    expect(EBAY_DELIVERY_OPTIONS.map(option => option.label)).toEqual(['美国', '中国'])
    expect(EBAY_DELIVERY_OPTIONS.map(option => option.code)).toEqual(['US', 'CN'])
  })

  it('提交给 eBay 的是三位国家码 USA / CHN', () => {
    expect(ebayDeliveryAlpha3('US')).toBe('USA')
    expect(ebayDeliveryAlpha3('CN')).toBe('CHN')
  })

  it('未知国家码不许静默当成美国', () => {
    expect(() => ebayDeliveryAlpha3('DE' as never)).toThrow()
  })

  it('按钮文案跟随所选，未选择时回落「收货地」', () => {
    expect(ebayDeliveryLabel('US')).toBe('美国')
    expect(ebayDeliveryLabel('CN')).toBe('中国')
    expect(ebayDeliveryLabel(null)).toBe('收货地')
  })
})

describe('收货地二选一 · 读回 eBay 落地国家', () => {
  it('从 GHpre.shipToLocation 的编码值读出美国', () => {
    expect(readEbayDeliveryCountry('91789%2CUSA')).toBe('US')
  })

  it('邮编为空时仍能读出中国', () => {
    expect(readEbayDeliveryCountry('%2CCHN')).toBe('CN')
  })

  it('已解码的值同样能读', () => {
    expect(readEbayDeliveryCountry(',CHN')).toBe('CN')
  })

  it('第三国不冒充两国之一', () => {
    expect(readEbayDeliveryCountry('10115%2CDEU')).toBeNull()
  })

  it('空值与坏编码都读成 null，不抛错', () => {
    expect(readEbayDeliveryCountry('')).toBeNull()
    expect(readEbayDeliveryCountry(null)).toBeNull()
    expect(readEbayDeliveryCountry(undefined)).toBeNull()
    expect(readEbayDeliveryCountry('%E0%A4%A')).toBeNull()
  })
})

describe('收货地二选一 · 刊登编辑页不自动刷新', () => {
  it('lstng 刊登页判定为不可自动刷新', () => {
    expect(isEbayListingFormUrl('https://www.ebay.com/lstng?draftId=5315018936621&mode=AddItem')).toBe(true)
  })

  it('卖家中心与首页可以自动刷新', () => {
    expect(isEbayListingFormUrl('https://www.ebay.com/sh/ovw')).toBe(false)
    expect(isEbayListingFormUrl('https://www.ebay.com/')).toBe(false)
  })

  it('非 eBay 域与坏地址一律判否', () => {
    expect(isEbayListingFormUrl('https://example.com/lstng')).toBe(false)
    expect(isEbayListingFormUrl('not a url')).toBe(false)
  })
})

describe('收货地二选一 · 结果判定', () => {
  const base = { requested: 'CN' as const, hasEbayView: true, postAccepted: true, postStatus: 200 }

  it('没有 eBay 页签时点名原因并给手动出口，不谎报成功', () => {
    const result = resolveEbayDeliveryCountry({ requested: 'CN', hasEbayView: false })
    expect(result.ok).toBe(false)
    expect(result.country).toBeNull()
    expect(result.label).toBe('收货地')
    expect(result.reason).toContain('没有打开的 eBay 页面')
    expect(result.manualUrl).toBe(EBAY_DELIVERY_MANUAL_URL)
    expect(result.refreshRequired).toBe(false)
  })

  it('eBay 拒绝写入时带上 HTTP 状态点名，不谎报成功', () => {
    const result = resolveEbayDeliveryCountry({ ...base, postAccepted: false, postStatus: 403 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('403')
    expect(result.reason).toContain('未改动')
    expect(result.manualUrl).toBe(EBAY_DELIVERY_MANUAL_URL)
  })

  it('接口无回应时说明登录态或网络，不谎报成功', () => {
    const result = resolveEbayDeliveryCountry({ requested: 'CN', hasEbayView: true, postAccepted: false })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('没有回应')
  })

  it('写入成功且读回一致才算成功', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '%2CCHN' })
    expect(result.ok).toBe(true)
    expect(result.country).toBe('CN')
    expect(result.label).toBe('中国')
    expect(result.refreshRequired).toBe(false)
    expect(result.reason).toContain('页面已刷新')
  })

  it('中国态如实说明不改写顶栏语言与邮编', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '%2CCHN' })
    expect(result.reason).toContain('语言')
    expect(result.reason).toContain('邮编')
  })

  it('美国态成功文案不承诺中文界面', () => {
    const result = resolveEbayDeliveryCountry({ ...base, requested: 'US', shipToLocation: '91789%2CUSA' })
    expect(result.ok).toBe(true)
    expect(result.label).toBe('美国')
    expect(result.reason).not.toContain('简体中文')
  })

  it('eBay 接受了但读回是别的国家，按读回值如实报失败', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '91789%2CUSA' })
    expect(result.ok).toBe(false)
    expect(result.country).toBe('US')
    expect(result.label).toBe('美国')
    expect(result.reason).toContain('中国')
    expect(result.reason).toContain('美国')
  })

  it('读回为空也报失败，不把空当成中国', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '' })
    expect(result.ok).toBe(false)
    expect(result.country).toBeNull()
    expect(result.reason).toContain('空')
  })

  it('刊登编辑页写入成功后要求手动刷新，并说明是为了不丢未保存内容', () => {
    const result = resolveEbayDeliveryCountry({ ...base, listingForm: true })
    expect(result.ok).toBe(true)
    expect(result.country).toBe('CN')
    expect(result.refreshRequired).toBe(true)
    expect(result.reason).toContain('未保存')
    expect(result.reason).toContain('刷新页面')
  })

  it('每条失败原因都是完整中文句子并带手动出口', () => {
    const failures = [
      resolveEbayDeliveryCountry({ requested: 'US', hasEbayView: false }),
      resolveEbayDeliveryCountry({ ...base, postAccepted: false, postStatus: 500 }),
      resolveEbayDeliveryCountry({ ...base, shipToLocation: '%2CDEU' })
    ]
    for (const result of failures) {
      expect(result.reason.endsWith('。')).toBe(true)
      expect(result.reason).not.toMatch(/Error|ERR_|undefined|null/)
      expect(result.manualUrl).toBe(EBAY_DELIVERY_MANUAL_URL)
    }
  })
})
describe('收货地二选一 · 页面回传只认 JSON 字符串边界', () => {
  it('成功响应解析出状态与 accepted', () => {
    expect(parseEbayPreferencePost('{"status":200,"accepted":true}')).toEqual({ status: 200, accepted: true })
  })

  it('eBay 业务失败不算 accepted', () => {
    expect(parseEbayPreferencePost('{"status":200,"accepted":false}')).toEqual({ status: 200, accepted: false })
  })

  it('坏 JSON、空串与 null 都落成无回应，不抛错', () => {
    expect(parseEbayPreferencePost('not json')).toEqual({ status: 0, accepted: false })
    expect(parseEbayPreferencePost('')).toEqual({ status: 0, accepted: false })
    expect(parseEbayPreferencePost(null)).toEqual({ status: 0, accepted: false })
    expect(parseEbayPreferencePost(undefined)).toEqual({ status: 0, accepted: false })
  })

  it('缺字段或类型不对时不谎报成功', () => {
    expect(parseEbayPreferencePost('{"accepted":true}')).toEqual({ status: 0, accepted: false })
    expect(parseEbayPreferencePost('{"status":"200","accepted":"yes"}')).toEqual({ status: 0, accepted: false })
  })
})

describe('收货地二选一 · 读回邮编', () => {
  it('从编码值读出逗号前的邮编', () => {
    expect(readEbayDeliveryPostal('91789%2CUSA')).toBe('91789')
  })

  it('邮编被清空时读成空串', () => {
    expect(readEbayDeliveryPostal('%2CCHN')).toBe('')
    expect(readEbayDeliveryPostal(',USA')).toBe('')
  })

  it('空值、坏编码与无逗号格式都读成空串，不抛错', () => {
    expect(readEbayDeliveryPostal('')).toBe('')
    expect(readEbayDeliveryPostal(null)).toBe('')
    expect(readEbayDeliveryPostal(undefined)).toBe('')
    expect(readEbayDeliveryPostal('%E0%A4%A')).toBe('')
    expect(readEbayDeliveryPostal('USA')).toBe('')
  })
})

describe('收货地二选一 · 往返保留邮编', () => {
  const base = { requested: 'US' as const, hasEbayView: true, postAccepted: true, postStatus: 200 }

  it('切回美国且邮编与切换前一致时如实说已保留', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '91789%2CUSA', postalBefore: '91789' })
    expect(result.ok).toBe(true)
    expect(result.reason).toContain('91789')
    expect(result.reason).toContain('已保留')
  })

  it('邮编没丢时也按保留口径报成功，不谎称恢复动作', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '91789%2CUSA', postalBefore: '91789' })
    expect(result.refreshRequired).toBe(false)
  })

  it('切回美国但邮编没恢复时报失败并点名原邮编与手动出口', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '%2CUSA', postalBefore: '91789' })
    expect(result.ok).toBe(false)
    expect(result.country).toBe('US')
    expect(result.label).toBe('美国')
    expect(result.reason).toContain('91789')
    expect(result.reason).toContain('邮编')
    expect(result.reason.endsWith('。')).toBe(true)
    expect(result.manualUrl).toBe(EBAY_DELIVERY_MANUAL_URL)
  })

  it('切换前本就没有邮编时不声称保留', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '%2CUSA' })
    expect(result.ok).toBe(true)
    expect(result.reason).not.toContain('已保留')
  })

  it('读回是别的非空邮编时不覆盖也不声称保留', () => {
    const result = resolveEbayDeliveryCountry({ ...base, shipToLocation: '10001%2CUSA', postalBefore: '91789' })
    expect(result.ok).toBe(true)
    expect(result.reason).not.toContain('已保留')
    expect(result.reason).not.toContain('10001')
  })

  it('中国态文案不因保留邮编而改变', () => {
    const result = resolveEbayDeliveryCountry({ ...base, requested: 'CN', shipToLocation: '%2CCHN', postalBefore: '91789' })
    expect(result.ok).toBe(true)
    expect(result.reason).toContain('语言')
    expect(result.reason).toContain('邮编')
    expect(result.reason).not.toContain('已保留')
  })
})

describe('收货地二选一 · 跨调用记住邮编', () => {
  it('当前有邮编时以当前值为准并要求快照', () => {
    expect(resolvePostalRetention({ currentPostal: '91789' })).toEqual({ postalBefore: '91789', shouldSnapshot: true })
  })

  it('去程已把邮编清掉时，回程仍记得切换前的邮编', () => {
    expect(resolvePostalRetention({ currentPostal: '', rememberedPostal: '91789' })).toEqual({ postalBefore: '91789', shouldSnapshot: false })
  })

  it('从没记住过邮编时不凭空造一个', () => {
    expect(resolvePostalRetention({ currentPostal: '' })).toEqual({ postalBefore: '', shouldSnapshot: false })
    expect(resolvePostalRetention({ currentPostal: '', rememberedPostal: null })).toEqual({ postalBefore: '', shouldSnapshot: false })
  })

  it('当前邮编变化时刷新记忆，不拿旧邮编顶替', () => {
    expect(resolvePostalRetention({ currentPostal: '10001', rememberedPostal: '91789' })).toEqual({ postalBefore: '10001', shouldSnapshot: true })
  })
})
