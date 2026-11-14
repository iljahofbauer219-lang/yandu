import { describe, expect, it } from 'vitest'
import { DEFAULT_HOT_THRESHOLD, isHotListing } from '../ebayResearch'
import type { EbayResearchListing } from '../ebayResearch'

const listing = (over: Partial<EbayResearchListing> = {}): EbayResearchListing => ({
  itemId: '1', title: 't', imageUrl: '', itemSoldCount: 100, avgSoldPrice: 90, avgShipping: 20, totalSales: 9000, freeShippingPercent: 99, lastSoldDateTime: '2026-11-14T00:00:00Z', ...over
})

describe('热销判定 isHotListing', () => {
  it('售出与销售额双达标判热销', () => {
    expect(isHotListing(listing(), DEFAULT_HOT_THRESHOLD)).toBe(true)
  })
  it('售出不足不判热销', () => {
    expect(isHotListing(listing({ itemSoldCount: 10 }), DEFAULT_HOT_THRESHOLD)).toBe(false)
  })
  it('销售额不足不判热销', () => {
    expect(isHotListing(listing({ totalSales: 100 }), DEFAULT_HOT_THRESHOLD)).toBe(false)
  })
  it('阈值可配', () => {
    expect(isHotListing(listing({ itemSoldCount: 10, totalSales: 100 }), { minSold: 5, minRevenue: 50 })).toBe(true)
  })
})