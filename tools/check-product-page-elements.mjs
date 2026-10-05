#!/usr/bin/env node
/** 公开产品页 17 要素线上核对：node tools/check-product-page-elements.mjs [pageUrlOrId] */
const target = process.argv[2] || 'cq4JT9KtymqJQBNN'
const url = /^https?:\/\//i.test(target) ? target : `http://114.55.149.192/product-pages/${target}`
const MARKERS = [
  ['产品分类', 'class="pp-category"'],
  ['徽章组(Item Code等)', 'class="pp-badges"'],
  ['Item Code', 'Item Code'],
  ['首次到库', '首次到库'],
  ['退返品率', '退返品率'],
  ['可售库存', '可售库存'],
  ['一件代发时效', '一件代发时效'],
  ['GIGA Index', 'GIGA Index'],
  ['单价(件)', '单价(件)'],
  ['打包费', '打包费'],
  ['运费', '>运费<'],
  ['物流费', '物流费'],
  ['预估总额', '预估总额(含物流费)'],
  ['下载素材包', '下载素材包'],
  ['素材包链接或降级提示', 'pp-material'],
  ['文件区', 'class="pp-files"'],
  ['产品规格表', ['class="pp-spec-groups"', '<table class="pp-specs">']],
  ['图文描述', '图文描述'],
  ['描述图', 'pp-desc-images'],
  ['视频', '<video'],
  ['画廊主图', 'pp-shot'],
  ['单价价格块', 'class="pp-price"']
]
const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
const html = await response.text()
const missing = []
for (const [label, marker] of MARKERS) {
  const tokens = Array.isArray(marker) ? marker : [marker]
  const hit = tokens.some(token => html.includes(token))
  console.log(`${hit ? 'OK  ' : 'MISS'} ${label} (${tokens.join(' | ')})`)
  if (!hit) missing.push(label)
}
console.log(missing.length ? `\n缺 ${missing.length} 项：${missing.join('、')}` : `\n${MARKERS.length}/${MARKERS.length} 全绿`)
process.exit(missing.length ? 1 : 0)
