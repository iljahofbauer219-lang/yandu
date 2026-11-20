import { describe, expect, it } from 'vitest'
import { buildEbayDraftContinueUrl, ebayPublishRefFromUrl, resolveEbayListingTarget } from '../ebayListingTarget'
import { isEbayListingFormUrl } from '../ebayDeliveryCountry'

describe('草稿继续完成页路由 · ReturnURL 指回草稿栏', () => {
  it('与用户真机给定网址逐字一致', () => {
    expect(buildEbayDraftContinueUrl('5329376346020')).toBe('https://www.ebay.com/lstng?draftId=5329376346020&mode=AddItem&ReturnURL=https%3A%2F%2Fwww.ebay.com%2Fsh%2Flst%2Fdrafts')
  })

  it('draftId 走 encodeURIComponent，不裸拼', () => {
    expect(buildEbayDraftContinueUrl('a b&c')).toContain('draftId=a%20b%26c')
  })

  it('resolver 草稿复用分支与构造器同串（prepare 复用草稿也直链继续完成页）', () => {
    const target = resolveEbayListingTarget({ publishRef: { kind: 'draft', id: '5329376346020' } })
    expect(target.kind).toBe('add')
    expect(target.url).toBe(buildEbayDraftContinueUrl('5329376346020'))
  })

  it('revise 分支 ReturnURL 仍指在架栏，不受本次改动影响', () => {
    const target = resolveEbayListingTarget({ publishRef: { kind: 'listing', id: '189035181453' } })
    expect(target.url).toBe('https://www.ebay.com/sl/list?mode=ReviseItem&itemId=189035181453&ReturnURL=https%3A%2F%2Fwww.ebay.com%2Fsh%2Flst%2Factive')
  })

  it('新 URL 仍能反解出 draft 引用，发布去重链不断', () => {
    expect(ebayPublishRefFromUrl(buildEbayDraftContinueUrl('5329376346020'))).toEqual({ kind: 'draft', id: '5329376346020' })
  })

  it('新 URL 仍被认作刊登编辑页，收货地切换不自动刷新口径不断', () => {
    expect(isEbayListingFormUrl(buildEbayDraftContinueUrl('5315018936621'))).toBe(true)
  })
})