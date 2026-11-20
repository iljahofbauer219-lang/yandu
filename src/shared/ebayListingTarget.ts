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
  /** 发布去重：该本地产品已在 eBay 产生的唯一草稿/刊登引用；有则复用，不重复新建 */
  publishRef?: EbayPublishRef | null
}

export interface EbayPublishRef {
  kind: 'draft' | 'listing'
  id: string
  at?: string
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
const DRAFT_RETURN_URL = 'https://www.ebay.com/sh/lst/drafts'
const PRELIST_URL = 'https://www.ebay.com/sl/prelist/suggest?sr=shstart'
// eBay 类目 ID 是纯数字且位数远小于商品编号；上界 12 位同时把误填的商品编号挡在 AddItem 之外。
const EBAY_CATEGORY_ID = /^\d{2,12}$/

/** 草稿「继续完成草稿」编辑页：ReturnURL 指回草稿栏，缺它时 eBay 落地页会偏离续作界面（2026-11-19 用户真机给定网址）。 */
export function buildEbayDraftContinueUrl(draftId: string): string {
  return `https://www.ebay.com/lstng?draftId=${encodeURIComponent(draftId)}&mode=AddItem&ReturnURL=${encodeURIComponent(DRAFT_RETURN_URL)}`
}

export function resolveEbayListingTarget(input: EbayListingTargetInput): EbayListingTarget {
  const categoryId = (input.categoryId || '').replace(/\s+/g, '')
  // 发布去重：已有唯一草稿/刊登引用时复用它，绝不重复新建（仅 eBay 侧删除后由主进程清 ref 才重建）。
  const ref = input.publishRef
  if (ref && /^\d{6,}$/.test(ref.id)) {
    if (ref.kind === 'listing') {
      return {
        kind: 'revise',
        itemId: ref.id,
        url: `https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(ref.id)}&ReturnURL=${encodeURIComponent(RETURN_URL)}`,
        note: `复用该本地产品已有的 eBay 在架刊登 ${ref.id}（修改页），不重复新建。`
      }
    }
    return {
      kind: 'add',
      url: buildEbayDraftContinueUrl(ref.id),
      note: `复用该本地产品已有的 eBay 草稿 ${ref.id}，不重复新建草稿；核对后由您提交。`
    }
  }
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
export function resolveEbayListingTargetForProduct(product: { listingId?: string; platformCategoryId?: string; publishRef?: EbayPublishRef | null }): EbayListingTarget {
  return resolveEbayListingTarget({ itemId: product.listingId, categoryId: product.platformCategoryId, publishRef: product.publishRef })
}

/** 从落地 URL 反解该本地产品对应的唯一 eBay 草稿/刊登引用，供主进程持久化去重。 */
export function ebayPublishRefFromUrl(url: string): EbayPublishRef | null {
  const draft = /[?&]draftId=(\d{6,})/.exec(url || '')
  if (draft) return { kind: 'draft', id: draft[1] }
  const item = /[?&]itemId=(\d{6,})/.exec(url || '') || /\/itm\/(?:[^/]+\/)?(\d{6,})/.exec(url || '')
  if (item) return { kind: 'listing', id: item[1] }
  return null
}

/**
 * 正向上架证据：仅卖家列表/Item 页算已上架；captcha/splashui/error 即使带 itemId 也绝不认，
 * 否则会把验证墙误判成上架而误删本地行。自动发布链与「已上架转出」实时通道共用此单一真值。
 */
export function readEbayPublishedLanding(url: string): { published: boolean; itemId: string } {
  const target = url || ''
  const published = /\/sl\/list|itemId=\d+|\/itm\/\d+/.test(target) && !/captcha|splashui|\/error/.test(target)
  const itemId = published ? (/itemId=(\d+)/.exec(target) || /\/itm\/(?:[^/]*\/)?(\d+)/.exec(target) || [])[1] || '' : ''
  return { published, itemId }
}
