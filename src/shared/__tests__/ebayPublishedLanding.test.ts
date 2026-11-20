import { describe, expect, it } from 'vitest'
import { readEbayPublishedLanding } from '../ebayListingTarget'

/**
 * 正向上架证据单一真值：自动发布链与「已上架转出」实时通道共用。
 * 仅卖家列表/Item 页算上架；captcha/splashui/error 即使带 itemId 也绝不认，防误删本地行。
 */
describe('readEbayPublishedLanding · 正向上架证据', () => {
  it('Item 页（带标题 slug）反解 itemId', () => {
    expect(readEbayPublishedLanding('https://www.ebay.com/itm/2PC-Universal-Bucket/123456789012')).toEqual({ published: true, itemId: '123456789012' })
  })
  it('sl/list 带 itemId 算上架并反解', () => {
    expect(readEbayPublishedLanding('https://www.ebay.com/sl/list?mode=ReviseItem&itemId=123456789012&ReturnURL=x')).toEqual({ published: true, itemId: '123456789012' })
  })
  it('裸 sl/list 算上架但无编号（自动链同口径）', () => {
    expect(readEbayPublishedLanding('https://www.ebay.com/sl/list?mode=AddItem')).toEqual({ published: true, itemId: '' })
  })
  it('captcha/splashui/error 即使带 itemId 也不算上架', () => {
    for (const url of [
      'https://www.ebay.com/splashui/captcha?ap=1&itemId=123456789012',
      'https://www.ebay.com/lstng/error?reason=pageLoadListing&itemId=123456789012',
      'https://www.ebay.com/sl/list/error?itemId=123456789012'
    ]) expect(readEbayPublishedLanding(url)).toEqual({ published: false, itemId: '' })
  })
  it('草稿页与卖家在售列表不算上架', () => {
    expect(readEbayPublishedLanding('https://www.ebay.com/lstng?draftId=5329376346020&mode=AddItem').published).toBe(false)
    expect(readEbayPublishedLanding('https://www.ebay.com/sh/lst/active').published).toBe(false)
  })
  it('空 URL 与首页返回未上架', () => {
    expect(readEbayPublishedLanding('')).toEqual({ published: false, itemId: '' })
    expect(readEbayPublishedLanding('https://www.ebay.com/').published).toBe(false)
  })
})