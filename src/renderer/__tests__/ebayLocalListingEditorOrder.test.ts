import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 分区顺序的唯一真值源是 eBay 现网修改页（2026-11-08 取证，见 ~/.yandu-acceptance/2026-11-08-A4/O3-ebay-section-order.json）：
 *   Photos & Video → Title → Item category → Item specifics → Condition → Description → Pricing → Shipping
 * APP 编辑器把自家卡片一一对上去（政策卡不拆，整卡落在 Pricing 之后对应 Shipping 位），
 * 用户要拿两栏逐段对照，顺序漂了对照就失效，所以这里按源码出现顺序锁死 h2 序列。
 */
const source = readFileSync(path.join(__dirname, '..', 'EbayLocalListingEditor.tsx'), 'utf8')
// 组件名在文件顶部有 import，顺序断言必须只看 <main> 之后的 JSX 正文
const body = source.slice(source.indexOf('<main'))

const h2Sequence = () => [...body.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1].trim())

describe('本地产品编辑器 · 分区顺序对齐 eBay 现网修改页', () => {
  it('h2 序列与 eBay 真页分段一一对应（图片→标题→类目→类目属性→状况→描述→定价→政策）', () => {
    expect(h2Sequence()).toEqual([
      '01 图片与视频',
      '02 标题',
      '03 类目',
      '04 类目属性',
      '05 状况与库存',
      '06 描述',
      '07 定价',
      '08 政策与所在地'
    ])
  })

  it('类目段内 eBay 平台类目在前、店铺类目在后（eBay 的 Item category 段里 categoryId 先于 primaryStoreCategoryId）', () => {
    const platform = body.indexOf('CustomCategoryDropdown')
    const store = body.indexOf('aria-label="本地产品类目"')
    expect(platform).toBeGreaterThan(-1)
    expect(store).toBeGreaterThan(platform)
  })

  it('类目属性独立成段且落在状况与库存之前（eBay 的 Item specifics 先于 Condition）', () => {
    const specifics = body.indexOf('id="ebay-revise-specifics"')
    const condition = body.indexOf('id="ebay-revise-form"')
    expect(specifics).toBeGreaterThan(-1)
    expect(specifics).toBeLessThan(condition)
  })

  it('检查明细的跳转锚点一个不少（重排不得丢 id）', () => {
    for (const id of ['ebay-revise-media', 'ebay-revise-title', 'ebay-revise-specifics', 'ebay-revise-form', 'ebay-revise-description', 'ebay-revise-pricing', 'ebay-revise-policies']) {
      expect(source).toContain(`id="${id}"`)
    }
  })
})
