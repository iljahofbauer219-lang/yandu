// 关键词研究（eBay Terapeak 商品研究）与入选榜单的共享契约。
// 数据经主进程以店铺登录分区直连 /sh/research/graphql（UnifiedSearch）读取，过去30天已售口径。

export interface EbayResearchSummary {
  avgPrice: number
  priceMin: number
  priceMax: number
  avgShipping: number
  freeShippingPercent: number
  itemSoldCount: number
  soldListingsCount: number
  sellerCount: number
  totalRevenue: number
}

export interface EbayResearchListing {
  itemId: string
  title: string
  imageUrl: string
  itemSoldCount: number
  avgSoldPrice: number
  avgShipping: number
  totalSales: number
  freeShippingPercent: number
  lastSoldDateTime: string
}

export interface EbayResearchResult {
  keyword: string
  marketplaceId: string
  fetchedAt: string
  summary: EbayResearchSummary
  listings: EbayResearchListing[]
}

export interface EbayShortlistItem {
  id: string
  keyword: string
  storeId: string
  itemId: string
  title: string
  imageUrl: string
  itemSoldCount: number
  avgSoldPrice: number
  avgShipping: number
  totalSales: number
  lastSoldDateTime: string
  addedAt: string
}

// 浏览器内研究页采集插件落库的商品（单/多采集），暂不接入关键词研究页。
export interface ResearchCollectedItem {
  id: string
  storeId: string
  keyword: string
  itemId: string
  url: string
  title: string
  imageUrl: string
  avgSoldPrice: number
  itemSoldCount: number
  totalSales: number
  collectedAt: string
}

// 热销判定阈值（用户可配）：命中=售出总计≥minSold 且 销售额≥minRevenue 且 售出率口径由前端展示
export interface ResearchHotThreshold {
  minSold: number
  minRevenue: number
}

export const DEFAULT_HOT_THRESHOLD: ResearchHotThreshold = { minSold: 50, minRevenue: 3000 }

export function isHotListing(listing: EbayResearchListing, threshold: ResearchHotThreshold): boolean {
  return listing.itemSoldCount >= threshold.minSold && listing.totalSales >= threshold.minRevenue
}