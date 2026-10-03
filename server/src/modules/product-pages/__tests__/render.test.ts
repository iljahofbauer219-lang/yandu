import { describe, expect, it } from 'vitest'
import { renderProductPageDocument, type ProductPageMetaView } from '../render.js'

function meta(overrides: Partial<ProductPageMetaView> = {}): ProductPageMetaView {
  return {
    title: 'Manaul Folding Scooter M2085',
    price: '$2300.00',
    specs: [{ key: '物流费', value: '$43.05 /件' }, { key: 'GIGA Index', value: '64.1' }],
    images: [{ name: '01.jpg', contentType: 'image/jpeg' }, { name: '02.png', contentType: 'image/png' }],
    sourceUrl: 'https://www.gigab2b.com/index.php?route=product/product&product_id=834576',
    finalUrl: 'https://www.gigab2b.com/index.php?route=product/product&product_id=834576',
    warehouseCode: 'GIGACLOUD',
    capturedAt: '2026-10-03T00:00:00.000Z',
    ...overrides
  }
}

describe('renderProductPageDocument', () => {
  it('多图渲染 CSS-only 画廊：每张图一个 radio 与缩略图，首图默认选中', () => {
    const html = renderProductPageDocument('page-1', meta())
    expect(html.match(/<input type="radio" name="pp-g"/g)).toHaveLength(2)
    expect(html).toContain('id="pp-g-1" checked')
    expect(html).toContain('id="pp-g-2"')
    expect(html.match(/class="pp-shot pp-shot-\d+"/g)).toHaveLength(2)
    expect(html.match(/<label for="pp-g-\d+"/g)).toHaveLength(2)
    expect(html).toContain('assets/01.jpg')
    expect(html).toContain('assets/02.png')
    expect(html).toContain('#pp-g-1:checked ~ .pp-stage .pp-shot{display:none}')
    expect(html).toContain('#pp-g-1:checked ~ .pp-stage .pp-shot-1{display:block}')
  })

  it('单图不输出 radio，直接展示主图', () => {
    const html = renderProductPageDocument('page-1', meta({ images: [{ name: '01.jpg', contentType: 'image/jpeg' }] }))
    expect(html).not.toContain('type="radio"')
    expect(html.match(/<img class="pp-shot/g)).toHaveLength(1)
  })

  it('无图时画廊降级为占位提示', () => {
    const html = renderProductPageDocument('page-1', meta({ images: [] }))
    expect(html).toContain('pp-gallery-empty')
  })

  it('参数行按 key/value 对齐渲染并转义', () => {
    const html = renderProductPageDocument('page-1', meta({ specs: [{ key: '<b>物流费</b>', value: '"$43" & more' }] }))
    expect(html).toContain('<th scope="row">&lt;b&gt;物流费&lt;/b&gt;</th>')
    expect(html).toContain('&quot;$43&quot; &amp; more')
  })

  it('标题转义，杜绝注入', () => {
    const html = renderProductPageDocument('page-1', meta({ title: '<script>alert(1)</script>"x"' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('缺价格/参数/来源时对应区块优雅降级', () => {
    const html = renderProductPageDocument('page-1', meta({ price: '', specs: [], sourceUrl: '', finalUrl: '' }))
    expect(html).not.toContain('class="pp-price"')
    expect(html).not.toContain('class="pp-specs"')
    expect(html).not.toContain('class="pp-source-link"')
  })

  it('来源链接优先 finalUrl，且带 nofollow', () => {
    const html = renderProductPageDocument('page-1', meta({ finalUrl: 'https://final.example/p' }))
    expect(html).toContain('class="pp-source-link" href="https://final.example/p" rel="nofollow noopener noreferrer"')
  })

  it('文档含 base href 与内联样式，且不含任何 script', () => {
    const html = renderProductPageDocument('page-1', meta())
    expect(html).toContain('<base href="/product-pages/page-1/">')
    expect(html).toContain('<style>')
    expect(html).not.toContain('<script')
  })

  it('17 要素扩展字段分区渲染：徽章/费用/库存时效/素材包/文件/视频/图文描述', () => {
    const html = renderProductPageDocument('page-1', meta({
      category: '首页 / 汽车配件与运输 / 电动代步车',
      itemCode: 'W2923P220458',
      firstStockAt: '2024-10-10',
      returnRate: '低',
      sellableInventory: '60',
      unitPrice: '$2300.00',
      packingFee: '$3.16 /件',
      freightFee: '$39.89 /件',
      shippingFee: '$43.05 /件',
      estimatedTotal: '$2343.05 /件',
      dropshipLeadTime: '1-3个工作日',
      gigaIndex: '64.10',
      materialPackUrl: 'https://www.gigab2b.com/material.zip',
      materialPackDownloads: '352',
      videos: [{ name: 'v-01.mp4', contentType: 'video/mp4' }],
      files: [{ name: 'K240272 (2085_2091).pdf', url: 'https://www.gigab2b.com/f.pdf' }],
      descriptionText: 'The M2085 Blue\nfoldable design',
      descriptionImages: [{ name: 'd-01.jpg', contentType: 'image/jpeg' }]
    }))
    expect(html).toContain('首页 / 汽车配件与运输 / 电动代步车')
    expect(html).toContain('Item Code')
    expect(html).toContain('W2923P220458')
    expect(html).toContain('首次到库')
    expect(html).toContain('退返品率')
    expect(html).toContain('可售库存')
    expect(html).toContain('64.10')
    expect(html).toContain('单价(件)')
    expect(html).toContain('打包费')
    expect(html).toContain('运费')
    expect(html).toContain('物流费')
    expect(html).toContain('预估总额(含物流费)')
    expect(html).toContain('1-3个工作日')
    expect(html).toContain('下载素材包')
    expect(html).toContain('352')
    expect(html).toContain('assets/v-01.mp4')
    expect(html).toContain('assets/d-01.jpg')
    expect(html).toContain('图文描述')
    expect(html).toContain('K240272 (2085_2091).pdf')
    expect(html).toContain('foldable design')
  })

  it('扩展字段缺失时新分区整体降级不渲染', () => {
    const html = renderProductPageDocument('page-1', meta())
    expect(html).not.toContain('class="pp-badges"')
    expect(html).not.toContain('class="pp-specs pp-fees"')
    expect(html).not.toContain('class="pp-desc"')
    expect(html).not.toContain('class="pp-videos"')
    expect(html).not.toContain('class="pp-files"')
    expect(html).not.toContain('class="pp-category"')
  })
})
