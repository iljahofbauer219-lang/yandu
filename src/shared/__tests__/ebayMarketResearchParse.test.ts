import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  ebayMarketResearchChannelLabel,
  ebayMarketResearchChannelShortLabel,
  isEbayResearchCategoryUsable,
  parseEbayAggregateMetrics,
  parseEbayResearchRows
} from '../ebayMarketResearchParse'

// 这两个解析函数以 toString() 注入 eBay 页面执行，页面上下文没有模块作用域：
// 只要函数体引用了模块级变量就会抛 ReferenceError，而注入方只在隐藏视图里取结果，
// 故障表现为「研究页解析静默为空」。这里在全新 vm 上下文中真实执行注入串。
const isolatedParseMetrics = vm.runInNewContext(`(${parseEbayAggregateMetrics.toString()})`) as typeof parseEbayAggregateMetrics
const isolatedParseRows = vm.runInNewContext(`(${parseEbayResearchRows.toString()})`) as typeof parseEbayResearchRows

// 2026-10-23 从已登录的 https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD 页面原样取回
const LIVE_ROW_CELLS = [
  {
    title: '24V 2A Scooter Battery Charger for Pride Mobility',
    listing: ', preview full size image 24V 2A Scooter Battery Charger for Pride Mobility',
    url: 'https://www.ebay.com/itm/404285949389',
    image: 'https://i.ebayimg.com/00/s/MTEyNVgxMTQz/z/fNIAAOSwRDJkWcwo/$_57.JPG?set_id=880000500F',
    price: '$21.99 Fixed price',
    shipping: '$0.00 100% Free shipping',
    sold: '48',
    date: 'Oct 13, 2026'
  },
  {
    title: '32lb Foldable Lightweight Electric Wheelchair Intelligent for Adults Airline FDA',
    listing: ', preview full size image 32lb Foldable Lightweight Electric Wheelchair Intelligent for Adults Airline FDA',
    url: 'https://www.ebay.com/itm/235441502565',
    image: 'https://i.ebayimg.cn/00/s/MTYwMFgxNjAw/z/cM0AAeSwMk1qmOG6/$_12.JPG?set_id=8800005007',
    price: '$461.38 Fixed price',
    shipping: '$50.00',
    sold: '28',
    date: 'Oct 22, 2026'
  }
]

const LIVE_METRIC_ENTRIES = [
  { title: 'Avg sold price', value: '$385.56' },
  { title: 'Sold price range', value: '$5.35 – $3,299.00' },
  { title: 'Avg shipping', value: '$56.85' },
  { title: 'Free shipping', value: '84%' },
  { title: 'Sell-through', value: '12.27%' },
  { title: 'Total sellers', value: '283' },
  // 同一条指标带的悬浮说明版本，标题被 tooltip 文案污染，真实页面会同时取到 12 个节点
  { title: 'Avg sold priceThe mean sold price per item for similar listings, not including shipping costs.', value: '$385.56' },
  { title: 'Total sellersThe total number of sellers.', value: '283' }
]

describe('isEbayResearchCategoryUsable', () => {
  it('接受 eBay 自有类目 ID', () => {
    expect(isEbayResearchCategoryUsable('14339')).toBe(true)
    expect(isEbayResearchCategoryUsable(' 60528 ')).toBe(true)
    expect(isEbayResearchCategoryUsable('999999999')).toBe(true)
  })

  it('拒绝货盘送入的 11 位仓储类目与非法值', () => {
    expect(isEbayResearchCategoryUsable('42289234010')).toBe(false)
    expect(isEbayResearchCategoryUsable('1000000000')).toBe(false)
    expect(isEbayResearchCategoryUsable('0')).toBe(false)
    expect(isEbayResearchCategoryUsable('014339')).toBe(false)
    expect(isEbayResearchCategoryUsable('')).toBe(false)
    expect(isEbayResearchCategoryUsable('Home & Garden')).toBe(false)
  })
})

describe('parseEbayAggregateMetrics', () => {
  it('按研究页指标带原样取到 6 项，缺失项标为页面未提供', () => {
    const metrics = parseEbayAggregateMetrics(LIVE_METRIC_ENTRIES)
    expect(metrics.map(item => item.key)).toEqual([
      'TOTAL_SOLD', 'AVERAGE_SOLD_PRICE', 'SOLD_PRICE_RANGE', 'AVERAGE_SHIPPING',
      'SELL_THROUGH_RATE', 'SELLER_COUNT', 'FREE_SHIPPING_RATE'
    ])
    expect(metrics.filter(item => item.available).map(item => item.label)).toEqual([
      '平均成交价', '成交价区间', '平均运费', '售罄率', '成交卖家数', '包邮率'
    ])
    expect(metrics.find(item => item.key === 'AVERAGE_SOLD_PRICE')?.value).toBe('$385.56')
    expect(metrics.find(item => item.key === 'SELLER_COUNT')?.value).toBe('283')
    const totalSold = metrics.find(item => item.key === 'TOTAL_SOLD')
    expect(totalSold?.available).toBe(false)
    expect(totalSold?.value).toBe('页面未提供')
  })

  it('只有被 tooltip 文案污染的标题时也按前缀命中，不重复取同一槽位', () => {
    const polluted = LIVE_METRIC_ENTRIES.filter(item => item.title.length > 30)
    const metrics = parseEbayAggregateMetrics(polluted)
    expect(metrics.filter(item => item.available).map(item => item.key)).toEqual(['AVERAGE_SOLD_PRICE', 'SELLER_COUNT'])
  })

  it('空输入与非数组输入返回 7 项全部不可用', () => {
    expect(parseEbayAggregateMetrics([]).every(item => !item.available)).toBe(true)
    expect(parseEbayAggregateMetrics(undefined as unknown as Array<{ title: string; value: string }>)).toHaveLength(7)
  })

  it('注入隔离上下文后可原样执行', () => {
    expect(isolatedParseMetrics(LIVE_METRIC_ENTRIES)).toEqual(parseEbayAggregateMetrics(LIVE_METRIC_ENTRIES))
  })
})

