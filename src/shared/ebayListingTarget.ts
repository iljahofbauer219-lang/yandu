import { checkEbayPolicyCarrierItemId } from './ebayPolicyCarrier'

/**
 * 准备发布的目标路由：决定「保存并准备到 eBay」到底打开 eBay 的哪一个页面。
 * 三条 URL 形态都取自 2026-11-08 真机取证，不是推测：
 *   revise  Seller Hub 修改页，itemId 必须是真实在架编号；
 *   add     按真叶类目直入首次刊登，eBay 会把类目自动预填进表单；
 *   prelist eBay「Create listing」的真实入口，落地「List an item」首页。
 * 关键约束：`mode=AddItem` 不带（或带非数字）categoryId 会被 eBay 拒成
 * `lstng/error?reason=pageLoadListing:Error:MISSING_CATEGORY_PRODUCT_ITEM_ID`，
 * 所以类目不合格时一律改道 prelist，而不是把一个必然打不开的链接交给用户。
 */

export type EbayListingRouteKind = 'revise' | 'add' | 'prelist'

export interface EbayListingTargetInput {
  /** 本地产品的 listingId：货盘来源时为 PALLET-<warehouseProductId>，不是 eBay 编号 */
  itemId?: string
  /** 平台类目（eBay 真叶 ID） */
  categoryId?: string
}

export interface EbayListingTarget {
  kind: EbayListingRouteKind
  url: string
  /** 面向操作手的中文点名：说明本次会打开哪个页面、以及为什么 */
  note: string
  itemId?: string
  categoryId?: string
}

const RETURN_URL = 'https://www.ebay.com/sh/lst/active'
const PRELIST_URL = 'https://www.ebay.com/sl/prelist/suggest?sr=shstart'
// eBay 类目 ID 是纯数字且位数远小于商品编号；上界 12 位同时把误填的商品编号挡在 AddItem 之外。
const EBAY_CATEGORY_ID = /^\d{2,12}$/

export function resolveEbayListingTarget(input: EbayListingTargetInput): EbayListingTarget {
  const categoryId = (input.categoryId || '').replace(/\s+/g, '')
  const carrier = checkEbayPolicyCarrierItemId(input.itemId || '')
  if (carrier.ok) {
    return {
      kind: 'revise',
      itemId: carrier.itemId,
      url: `https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(carrier.itemId)}&ReturnURL=${encodeURIComponent(RETURN_URL)}`,
      note: `将打开 eBay 在架商品 ${carrier.itemId} 的修改页，本地版本按字段填入后由您在页面核对并提交。`
    }
  }
  if (EBAY_CATEGORY_ID.test(categoryId)) {
    return {
      kind: 'add',
      categoryId,
      url: `https://www.ebay.com/lstng?mode=AddItem&categoryId=${encodeURIComponent(categoryId)}`,
      note: '该商品还没有可修改的 eBay 在架编号，已按确定的平台类目打开 eBay 首次刊登页；类目、政策与所在地由 eBay 带出默认值，仍需人工核对后提交。'
    }
  }
  return {
    kind: 'prelist',
    url: PRELIST_URL,
    note: `还没有可用的在架编号，也没有可用的平台类目（${input.categoryId ? `「${input.categoryId}」不是 eBay 类目编号` : '平台类目尚未确定'}）。eBay 对没有类目的首次刊登会直接报错，已为您打开「List an item」新建刊登首页；可在该页搜索定类目，或回到编辑器在「平台类目」里确定后重试。`
  }
}

/**
 * 本地产品 → 开页路由。EbayLocalProduct 同时带着店铺类目树的 `categoryId` 与 eBay 平台类目 `platformCategoryId`，
 * 只有后者能拼 AddItem；取字段的活收在这里，渲染器与主进程才不会各拿错一个。
 */
export function resolveEbayListingTargetForProduct(product: { listingId?: string; platformCategoryId?: string }): EbayListingTarget {
  return resolveEbayListingTarget({ itemId: product.listingId, categoryId: product.platformCategoryId })
}
