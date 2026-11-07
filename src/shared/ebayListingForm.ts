import type { EbayLocalProductUpdateInput, EbayProductDetails } from './contracts'

/** 把渲染器提交的编辑合并回旧快照详情：只覆盖本次真正提交的字段，其余（属性/状况/视频/政策/数量/所在地）原样保留。 */
export function mergeEbayLocalDetailsEdit(previous:EbayProductDetails,changes:EbayLocalProductUpdateInput):EbayProductDetails {
  const policies=changes.policyIds||{}
  return {
    ...previous,
    itemSpecifics:changes.itemSpecifics?changes.itemSpecifics.map(item=>({...item})):[...(previous.itemSpecifics||[])],
    condition:changes.condition===undefined?previous.condition:changes.condition.trim(),
    quantity:changes.quantity===undefined?previous.quantity:changes.quantity.trim(),
    sku:changes.sku===undefined?previous.sku:changes.sku.trim(),
    itemLocation:changes.itemLocation===undefined?previous.itemLocation:changes.itemLocation.trim(),
    postalCode:changes.postalCode===undefined?previous.postalCode:changes.postalCode.trim(),
    handlingTime:changes.handlingTime===undefined?previous.handlingTime:changes.handlingTime.trim(),
    listingFormat:changes.listingFormat===undefined?previous.listingFormat:changes.listingFormat,
    paymentPolicy:policies.payment===undefined?previous.paymentPolicy:policies.payment,
    shippingPolicy:policies.shipping===undefined?previous.shippingPolicy:policies.shipping,
    returnPolicy:policies.return===undefined?previous.returnPolicy:policies.return,
    title:changes.title.trim(),
    descriptionText:changes.descriptionText.trim(),
    descriptionHtml:changes.descriptionHtml.trim(),
    price:changes.price.trim(),
    currency:changes.currency.trim(),
    imageUrls:changes.media.map(item=>item.remoteUrl).filter(Boolean)
  }
}
