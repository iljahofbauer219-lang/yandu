import { describe, expect, it } from 'vitest'
import { isSupplyDownloadOpenable, palletItemToEbayLocalInput, palletWarehouseIdFromListingId, parsePalletPrice } from '../palletToEbayLocal'
import type { PalletWarehouseItem } from '../contracts'

const item: PalletWarehouseItem = {
  id: 'p1',
  warehouseProductId: 'wp-1',
  warehouseCode: 'GIGACLOUD',
  itemCode: 'SKU-9',
  title: '实木床架',
  imageUrl: 'https://img.example.test/a.jpg',
  priceText: 'US $128.50',
  category: '家具',
  subcategory: '卧室家具',
  tertiaryCategory: '床架及底座',
  sourceUrl: 'https://www.gigab2b.com/product/1',
  storedAt: '2026-10-11T00:00:00.000Z'
}

describe('palletItemToEbayLocalInput', () => {
  it('listingId 带 PALLET- 前缀且绑定店铺与市场', () => {
    const { listing } = palletItemToEbayLocalInput(item, 'store-1', 'EBAY_US', '2026-10-11T01:00:00.000Z')
    expect(listing.listingId).toBe('PALLET-wp-1')
    expect(listing.storeId).toBe('store-1')
    expect(listing.marketplaceId).toBe('EBAY_US')
    expect(listing.id).toBe('store-1:EBAY_US:PALLET-wp-1')
  })

  it('价格与币种从 priceText 解析，缺省币种 USD', () => {
    const { listing, details } = palletItemToEbayLocalInput(item, 's', 'EBAY_US', 't')
    expect(listing.price).toBe('128.50')
    expect(listing.currency).toBe('USD')
    expect(details.price).toBe('128.50')
    const free = palletItemToEbayLocalInput({ ...item, priceText: '' }, 's', 'EBAY_US', 't')
    expect(free.listing.price).toBe('')
    expect(free.listing.currency).toBe('USD')
  })

  it('主图缺失时 imageUrls 为空且类目回退未分类', () => {
    const { listing, details } = palletItemToEbayLocalInput({ ...item, imageUrl: '', category: '' }, 's', 'EBAY_US', 't')
    expect(listing.imageUrls).toEqual([])
    expect(listing.imageUrl).toBe('')
    expect(details.imageUrls).toEqual([])
    expect(listing.categoryName).toBe('未分类')
  })

  it('parsePalletPrice 兼容千分位与无币种文本', () => {
    expect(parsePalletPrice('￥1,280.00')).toEqual({ price: '1280.00', currency: '' })
    expect(parsePalletPrice('面议')).toEqual({ price: '', currency: '' })
  })
})

describe('下载图文页开页口径', () => {
  it('PALLET- 前缀反查 warehouseProductId，非货盘来源与空值返回空串', () => {
    expect(palletWarehouseIdFromListingId('PALLET-wp-1')).toBe('wp-1')
    expect(palletWarehouseIdFromListingId('PALLET-')).toBe('')
    expect(palletWarehouseIdFromListingId('1005006789')).toBe('')
    expect(palletWarehouseIdFromListingId('')).toBe('')
  })

  it('仅 DOWNLOADED 且有服务器详情页地址才可点开，档案缺失/失败/无地址一律不可点', () => {
    expect(isSupplyDownloadOpenable({ status: 'DOWNLOADED', pageUrl: 'http://host/product-pages/abc' })).toBe(true)
    expect(isSupplyDownloadOpenable({ status: 'DOWNLOADED', pageUrl: '' })).toBe(false)
    expect(isSupplyDownloadOpenable({ status: 'FAILED', pageUrl: 'http://host/product-pages/abc' })).toBe(false)
    expect(isSupplyDownloadOpenable(undefined)).toBe(false)
    expect(isSupplyDownloadOpenable(null)).toBe(false)
  })
})
