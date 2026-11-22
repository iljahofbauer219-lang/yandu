// 入选榜单与浏览器内研究页采集插件的共享契约。

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

// 浏览器内研究页采集插件落库的商品（单/多采集）。
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