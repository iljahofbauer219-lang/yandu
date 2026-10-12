import type { EbayListing, EbayProductDetails, PalletWarehouseItem } from './contracts'

export function parsePalletPrice(priceText: string): { price: string; currency: string } {
  const currency = /\$|USD|US\s?/i.test(priceText) ? 'USD' : ''
  const match = priceText.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return { price: match ? match[0] : '', currency }
}

/** 我的货盘商品 → eBay 本地产品合成 listing/详情（listingId 带 PALLET- 前缀标来源） */
export function palletItemToEbayLocalInput(item: PalletWarehouseItem, storeId: string, marketplaceId: string, capturedAt: string): { listing: EbayListing; details: EbayProductDetails } {
  const { price, currency } = parsePalletPrice(item.priceText || '')
  const listingId = `PALLET-${item.warehouseProductId}`
  const imageUrls = [item.imageUrl].filter(Boolean)
  const money = currency || 'USD'
  const listing: EbayListing = {
    id: `${storeId}:${marketplaceId}:${listingId}`,
    storeId,
    marketplaceId,
    listingId,
    sku: item.itemCode || '',
    title: item.title,
    price,
    currency: money,
    quantity: Math.max(1, item.sellableInventory ?? 1),
    imageUrl: imageUrls[0] || '',
    imageUrls,
    categoryId: '',
    categoryName: item.category || '未分类',
    status: 'ACTIVE',
    viewUrl: item.sourceUrl || '',
    updatedAt: capturedAt
  }
  const details: EbayProductDetails = {
    url: item.sourceUrl || '',
    itemSpecifics: [],
    condition: '',
    imageUrls,
    title: item.title,
    price,
    currency: money
  }
  return { listing, details }
}
