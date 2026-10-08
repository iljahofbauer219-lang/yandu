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
      features: ['【True Foldable, No Need to Disassemble】 The elderly motorized scooter can be folded in 2 steps.', '【Full Foldable While Steady】 The M2085 has innovative way of folding.'],
      specs: [
        { key: '产品类型', value: 'Single Box Product' }, { key: '颜色', value: 'Blue' },
        { key: '组装长度 (英寸)', value: '38.43' }, { key: '产品重量 (磅)', value: '52.03' },
        { key: '长度 (英寸)', value: '40.75' }, { key: '重量 (磅)', value: '63.00' }
      ],
      descriptionText: '图文描述\nThe M2085 Blue\nfoldable design with a very long sentence that exceeds forty characters so it stays a paragraph.\n• Delta tiller with ergonomic wraparound handles lets you operate the scooter with one hand.',
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
    expect(html.indexOf('class="pp-left"')).toBeGreaterThan(-1)
    expect(html.indexOf('class="pp-videos"')).toBeLessThan(html.indexOf('class="pp-info"'))
    // 三大版块整宽且按原站顺序：产品规格 → 产品特点 → 图文描述；规格不在右栏内
    const idxInfo = html.indexOf('class="pp-info"')
    const idxSpec = html.indexOf('>产品规格<')
    const idxFeat = html.indexOf('>产品特点<')
    const idxDesc = html.indexOf('<b>图文描述</b>')
    expect(idxSpec).toBeGreaterThan(idxInfo)
    expect(idxSpec).toBeLessThan(idxFeat)
    expect(idxFeat).toBeLessThan(idxDesc)
    // 规格三组+三列网格（对照原站图1）
    expect(html).toContain('class="pp-spec-groups"')
    expect(html).toContain('>基础信息<')
    expect(html).toContain('>产品尺寸<')
    expect(html).toContain('>包装尺寸<')
    expect(html).toContain('class="pp-spec-grid"')
    // 产品特点 bullets（对照原站图2）
    expect(html).toContain('class="pp-desc pp-features"')
    expect(html).toContain('<li>【True Foldable, No Need to Disassemble】 The elderly motorized scooter can be folded in 2 steps.</li>')
    // 描述结构化：子标题加粗、长句成段、bullet 归列表、重复标题剥离
    expect(html).toContain('<h4>The M2085 Blue</h4>')
    expect(html).toContain('<li>Delta tiller with ergonomic wraparound handles lets you operate the scooter with one hand.</li>')
    expect(html).not.toContain('<p>图文描述</p>')
    expect(html).not.toContain('<h4>图文描述</h4>')
  })

  it('规格无尺寸键时回退扁平表格（历史 meta 零回归）', () => {
    const html = renderProductPageDocument('page-1', meta())
    expect(html).toContain('>产品规格<')
    expect(html).toContain('<table class="pp-specs">')
    expect(html).not.toContain('class="pp-spec-groups"')
    expect(html).not.toContain('class="pp-desc pp-features"')
  })

  it('descriptionFlow 文图穿插渲染，历史 meta 回退先文后图', () => {
    const html = renderProductPageDocument('page-1', meta({
      descriptionText: '图文描述\nFLOW-BEFORE paragraph',
      descriptionImages: [{ name: 'd-01.jpg', contentType: 'image/jpeg' }],
      descriptionFlow: [
        { kind: 't', text: 'FLOW-BEFORE paragraph' },
        { kind: 'img', i: 0 },
        { kind: 't', text: 'FLOW-AFTER paragraph with enough length to stay a paragraph.' }
      ]
    }))
    const iBefore = html.indexOf('FLOW-BEFORE paragraph')
    const iImg = html.indexOf('assets/d-01.jpg')
    const iAfter = html.indexOf('FLOW-AFTER paragraph')
    expect(iBefore).toBeGreaterThan(-1)
    expect(iBefore).toBeLessThan(iImg)
    expect(iImg).toBeLessThan(iAfter)
    const legacy = renderProductPageDocument('page-2', meta({ descriptionText: 'LEGACY paragraph', descriptionImages: [{ name: 'd-09.jpg', contentType: 'image/jpeg' }] }))
    expect(legacy.indexOf('LEGACY paragraph')).toBeLessThan(legacy.indexOf('assets/d-09.jpg'))
  })

  it('descriptionFlow 表格块按原站边框表渲染：两列键值灰底、多列不着色、空表降级、单元格转义', () => {
    const html = renderProductPageDocument('page-1', meta({
      descriptionText: '图文描述\nProduct Details',
      descriptionFlow: [
        { kind: 't', text: 'Product Details' },
        { kind: 'tbl', rows: [['Bike Type', '20 Inch Electric Cargo Tricycle'], ['Rider Height', 'fits height 5\'2"-6\'5"']] },
        { kind: 't', text: 'MULTI-COLUMN TABLE FOLLOWS' },
        { kind: 'tbl', rows: [['A', 'B', 'C'], ['D', 'E', 'F']] },
        { kind: 'tbl', rows: [] }
      ]
    }))
    const iKv = html.indexOf('<table class="pp-desc-table pp-desc-table--kv">')
    expect(iKv).toBeGreaterThan(-1)
    expect(html).toContain('<td>Bike Type</td><td>20 Inch Electric Cargo Tricycle</td>')
    expect(html).toContain('<td>fits height 5\'2&quot;-6\'5&quot;</td>')
    const iMulti = html.indexOf('<table class="pp-desc-table">')
    expect(iMulti).toBeGreaterThan(iKv)
    expect(html.indexOf('MULTI-COLUMN TABLE FOLLOWS')).toBeLessThan(iMulti)
    expect(html.slice(iMulti)).toContain('<td>A</td><td>B</td><td>C</td>')
    expect(html.match(/<table class="pp-desc-table/g)).toHaveLength(2)
    expect(html).toContain('.pp-desc-table--kv td:first-child{background:#f7f7f5')
  })

  it('自托管文件/素材包渲染 download 直链，源站直链不加', () => {
    const html = renderProductPageDocument('page-1', meta({
      materialPackUrl: 'assets/m-01.zip',
      materialPackDownloads: '352',
      files: [
        { name: 'K240272.pdf', url: 'assets/f-01.pdf', label: 'Medicare/HCPCS Code' },
        { name: 'remote.pdf', url: 'https://www.gigab2b.com/x.pdf' }
      ]
    }))
    expect(html).toContain('<a href="assets/f-01.pdf" download rel="nofollow noopener noreferrer">K240272.pdf</a>')
    expect(html).toContain('href="assets/m-01.zip" download rel="nofollow noopener noreferrer">下载素材包（352） ↗</a>')
    expect(html).toContain('<a href="https://www.gigab2b.com/x.pdf" rel="nofollow noopener noreferrer">remote.pdf</a>')
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

  it('源站无链接时素材包/文件降级为提示与纯文件名，不产生空 href', () => {
    const html = renderProductPageDocument('page-1', meta({
      materialPackUrl: '',
      materialPackDownloads: '352',
      files: [{ name: '2085 disassembly video.txt', url: '', label: '安装视频' }]
    }))
    expect(html).toContain('class="pp-material-note"')
    expect(html).toContain('352')
    expect(html).toContain('素材包需在原站登录后下载')
    expect(html).toContain('class="pp-file-plain">2085 disassembly video.txt')
    expect(html).toContain('安装视频')
    expect(html).toContain('文件链接需在原站登录后获取')
    expect(html).not.toContain('<a href=""')
  })
})
