import { describe, expect, it } from 'vitest'
import { buildEbayPremiumLocalSeed } from '../ebayPremiumLocalSeed'
import type { EbayOptimizationDraft } from '../contracts'

const draft = (overrides: Partial<EbayOptimizationDraft> = {}): EbayOptimizationDraft => ({
  id: 'draft-1',
  storeId: 'store-1',
  listingId: 'PALLET-abc',
  listing: {
    id: 'store-1:EBAY_US:PALLET-abc',
    storeId: 'store-1',
    marketplaceId: 'EBAY_US',
    listingId: 'PALLET-abc',
    sku: 'SKU-1',
    title: 'Original listing title',
    price: '100.00',
    currency: 'USD',
    quantity: 2,
    imageUrl: 'https://img.example/old.jpg',
    imageUrls: ['https://img.example/old.jpg'],
    categoryId: '177003',
    categoryName: 'Car maintenance and repair',
    status: 'ACTIVE',
    viewUrl: 'https://www.ebay.com/itm/123456789012',
    updatedAt: '2026-11-01T00:00:00.000Z'
  },
  selectedTitle: 'Optimized title',
  titleVariants: [],
  itemSpecifics: [{ name: 'Brand', value: 'Acme', priority: 'RECOMMENDED', confidence: 'HIGH', needsConfirmation: false, source: 'AI' }],
  description: 'Optimized description',
  imageUrl: 'https://img.example/a.jpg',
  imageUrls: ['https://img.example/a.jpg', 'https://img.example/b.jpg'],
  scoreBefore: 40,
  scoreAfter: 90,
  status: 'PREMIUM',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  salePrice: '446.85',
  saleCurrency: 'USD',
  ...overrides
})

describe('buildEbayPremiumLocalSeed', () => {
  it('优化标题/核算售价/币种优先于线上快照', () => {
    const seed = buildEbayPremiumLocalSeed(draft(), 'EBAY_US', '2026-11-18T00:00:00.000Z')
    expect(seed.listing.title).toBe('Optimized title')
    expect(seed.listing.price).toBe('446.85')
    expect(seed.details.title).toBe('Optimized title')
    expect(seed.details.price).toBe('446.85')
    expect(seed.details.descriptionText).toBe('Optimized description')
  })
  it('优化字段缺失时回落线上快照值', () => {
    const seed = buildEbayPremiumLocalSeed(draft({ selectedTitle: '', description: '', salePrice: '', saleCurrency: '' }), 'EBAY_US', '2026-11-18T00:00:00.000Z')
    expect(seed.listing.title).toBe('Original listing title')
    expect(seed.listing.price).toBe('100.00')
    expect(seed.listing.currency).toBe('USD')
    expect(seed.details.descriptionText).toBe('')
  })
  it('媒体行只挂 remoteUrl：localPath 留空且标 FAILED，序号连续', () => {
    const seed = buildEbayPremiumLocalSeed(draft(), 'EBAY_US', '2026-11-18T00:00:00.000Z')
    expect(seed.media).toHaveLength(2)
    seed.media.forEach((media, index) => {
      expect(media.remoteUrl).toBe(draft().imageUrls![index])
      expect(media.localPath).toBe('')
      expect(media.downloadStatus).toBe('FAILED')
      expect(media.sortOrder).toBe(index)
      expect(media.mediaType).toBe('IMAGE')
    })
  })
  it('空 URL 剔除且最多 24 张', () => {
    const urls = ['', ...Array.from({ length: 30 }, (_, i) => `https://img.example/${i}.jpg`)]
    const seed = buildEbayPremiumLocalSeed(draft({ imageUrls: urls }), 'EBAY_US', '2026-11-18T00:00:00.000Z')
    expect(seed.media).toHaveLength(24)
    expect(seed.media[0].remoteUrl).toBe('https://img.example/0.jpg')
    expect(seed.listing.imageUrl).toBe('https://img.example/0.jpg')
  })
  it('保留 draft.listing 的店/货盘标识与类目，marketplaceId 随店铺', () => {
    const seed = buildEbayPremiumLocalSeed(draft(), 'EBAY_US', '2026-11-18T00:00:00.000Z')
    expect(seed.listing.storeId).toBe('store-1')
    expect(seed.listing.listingId).toBe('PALLET-abc')
    expect(seed.listing.id).toBe('store-1:EBAY_US:PALLET-abc')
    expect(seed.listing.categoryId).toBe('177003')
    expect(seed.listing.marketplaceId).toBe('EBAY_US')
    expect(seed.listing.updatedAt).toBe('2026-11-18T00:00:00.000Z')
    expect(seed.capturedAt).toBe('2026-11-18T00:00:00.000Z')
  })
  it('属性只取 name/value 进 details', () => {
    const seed = buildEbayPremiumLocalSeed(draft(), 'EBAY_US', '2026-11-18T00:00:00.000Z')
    expect(seed.details.itemSpecifics).toEqual([{ name: 'Brand', value: 'Acme' }])
    expect(seed.details.imageUrls).toEqual(['https://img.example/a.jpg', 'https://img.example/b.jpg'])
  })
})