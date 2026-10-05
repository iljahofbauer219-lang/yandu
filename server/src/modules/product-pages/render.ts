/**
 * 公开详情页模板渲染：源页 HTML 含整站导航/搜索外框且外链样式被 CSP 阻断，直接回源片段必然塌陷，
 * 故改为按 meta.json 结构化字段 + assets 图片序列渲染整洁版面（左画廊 / 右信息列 / 参数行对齐）。
 * 画廊交互用 radio + 兄弟选择器实现（CSP script-src 'none'，全页零 JS）。
 */
export interface ProductPageMetaView {
  title: string
  price: string
  specs: Array<{ key: string; value: string }>
  images: Array<{ name: string; contentType: string }>
  sourceUrl: string
  finalUrl: string
  warehouseCode: string
  capturedAt: string
  category?: string
  itemCode?: string
  firstStockAt?: string
  returnRate?: string
  sellableInventory?: string
  unitPrice?: string
  packingFee?: string
  freightFee?: string
  shippingFee?: string
  estimatedTotal?: string
  dropshipLeadTime?: string
  gigaIndex?: string
  materialPackUrl?: string
  materialPackDownloads?: string
  videos?: Array<{ name: string; contentType: string }>
  files?: Array<{ name: string; url: string; label?: string }>
  features?: string[]
  descriptionText?: string
  descriptionImages?: Array<{ name: string; contentType: string }>
  descriptionFlow?: Array<{ kind: 't' | 'img'; text?: string; i?: number }>
}

const WAREHOUSE_NAMES: Record<string, string> = { GIGACLOUD: '大健云仓', '1688': '1688' }

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function galleryCss(imageCount: number): string {
  let css = ''
  for (let index = 1; index <= imageCount; index += 1) {
    css += `#pp-g-${index}:checked ~ .pp-stage .pp-shot{display:none}`
    css += `#pp-g-${index}:checked ~ .pp-stage .pp-shot-${index}{display:block}`
    css += `#pp-g-${index}:checked ~ .pp-thumbs label[for="pp-g-${index}"]{border-color:#e64a19;box-shadow:0 0 0 2px rgba(230,74,25,.18)}`
  }
  return css
}

function renderGallery(images: ProductPageMetaView['images'], title: string): string {
  if (!images.length) return '<section class="pp-gallery"><div class="pp-gallery-empty">暂无商品图片</div></section>'
  if (images.length === 1) {
    const only = images[0]
    if (only) {
      return `<section class="pp-gallery"><div class="pp-stage"><img class="pp-shot" src="assets/${escapeHtmlText(only.name)}" alt="${escapeHtmlText(title)}"></div></section>`
    }
  }
  const radios = images.map((image, index) => `<input type="radio" name="pp-g" id="pp-g-${index + 1}"${index === 0 ? ' checked' : ''}>`).join('')
  const shots = images.map((image, index) => `<img class="pp-shot pp-shot-${index + 1}" src="assets/${escapeHtmlText(image.name)}" alt="${escapeHtmlText(title)} ${index + 1}">`).join('')
  const thumbs = images.map((image, index) => `<label for="pp-g-${index + 1}"><img src="assets/${escapeHtmlText(image.name)}" alt=""></label>`).join('')
  return `<section class="pp-gallery">${radios}<div class="pp-stage">${shots}</div><div class="pp-thumbs">${thumbs}</div></section>`
}

