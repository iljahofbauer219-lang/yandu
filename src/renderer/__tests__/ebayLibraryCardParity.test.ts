import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 线上产品卡镜像本地产品卡：图盒（无评分 chip，线上无 GIGA 数据源不伪造）、标题、USD＋RMB 价格对、
 * 事实行 dl（仅线上真字段）、⋮ 菜单保留原方式（原商品入口移入菜单不丢功能）。
 */
const app = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const start = app.indexOf('{visibleListings.map(item=>')
const end = app.indexOf('{visibleLocalProducts.map(product=>')
const body = app.slice(start, end)

describe('线上产品卡 · 镜像本地卡样式与内容', () => {
  it('价格对复用本地卡 price-row 与汇率口径', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('className="ebay-local-price-row"')
    expect(body).toContain('ebayDisplayPrice(item.currency,item.price)')
    expect(body).toContain('readEbayProfitAssumptions(item.id).exchangeRate')
  })
  it('事实行 dl 仅线上真字段：Item ID/可售库存/店铺类目/在架状态/更新时间/中文标题', () => {
    expect(body).toContain('className="candidate-source-facts"')
    for (const label of ['Item ID', '可售库存', '店铺类目', '在架状态', '更新时间', '中文标题']) expect(body).toContain(`<dt>${label}</dt>`)
    expect(body).toContain("item.status==='ACTIVE'?'在售':'已结束'")
    expect(body).toContain('item.translatedTitle')
  })
  it('不伪造货盘字段与评分 chip', () => {
    expect(body).not.toContain('原货盘')
    expect(body).not.toContain('GIGA Index')
    expect(body).not.toContain('score-badge')
  })
  it('图盒改本地卡同构 button（开原商品），去掉覆盖文案链接', () => {
    expect(body).toContain('className="ebay-market-card-media"')
    expect(body).toContain('onClick={()=>void openOriginalProduct(item)}')
    expect(body).not.toContain('ebay-market-card-image-link')
    expect(body).not.toContain('查看原商品 ↗')
  })
  it('⋮ 菜单保留：summary/站点/下载/删除不动，原商品入口入菜单', () => {
    expect(body).toContain('<details className="ebay-card-menu">')
    expect(body).toContain('<summary aria-label={`打开 ${item.title} 的操作菜单`}>⋮</summary>')
    expect(body).toContain('ebay-card-menu-site')
    expect(body).toContain('void downloadLocalProduct(item)')
    expect(body).toContain('void removeLocalListing(item)')
    expect(body).toContain('onClick={()=>void openOriginalProduct(item)}>原商品 ↗</button>')
  })
})