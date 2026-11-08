import { describe, expect, it } from 'vitest'
import { resolveEbayListingTarget, resolveEbayListingTargetForProduct } from '../ebayListingTarget'

// 三条 URL 形态逐字来自 2026-11-08 真机取证（/tmp/yandu-r2/evidence/additem-A-direct.json、
// additem-C-nocat.json、prelist-suggest.json、sellerhub-create-entry.json）：
//   revise  eBay 把 /sl/list?mode=ReviseItem&itemId= 重写成 lstng?draftId=…&mode=ReviseItem（历史标签 9/10 实证）
//   add     lstng?mode=AddItem&categoryId=<真叶ID> 被接受，类目自动预填
//   不带 categoryId 的 AddItem 直入 = eBay 错误页 MISSING_CATEGORY_PRODUCT_ITEM_ID，所以类目非数字必须改道 prelist
//   prelist Seller Hub「Create listing」的真实 href，落「List an item」首页
const REVISE = 'https://www.ebay.com/sl/list?mode=ReviseItem&itemId=189035181453&ReturnURL=https%3A%2F%2Fwww.ebay.com%2Fsh%2Flst%2Factive'
const ADD = 'https://www.ebay.com/lstng?mode=AddItem&categoryId=33701'
const PRELIST = 'https://www.ebay.com/sl/prelist/suggest?sr=shstart'

describe('resolveEbayListingTarget', () => {
  it('真在架编号优先走 ReviseItem，URL 与现网口径逐字一致', () => {
    expect(resolveEbayListingTarget({ itemId: '189035181453', categoryId: '33701' })).toMatchObject({ kind: 'revise', url: REVISE })
  })

  it('编号里的空格只是录入痕迹，不影响路由', () => {
    expect(resolveEbayListingTarget({ itemId: ' 189 0351 81453 ' }).kind).toBe('revise')
  })

  it('货盘本地编号配真叶类目改走首次刊登', () => {
    const target = resolveEbayListingTarget({ itemId: 'PALLET-4b695b47-8c63-4e5b-bf0e-97fe2dbe0e4d', categoryId: '33701' })
    expect(target).toMatchObject({ kind: 'add', url: ADD })
    expect(target.url).not.toContain('PALLET')
  })

  it('没有编号但有真叶类目同样走首次刊登', () => {
    expect(resolveEbayListingTarget({ categoryId: '33701' })).toMatchObject({ kind: 'add', url: ADD })
  })

  it('类目缺失改道新建刊登首页，绝不拼出错页 URL', () => {
    expect(resolveEbayListingTarget({})).toMatchObject({ kind: 'prelist', url: PRELIST })
    expect(resolveEbayListingTarget({ itemId: 'PALLET-d20c1159-bf99-41de-ad82-887db2410074' })).toMatchObject({ kind: 'prelist', url: PRELIST })
  })

  it('类目不是纯数字时同样改道：eBay 对非数字 categoryId 直接回 MISSING_CATEGORY_PRODUCT_ITEM_ID', () => {
    for (const categoryId of ['abc', '33701x', '0', '  ', '1890351814539999']) {
      const target = resolveEbayListingTarget({ categoryId })
      expect(target.kind, categoryId).toBe('prelist')
      expect(target.url).toBe(PRELIST)
    }
  })

  it('三条路由都给出面向操作手的中文说明', () => {
    for (const input of [{ itemId: '189035181453' }, { categoryId: '33701' }, {}]) {
      const target = resolveEbayListingTarget(input)
      expect(target.note).toMatch(/[一-龥]/)
      expect(target.note.length).toBeGreaterThan(10)
    }
  })

  it('任何路由的 URL 都不允许带上 PALLET 本地编号', () => {
    const pallet = 'PALLET-e60d1bbf-ba1a-4a44-84cd-cf23e40429f2'
    for (const input of [{ itemId: pallet }, { itemId: pallet, categoryId: '33701' }, { itemId: pallet, categoryId: 'abc' }, { itemId: pallet, categoryId: '' }]) {
      expect(resolveEbayListingTarget(input).url).not.toContain('PALLET')
    }
  })
})

// 本地产品同时带着店铺类目树 id（categoryId）与 eBay 平台类目 id（platformCategoryId），
// 只有后者能拼 AddItem；把取字段的活收进一个函数，渲染器与主进程才不会各拿错一个。
describe('resolveEbayListingTargetForProduct', () => {
  it('listingId 当在架编号、platformCategoryId 当类目，两条都齐时仍按修改页', () => {
    const product = { listingId: '189035181453', platformCategoryId: '33701', categoryId: '908' }
    expect(resolveEbayListingTargetForProduct(product).kind).toBe('revise')
    expect(resolveEbayListingTargetForProduct(product).url).toBe(REVISE)
  })

  it('首次刊登只认平台类目，绝不拿店铺类目 id 凑数', () => {
    const product = { listingId: 'PALLET-4b695b47-8c63-4e5b-bf0e-97fe2dbe0e4d', platformCategoryId: '33701', categoryId: '908' }
    expect(resolveEbayListingTargetForProduct(product)).toMatchObject({ kind: 'add', url: ADD })
    const noPlatformCategory = { ...product, platformCategoryId: '' }
    expect(resolveEbayListingTargetForProduct(noPlatformCategory)).toMatchObject({ kind: 'prelist', url: PRELIST })
  })

  it('字段缺失的旧记录不抛异常，按最保守的 prelist 落地', () => {
    expect(resolveEbayListingTargetForProduct({}).kind).toBe('prelist')
  })
})
