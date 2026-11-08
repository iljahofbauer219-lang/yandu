/** 政策抓取的「载体商品编号」校验：只为打开 eBay 修改页，政策本身按店铺入库复用。 */

export type EbayPolicyCarrierCheck = { ok: true; itemId: string } | { ok: false; message: string }

// 本地产品 listingId 形如 PALLET-<warehouseProductId>（shared/palletToEbayLocal 的来源标记），
// 直接拼进 ReviseItem URL 会被 eBay 拒成 createOrGetDraft 错误页，政策永远抓不到。
const PALLET_PREFIX = /^PALLET-/i
// eBay item ID 是纯数字；现网常见 12 位，历史在架商品更短，故放行 9–15 位而不是写死 12。
const EBAY_ITEM_ID = /^\d{9,15}$/

export function checkEbayPolicyCarrierItemId(raw: string): EbayPolicyCarrierCheck {
  const itemId = (raw || '').replace(/\s+/g, '')
  if (!itemId) return { ok: false, message: '「在架商品编号」还是空的。请填写一个你店铺里已在架的 eBay 商品编号（例如 189035181453）；系统只用它打开一次修改页读取政策，政策按店铺入库后所有商品复用。' }
  if (PALLET_PREFIX.test(itemId)) return { ok: false, message: `「${itemId}」以 PALLET- 开头，是本系统的货盘本地编号，不是 eBay 商品编号。eBay 修改页只认真实在架的商品编号（例如 189035181453），请在「在架商品编号」里填写它。` }
  if (!EBAY_ITEM_ID.test(itemId)) return { ok: false, message: `eBay 商品编号只能是 9–15 位纯数字（例如 189035181453），当前填写的是「${itemId}」。` }
  return { ok: true, itemId }
}
