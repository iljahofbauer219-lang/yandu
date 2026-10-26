import type { EbayMarketResearchMetric, EbayMarketResearchSample, EbayMarketResearchSnapshot } from './contracts'

export interface EbayResearchRowCells {
  title: string
  listing: string
  url: string
  image: string
  price: string
  shipping: string
  sold: string
  date: string
}

// 货盘送入的类目 ID 来自大健云仓（11 位、中文类目名），eBay Seller Hub 认不出来会让研究页直接零结果；
// eBay 自有类目 ID 为不超过 9 位的数字，其余一律按「全部类目」处理。
export function isEbayResearchCategoryUsable(categoryId: string): boolean {
  return /^[1-9]\d{0,8}$/.test(String(categoryId || '').trim())
}

const CHANNEL_LABELS: Record<EbayMarketResearchSnapshot['source'], { channel: string; short: string }> = {
  EBAY_PRODUCT_RESEARCH: { channel: 'eBay 登录态 Product Research（Seller Hub 研究页）', short: 'Product Research' },
  EBAY_SOLD_SEARCH: { channel: 'eBay 公开成交搜索（Sold & Completed）', short: 'Sold & Completed' },
  OMKAR_EBAY_SCRAPER: { channel: 'Omkar eBay Scraper API（本次勾选的回退通道）', short: 'Omkar Scraper' }
}

export function ebayMarketResearchChannelLabel(source: EbayMarketResearchSnapshot['source']): string {
  return CHANNEL_LABELS[source]?.channel || '未知来源'
}

export function ebayMarketResearchChannelShortLabel(source: EbayMarketResearchSnapshot['source']): string {
  return CHANNEL_LABELS[source]?.short || '未知来源'
}

// 本函数与 parseEbayResearchRows 都会以 toString() 注入 eBay 页面执行，函数体内不得引用模块作用域，
// 因此槽位表只能定义在函数内部。
export function parseEbayAggregateMetrics(entries: Array<{ title: string; value: string }>): EbayMarketResearchMetric[] {
  const slots = [
    { key: 'TOTAL_SOLD', label: '总成交量', titles: ['total sold', 'total sold count', 'sold quantity'] },
    { key: 'AVERAGE_SOLD_PRICE', label: '平均成交价', titles: ['avg sold price', 'average sold price'] },
    { key: 'SOLD_PRICE_RANGE', label: '成交价区间', titles: ['sold price range', 'price range'] },
    { key: 'AVERAGE_SHIPPING', label: '平均运费', titles: ['avg shipping', 'average shipping', 'avg shipping cost'] },
    { key: 'SELL_THROUGH_RATE', label: '售罄率', titles: ['sell-through', 'sell through', 'sell-through rate'] },
    { key: 'SELLER_COUNT', label: '成交卖家数', titles: ['total sellers', 'number of sellers', 'sellers'] },
    { key: 'FREE_SHIPPING_RATE', label: '包邮率', titles: ['free shipping', 'free shipping rate'] }
  ] as Array<{ key: EbayMarketResearchMetric['key']; label: string; titles: string[] }>
  const read = Array.isArray(entries) ? entries : []
  const normalized = read.map(entry => ({
    title: String(entry?.title || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    value: String(entry?.value || '').replace(/\s+/g, ' ').trim()
  })).filter(entry => entry.title && entry.value)
  return slots.map(slot => {
    const hit = normalized.find(entry => slot.titles.includes(entry.title)) || normalized.find(entry => entry.title.startsWith(slot.titles[0]))
    return { key: slot.key, label: slot.label, value: hit ? hit.value : '页面未提供', available: Boolean(hit) }
  })
}

export function parseEbayResearchRows(rows: EbayResearchRowCells[]): EbayMarketResearchSample[] {
  const read = Array.isArray(rows) ? rows : []
  const clean = (value: string) => String(value || '').replace(/\s+/g, ' ').trim()
  const moneyOf = (value: string) => {
    const match = clean(value).match(/(?:RMB|CNY|USD|US\s*\$|\$)\s*([\d,.]+)/i)
    return match ? match[1].replace(/,/g, '') : ''
  }
  const currencyOf = (value: string) => /RMB|CNY/i.test(String(value || '')) ? 'CNY' : 'USD'
  const quantityOf = (value: string) => {
    const text = clean(value)
    if (!text || /^[-–—\u2013\n]+$/.test(text)) return ''
    const match = text.match(/\d[\d,.]*/)
    return match ? match[0].replace(/,/g, '') : ''
  }
  const samples: EbayMarketResearchSample[] = []
  const seen = new Set<string>()
  for (const row of read) {
    if (!row) continue
    const url = clean(row.url)
    if (!url) continue
    const itemId = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/)?.[1] || ''
    const dedupeKey = itemId || url
    if (seen.has(dedupeKey)) continue
    const anchorTitle = clean(row.title)
    const listingTitle = clean(row.listing).replace(/^[,\s]*(preview full size image)?/i, '').replace(/^,\s*/, '').trim()
    const title = anchorTitle.length >= 5 ? anchorTitle : listingTitle
    if (title.length < 5) continue
    const priceText = clean(row.price)
    const shippingText = clean(row.shipping)
    const shippingMoney = moneyOf(shippingText)
    seen.add(dedupeKey)
    samples.push({
      title: title.slice(0, 240),
      price: moneyOf(priceText),
      currency: currencyOf(priceText || shippingText),
      soldDate: clean(row.date),
      url,
      imageUrl: clean(row.image),
      itemId,
      shipping: shippingMoney || (/free shipping/i.test(shippingText) ? 'free' : ''),
      condition: clean((priceText + ' ' + shippingText).match(/\b(Brand New|New With Tags|New|Pre-Owned|Used|Very Good|Good|Acceptable)\b/i)?.[1] || ''),
      listingFormat: clean(priceText.match(/\b(Fixed Price|Best Offer|Auction|\d+ bids?)\b/i)?.[1] || '').toLowerCase(),
      soldQuantity: quantityOf(row.sold)
    })
  }
  return samples
}