describe('parseEbayResearchRows', () => {
  it('研究页成交表按列直读，标题取商品链接文本而非价格单元格', () => {
    const samples = parseEbayResearchRows(LIVE_ROW_CELLS)
    expect(samples).toHaveLength(2)
    expect(samples[0]).toEqual({
      title: '24V 2A Scooter Battery Charger for Pride Mobility',
      price: '21.99',
      currency: 'USD',
      soldDate: 'Oct 13, 2026',
      url: 'https://www.ebay.com/itm/404285949389',
      imageUrl: 'https://i.ebayimg.com/00/s/MTEyNVgxMTQz/z/fNIAAOSwRDJkWcwo/$_57.JPG?set_id=880000500F',
      itemId: '404285949389',
      shipping: '0.00',
      condition: '',
      listingFormat: 'fixed price',
      soldQuantity: '48'
    })
    expect(samples[1]?.shipping).toBe('50.00')
    expect(samples[1]?.soldQuantity).toBe('28')
  })

  it('链接文本缺失时回落商品单元格并剥掉图片按钮文案', () => {
    const samples = parseEbayResearchRows([{
      title: '',
      listing: ', preview full size image Foldable and portable 4-wheel electric scooter for adult outdoor use 250W motor',
      url: 'https://www.ebay.com/itm/128025928459',
      image: '',
      price: '$377.73 Fixed price',
      shipping: '$0.00 100% Free shipping',
      sold: '29',
      date: 'Oct 12, 2026'
    }])
    expect(samples[0]?.title).toBe('Foldable and portable 4-wheel electric scooter for adult outdoor use 250W motor')
    expect(samples[0]?.imageUrl).toBe('')
  })

  it('竞拍行取出价数、纯包邮行标 free、数量列为占位符时留空不冒充销量', () => {
    const samples = parseEbayResearchRows([
      { title: 'Vintage cast iron wall decor sign garage man cave', listing: '', url: 'https://www.ebay.com/itm/305111222333', image: '', price: '$12.00 3 bids', shipping: 'Free shipping', sold: '–', date: 'Oct 1, 2026' },
      { title: 'Used Bosch 18V battery replacement for home workshop tools', listing: '', url: 'https://www.ebay.com/itm/305111222334', image: '', price: 'USD 45.00 Best Offer', shipping: '', sold: '1,204', date: 'Sep 30, 2026' }
    ])
    expect(samples[0]?.listingFormat).toBe('3 bids')
    expect(samples[0]?.shipping).toBe('free')
    expect(samples[0]?.soldQuantity).toBe('')
    expect(samples[1]?.listingFormat).toBe('best offer')
    expect(samples[1]?.condition).toBe('')
    expect(samples[1]?.soldQuantity).toBe('1204')
  })

  it('同一商品重复出现只保留一条，无链接的行直接丢弃', () => {
    const samples = parseEbayResearchRows([
      LIVE_ROW_CELLS[0],
      { ...LIVE_ROW_CELLS[0]!, price: '$22.99 Fixed price' },
      { ...LIVE_ROW_CELLS[1]!, url: '' }
    ])
    expect(samples).toHaveLength(1)
    expect(samples[0]?.price).toBe('21.99')
  })

  it('非数组输入返回空集而不是抛错', () => {
    expect(parseEbayResearchRows(undefined as unknown as typeof LIVE_ROW_CELLS)).toEqual([])
  })

  it('注入隔离上下文后可原样执行', () => {
    expect(isolatedParseRows(LIVE_ROW_CELLS)).toEqual(parseEbayResearchRows(LIVE_ROW_CELLS))
  })
})

describe('ebayMarketResearchChannelLabel', () => {
  it('三种来源各有唯一标签，登录态研究页排在最前', () => {
    expect(ebayMarketResearchChannelLabel('EBAY_PRODUCT_RESEARCH')).toBe('eBay 登录态 Product Research（Seller Hub 研究页）')
    expect(ebayMarketResearchChannelLabel('EBAY_SOLD_SEARCH')).toBe('eBay 公开成交搜索（Sold & Completed）')
    expect(ebayMarketResearchChannelLabel('OMKAR_EBAY_SCRAPER')).toContain('本次勾选的回退通道')
    const labels = (['EBAY_PRODUCT_RESEARCH', 'EBAY_SOLD_SEARCH', 'OMKAR_EBAY_SCRAPER'] as const).map(ebayMarketResearchChannelLabel)
    expect(new Set(labels).size).toBe(3)
    const shorts = (['EBAY_PRODUCT_RESEARCH', 'EBAY_SOLD_SEARCH', 'OMKAR_EBAY_SCRAPER'] as const).map(ebayMarketResearchChannelShortLabel)
    expect(shorts).toEqual(['Product Research', 'Sold & Completed', 'Omkar Scraper'])
  })

  it('未知来源不抛错，返回可读占位', () => {
    expect(ebayMarketResearchChannelLabel('WHATEVER' as never)).toBe('未知来源')
    expect(ebayMarketResearchChannelShortLabel(undefined as never)).toBe('未知来源')
  })
})
