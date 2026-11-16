import { describe, expect, it } from 'vitest'
import { resolveEbayListingTarget, resolveEbayListingTargetForProduct, ebayPublishRefFromUrl } from '../ebayListingTarget'

/**
 * 发布去重：同一本地产品只对应 eBay 一条刊登/草稿。
 * 已有 publishRef(draft) → 复用该草稿 URL（不新建 AddItem）；publishRef(listing) → ReviseItem；
 * 无 ref → 原有 add/prelist 路由。ebayPublishRefFromUrl 从落地 URL 反解 ref 供持久化。
 */
describe('发布去重 · 路由复用与 ref 反解', () => {
  it('有 draft ref：复用草稿 URL，不新建 AddItem', () => {
    const t = resolveEbayListingTarget({ itemId: 'PALLET-x', categoryId: '177003', publishRef: { kind: 'draft', id: '5324729249121', at: '' } })
    expect(t.kind).toBe('add')
    expect(t.url).toContain('draftId=5324729249121')
    expect(t.url).not.toContain('categoryId=')
    expect(t.note).toContain('复用')
  })
  it('有 listing ref：走 ReviseItem 修改页', () => {
    const t = resolveEbayListingTarget({ itemId: 'PALLET-x', categoryId: '177003', publishRef: { kind: 'listing', id: '189035181453', at: '' } })
    expect(t.kind).toBe('revise')
    expect(t.url).toContain('itemId=189035181453')
  })
  it('无 ref：保持原 add 路由（按类目直入）', () => {
    const t = resolveEbayListingTarget({ itemId: 'PALLET-x', categoryId: '177003' })
    expect(t.kind).toBe('add')
    expect(t.url).toContain('categoryId=177003')
  })
  it('resolveEbayListingTargetForProduct 透传 publishRef', () => {
    const t = resolveEbayListingTargetForProduct({ listingId: 'PALLET-x', platformCategoryId: '177003', publishRef: { kind: 'draft', id: '5324729249999', at: '' } })
    expect(t.url).toContain('draftId=5324729249999')
  })
  it('ebayPublishRefFromUrl：draft/listing/itm/无', () => {
    expect(ebayPublishRefFromUrl('https://www.ebay.com/lstng?draftId=5324729249121&mode=AddItem')).toEqual({ kind: 'draft', id: '5324729249121' })
    expect(ebayPublishRefFromUrl('https://www.ebay.com/sl/list?mode=ReviseItem&itemId=189035181453')).toEqual({ kind: 'listing', id: '189035181453' })
    expect(ebayPublishRefFromUrl('https://www.ebay.com/itm/1234567890')).toEqual({ kind: 'listing', id: '1234567890' })
    expect(ebayPublishRefFromUrl('https://www.ebay.com/sh/lst/drafts')).toBeNull()
  })
})