export function renderProductPageDocument(pageId: string, meta: ProductPageMetaView): string {
  const title = meta.title.trim() || '产品详情页'
  const warehouseName = WAREHOUSE_NAMES[meta.warehouseCode] || meta.warehouseCode || '货源仓'
  const sourceUrl = meta.finalUrl.trim() || meta.sourceUrl.trim()
  const capturedAt = meta.capturedAt ? new Date(meta.capturedAt).toLocaleString('zh-CN', { hour12: false }) : ''
  const gallery = renderGallery(meta.images, title)
  const priceBlock = meta.price.trim() ? `<div class="pp-price"><small>单价</small><strong>${escapeHtmlText(meta.price.trim())}</strong></div>` : ''
  // 规格按原站三组还原（基础信息/产品尺寸/包装尺寸）：三列 key: value 网格+虚线分隔；
  // 历史 meta 无尺寸键时启发式命中 0 组，回退扁平表格保证零回归
  const isDimKey = (key: string): boolean => /^组装/.test(key) || /^产品重量/.test(key)
  const isPackKey = (key: string): boolean => /^(长度|宽度|高度|重量)\s*[（(]/.test(key)
  const dimRows = meta.specs.filter(spec => isDimKey(spec.key))
  const packRows = meta.specs.filter(spec => isPackKey(spec.key))
  const baseRows = meta.specs.filter(spec => !isDimKey(spec.key) && !isPackKey(spec.key))
  const specGroups = dimRows.length || packRows.length
    ? [{ title: '基础信息', rows: baseRows }, { title: '产品尺寸', rows: dimRows }, { title: '包装尺寸', rows: packRows }].filter(group => group.rows.length)
    : []
  const specsTable = specGroups.length
    ? `<div class="pp-spec-groups">${specGroups.map(group => `<section class="pp-spec-group"><b>${escapeHtmlText(group.title)}</b><div class="pp-spec-grid">${group.rows.map(spec => `<div><span>${escapeHtmlText(spec.key)}:</span>${escapeHtmlText(spec.value)}</div>`).join('')}</div></section>`).join('')}</div>`
    : (meta.specs.length
        ? `<table class="pp-specs"><tbody>${meta.specs.map(spec => `<tr><th scope="row">${escapeHtmlText(spec.key)}</th><td>${escapeHtmlText(spec.value)}</td></tr>`).join('')}</tbody></table>`
        : '')
  // 原站三大版块顺序：产品规格 → 产品特点 → 图文描述，均为整宽版块
  const specsSection = specsTable
    ? `<section class="pp-desc pp-spec-section"><b>产品规格</b>${specsTable}</section>`
    : ''
  const sourceLink = sourceUrl
    ? `<a class="pp-source-link" href="${escapeHtmlText(sourceUrl)}" rel="nofollow noopener noreferrer">查看原址 ↗</a>`
    : ''
  const category = meta.category ?? ''
  const itemCode = meta.itemCode ?? ''
  const firstStockAt = meta.firstStockAt ?? ''
  const returnRate = meta.returnRate ?? ''
  const sellableInventory = meta.sellableInventory ?? ''
  const dropshipLeadTime = meta.dropshipLeadTime ?? ''
  const unitPrice = meta.unitPrice ?? ''
  const packingFee = meta.packingFee ?? ''
  const freightFee = meta.freightFee ?? ''
  const shippingFee = meta.shippingFee ?? ''
  const estimatedTotal = meta.estimatedTotal ?? ''
  const gigaIndex = meta.gigaIndex ?? ''
  const materialPackUrl = meta.materialPackUrl ?? ''
  const materialPackDownloads = meta.materialPackDownloads ?? ''
  const videos = meta.videos ?? []
  const files = meta.files ?? []
  const descriptionText = meta.descriptionText ?? ''
  const descriptionImages = meta.descriptionImages ?? []
  const badge = (label: string, value: string): string =>
    value.trim() ? `<span class="pp-badge"><small>${escapeHtmlText(label)}</small><b>${escapeHtmlText(value.trim())}</b></span>` : ''
  const categoryLine = category.trim() ? `<div class="pp-category">${escapeHtmlText(category.trim())}</div>` : ''
  const badges = [badge('Item Code', itemCode), badge('首次到库', firstStockAt), badge('退返品率', returnRate), badge('GIGA Index', gigaIndex)].join('')
  const stockBadges = [badge('可售库存', sellableInventory), badge('一件代发时效', dropshipLeadTime)].join('')
  const feeRows: Array<[string, string]> = [
    ['单价(件)', unitPrice], ['打包费', packingFee], ['运费', freightFee],
    ['物流费', shippingFee], ['预估总额(含物流费)', estimatedTotal]
  ]
  const feesTable = feeRows.some(([, value]) => value.trim())
    ? `<table class="pp-specs pp-fees"><tbody>${feeRows.filter(([, value]) => value.trim()).map(([key, value]) => `<tr><th scope="row">${escapeHtmlText(key)}</th><td>${escapeHtmlText(value.trim())}</td></tr>`).join('')}</tbody></table>`
    : ''
  // 素材包/文件的真实下载链接需源站登录态点击才生成，抓不到时降级为「次数 + 原站提示」而非整块消失
  const materialLink = materialPackUrl.trim()
    ? `<a class="pp-source-link pp-material" href="${escapeHtmlText(materialPackUrl.trim())}"${materialPackUrl.trim().startsWith('assets/') ? ' download' : ''} rel="nofollow noopener noreferrer">下载素材包${materialPackDownloads.trim() ? `（${escapeHtmlText(materialPackDownloads.trim())}）` : ''} ↗</a>`
    : (materialPackDownloads.trim()
        ? `<div class="pp-material-note">下载素材包：已被下载 <b>${escapeHtmlText(materialPackDownloads.trim())}</b> 次<span>素材包需在原站登录后下载，可点右上「查看原址」前往</span></div>`
        : '')
  const fileItem = (file: { name: string; url: string; label?: string }): string => {
    const label = (file.label ?? '').trim()
    const prefix = label ? `<small>${escapeHtmlText(label)}</small>` : ''
    if (!file.url.trim()) return `<li>${prefix}<span class="pp-file-plain">${escapeHtmlText(file.name)}</span></li>`
    // 自托管资产加 download 直链下载（免登录）；源站直链保持新窗打开
    const downloadAttr = file.url.trim().startsWith('assets/') ? ' download' : ''
    return `<li>${prefix}<a href="${escapeHtmlText(file.url.trim())}"${downloadAttr} rel="nofollow noopener noreferrer">${escapeHtmlText(file.name)}</a></li>`
  }
  const filesBlock = files.length
    ? `<div class="pp-files"><b>文件</b><ul>${files.map(fileItem).join('')}</ul>${files.some(file => !file.url.trim()) ? '<p class="pp-files-note">文件链接需在原站登录后获取，可点右上「查看原址」前往下载</p>' : ''}</div>`
    : ''
  const videosBlock = videos.length
    ? `<div class="pp-videos">${videos.map(video => `<video controls preload="metadata" src="assets/${escapeHtmlText(video.name)}"></video>`).join('')}</div>`
    : ''
  // 描述结构化：flow 存在时按文档序文图穿插（原排原渲）；历史 meta 无 flow 回退「先文后图」
  const classifyLine = (line: string): { type: 'li' | 'h' | 'p'; text: string } => {
    if (/^[•·\-－]/.test(line) || /^【.+】/.test(line)) return { type: 'li', text: line.replace(/^[•·\-－]\s*/, '') }
    if (line.length <= 40 && !/[。.！!？?；;]$/.test(line)) return { type: 'h', text: line }
    return { type: 'p', text: line }
  }
  const descImages = (meta.descriptionImages ?? []).map(image => image.name)
  const flowBlocks = (meta.descriptionFlow ?? []).filter(block => (block.kind === 'img' ? !!descImages[block.i ?? -1] : !!((block.text ?? '').trim()) && (block.text ?? '').trim() !== '图文描述'))
  const renderBlocks = (blocks: Array<{ type: 'li' | 'h' | 'p' | 'img'; text: string }>): string => {
    let out = ''
    let list: string[] = []
    const flushList = (): void => {
      if (list.length) {
        out += `<ul>${list.map(item => `<li>${escapeHtmlText(item)}</li>`).join('')}</ul>`
        list = []
      }
    }
    for (const block of blocks) {
      if (block.type === 'img') {
        flushList()
        out += `<div class="pp-desc-images"><img src="assets/${escapeHtmlText(block.text)}" alt=""></div>`
        continue
      }
      const classified = classifyLine(block.text)
      if (classified.type === 'li') {
        list.push(classified.text)
        continue
      }
      flushList()
      out += classified.type === 'h' ? `<h4>${escapeHtmlText(classified.text)}</h4>` : `<p>${escapeHtmlText(classified.text)}</p>`
    }
    flushList()
    return out
  }
  const imagesGrid = (names: string[]): string => (names.length ? `<div class="pp-desc-images">${names.map(name => `<img src="assets/${escapeHtmlText(name)}" alt="">`).join('')}</div>` : '')
  const referencedIdx = new Set(flowBlocks.filter(block => block.kind === 'img').map(block => block.i ?? -1))
  const legacyLines = descriptionText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (legacyLines[0] === '图文描述') legacyLines.shift()
  const descBody = flowBlocks.length
    ? renderBlocks(flowBlocks.map(block => (block.kind === 'img' ? { type: 'img' as const, text: descImages[block.i ?? -1] ?? '' } : { type: 'p' as const, text: (block.text ?? '').trim() })))
    : renderBlocks(legacyLines.map(line => ({ type: 'p' as const, text: line })))
  const descTail = flowBlocks.length ? imagesGrid(descImages.filter((_, idx) => !referencedIdx.has(idx))) : imagesGrid(descImages)
  const features = meta.features ?? []
  const featuresBlock = features.length
    ? `<section class="pp-desc pp-features"><b>产品特点</b><ul>${features.map(feature => `<li>${escapeHtmlText(feature)}</li>`).join('')}</ul></section>`
    : ''
  const descBlock = descriptionText.trim() || descImages.length
    ? `<section class="pp-desc"><b>图文描述</b>${descBody}${descTail}</section>`
    : ''
  const style = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;color:#222;background:#f6f6f4}
.pp-wrap{max-width:1180px;margin:0 auto;padding:24px 20px 48px}
.pp-topbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;background:#fff;border:1px solid #e8e8e6;border-radius:10px;margin-bottom:16px}
.pp-topbar .pp-org{font-weight:600;color:#e64a19}
.pp-topbar .pp-time{color:#888;font-size:12px}
.pp-topbar .pp-source-link{margin-left:auto;color:#0b7285;text-decoration:none;font-size:13px}
.pp-main{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:20px;align-items:start}
.pp-left{min-width:0;display:grid;gap:16px;align-content:start}
.pp-left .pp-videos{margin-top:0}
@media (max-width:900px){.pp-main{grid-template-columns:1fr}}
.pp-gallery,.pp-info{background:#fff;border:1px solid #e8e8e6;border-radius:10px;padding:18px}
.pp-gallery input{position:absolute;opacity:0;pointer-events:none}
.pp-stage{background:#fafaf8;border-radius:8px;min-height:320px;display:flex;align-items:center;justify-content:center}
.pp-shot{display:none;max-width:100%;max-height:560px;object-fit:contain}
.pp-gallery .pp-shot:only-child{display:block}
.pp-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-top:12px}
.pp-thumbs label{display:block;border:2px solid transparent;border-radius:6px;overflow:hidden;cursor:pointer;background:#fafaf8}
.pp-thumbs img{display:block;width:100%;height:72px;object-fit:cover}
.pp-gallery-empty{padding:60px 0;text-align:center;color:#999}
.pp-info h1{font-size:20px;line-height:1.45;font-weight:600;margin-bottom:14px}
.pp-price{background:#fff6f2;border:1px solid #ffd9c9;border-radius:8px;padding:12px 14px;margin-bottom:16px}
.pp-price small{display:block;color:#a06a4f;font-size:12px;margin-bottom:2px}
.pp-price strong{font-size:26px;color:#e64a19;letter-spacing:.3px}
.pp-specs{width:100%;border-collapse:collapse;font-size:13px}
.pp-specs th,.pp-specs td{border-bottom:1px solid #efefec;padding:8px 10px;text-align:left;vertical-align:top;word-break:break-word}
.pp-specs th{width:38%;color:#666;font-weight:500;background:#fafaf8}
.pp-specs tr:nth-child(even) td{background:#fcfcfa}
.pp-foot{margin-top:18px;color:#999;font-size:12px;text-align:center}
.pp-category{color:#888;font-size:12px;margin-bottom:6px}
.pp-badges{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.pp-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #e8e8e6;border-radius:8px;background:#fafaf8}
.pp-badge small{color:#888;font-size:11px}
.pp-badge b{color:#222;font-size:12px;font-weight:600}
.pp-fees td{color:#e64a19;font-weight:600}
.pp-material{display:inline-block;margin:12px 0 0}
.pp-material-note{margin-top:12px;padding:10px 12px;border:1px solid #ffe0b2;border-radius:8px;background:#fffaf0;font-size:13px;color:#8a6d3b}
.pp-material-note b{color:#e64a19}
.pp-material-note span{display:block;color:#a58a68;font-size:12px;margin-top:2px}
.pp-files{margin-top:14px}
.pp-files b{display:block;font-size:13px;color:#666;margin-bottom:6px}
.pp-files ul{list-style:none;display:flex;flex-wrap:wrap;gap:8px}
.pp-files li{display:inline-flex;align-items:center;gap:6px}
.pp-files li small{color:#888;font-size:11px}
.pp-files a{color:#0b7285;text-decoration:none;font-size:13px;border:1px solid #d9eef2;border-radius:8px;padding:4px 10px;background:#f4fbfc}
.pp-file-plain{color:#0b7285;font-size:13px;border:1px dashed #cfe6ea;border-radius:8px;padding:4px 10px;background:#f8fcfd}
.pp-files-note{margin-top:8px;color:#999;font-size:12px}
.pp-videos{margin-top:16px;display:grid;gap:12px}
.pp-videos video{width:100%;max-height:480px;background:#000;border-radius:10px}
.pp-desc{margin-top:16px;background:#fff;border:1px solid #e8e8e6;border-radius:10px;padding:18px}
.pp-desc>b{display:block;font-size:20px;font-weight:700;color:#111;margin-bottom:14px}
.pp-desc p{color:#444;margin-bottom:10px;white-space:pre-wrap}
.pp-desc h4{font-size:14px;font-weight:600;color:#222;margin:12px 0 6px}
.pp-desc ul{margin:0 0 10px;padding-left:18px}
.pp-desc li{color:#444;margin-bottom:6px}
.pp-spec-groups{width:100%}
.pp-spec-group{padding:14px 0;border-bottom:1px dashed #e5e5e5}
.pp-spec-group:last-child{border-bottom:0;padding-bottom:0}
.pp-spec-group>b{display:block;font-size:15px;font-weight:700;color:#222;margin-bottom:10px}
.pp-spec-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 40px;align-items:start}
.pp-spec-grid>div{font-size:14px;color:#333;word-break:break-word}
.pp-spec-grid>div span{color:#888;margin-right:6px}
@media (max-width:1200px){.pp-spec-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){.pp-spec-grid{grid-template-columns:1fr}}
.pp-desc-images{display:grid;gap:10px}
.pp-desc-images img{width:100%;border-radius:8px}
${galleryCss(meta.images.length)}
</style>`
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escapeHtmlText(title)}</title>`
    + `<base href="/product-pages/${encodeURIComponent(pageId)}/">`
    + `${style}</head><body><div class="pp-wrap">`
    + `<div class="pp-topbar"><span class="pp-org">${escapeHtmlText(warehouseName)}</span>`
    + `${capturedAt ? `<span class="pp-time">采集于 ${escapeHtmlText(capturedAt)}</span>` : ''}${sourceLink}</div>`
    + `<div class="pp-main"><div class="pp-left">${gallery}${videosBlock}</div><div class="pp-info">${categoryLine}<h1>${escapeHtmlText(title)}</h1>${badges ? `<div class="pp-badges">${badges}</div>` : ''}${priceBlock}${feesTable}${stockBadges ? `<div class="pp-badges">${stockBadges}</div>` : ''}${materialLink}${filesBlock}</div></div>`
    + `${specsSection}${featuresBlock}${descBlock}`
    + `<p class="pp-foot">本页面由砚都跨境自动采集生成，仅供内部选品参考；图片与内容版权归原站点所有。</p>`
    + `</div></body></html>`
}
