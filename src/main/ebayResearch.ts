// 关键词研究数据读取：以店铺登录分区开隐藏视图加载研究页建立上下文，再页内同源 fetch
// Terapeak GraphQL（UnifiedSearch），复用「浏览器」页签登录态，不新增爬虫/代理。过去30天已售口径。
import { WebContentsView } from 'electron'
import type { EbayResearchResult, EbayResearchListing, EbayResearchSummary } from '../shared/ebayResearch'
import { UNIFIED_SEARCH_QUERY } from './ebayResearchQuery'

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? n : 0
}
const amount = (v: any): number => num(v && v.amount)

export async function queryEbayResearch(partition: string, keyword: string, limit = 50): Promise<EbayResearchResult> {
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 86400000)
  const body = {
    query: UNIFIED_SEARCH_QUERY,
    variables: {
      terapeakResearchInput: {
        title: keyword,
        marketplaceId: 'EBAY-US',
        dateTimeRange: { startDateTime: start.toISOString(), endDateTime: now.toISOString() },
        checkoutStatus: ['COMPLETED'],
        refundStatus: ['NO_REFUND'],
        wackoTransaction: false
      },
      terapeakListingInput: { pagination: { limit, offset: 0 } },
      activeResearchInput: { title: keyword },
      activeSearchInput: { limit: 20 },
      includeSoldAggregates: true,
      includeActiveListingCount: true,
      includeActiveAggregates: false,
      includeSoldSearchResults: true,
      includeActiveSearchResults: false,
      includeActiveSearch: false
    }
  }
  // 先加载研究页建立登录上下文（裸 session.fetch 会 502），再在页内同源 fetch GraphQL
  const view = new WebContentsView({ webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true } })
  let json: any
  try {
    await view.webContents.loadURL(`https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=${encodeURIComponent(keyword)}&dayRange=30&tabName=SOLD`)
    await new Promise(r => setTimeout(r, 4000))
    const raw = await view.webContents.executeJavaScript(`(async () => { const r = await fetch('https://www.ebay.com/sh/research/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }); return JSON.stringify({ status: r.status, json: await r.json() }) })()`)
    const parsed = JSON.parse(raw)
    if (parsed.status !== 200) throw new Error(`eBay 研究接口返回 ${parsed.status}，请确认店铺登录态`)
    json = parsed.json
  } finally { view.webContents.close() }
  if (json.errors || !json.data) throw new Error('eBay 登录态失效或研究接口不可用，请先在「浏览器」页签登录')
  const s = json.data.terapeakResearch && json.data.terapeakResearch.summary
  if (!s) throw new Error('eBay 登录态失效或研究接口不可用，请先在「浏览器」页签登录')
  const summary: EbayResearchSummary = {
    avgPrice: amount(s.soldPrice && s.soldPrice.avgPrice),
    priceMin: amount(s.priceRange && s.priceRange.minPrice),
    priceMax: amount(s.priceRange && s.priceRange.maxPrice),
    avgShipping: amount(s.avgShipping),
    freeShippingPercent: num(s.freeShippingPercent),
    itemSoldCount: num(s.itemSoldCount),
    soldListingsCount: num(s.soldListingsCount),
    sellerCount: num(s.sellerCount),
    totalRevenue: amount(s.totalRevenue)
  }
  const rawListings: any[] = (json.data.soldSearchResults && json.data.soldSearchResults.listingMetrics && json.data.soldSearchResults.listingMetrics.listings) || []
  const listings: EbayResearchListing[] = rawListings.map(r => ({
    itemId: String(r.listing && r.listing.id || ''),
    title: String(r.listing && r.listing.title || ''),
    imageUrl: String(r.listing && r.listing.image && r.listing.image.url || ''),
    itemSoldCount: num(r.itemSoldCount),
    avgSoldPrice: amount(r.avgSoldPrice),
    avgShipping: amount(r.avgShipping),
    totalSales: amount(r.totalSales),
    freeShippingPercent: num(r.freeShippingPercent),
    lastSoldDateTime: String(r.lastSoldDateTime || '')
  }))
  return { keyword, marketplaceId: 'EBAY-US', fetchedAt: now.toISOString(), summary, listings }
}