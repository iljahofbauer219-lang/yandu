const fs = require('fs')
const REGION_MAP = {
  '热门平台': 'hot', '北美': 'na', '欧洲': 'eu', '日韩': 'jp-kr',
  '东南亚': 'sea', '拉美': 'latam', '澳洲': 'au', '中东': 'me',
  '非洲': 'africa', 'Jumia': 'africa', '南亚': 'sa', '中亚': 'cas', 'B2B': 'b2b'
}
function stripTags(s) { return s.replace(/<[^>]+>/g, '').trim() }
function slugify(name) {
  return name.toLowerCase().replace(/[\s/\\]+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '') || 'site'
}
function parseCard(cardHtml, region) {
  // logo
  const logoMatch = cardHtml.match(/data-raw-src="([^"]+)"/) || cardHtml.match(/<img[^>]+src="([^"]+)"/)
  let logo = logoMatch ? logoMatch[1] : ''
  if (logo.includes('empty.png')) logo = ''

  // 名称
  const nameMatch = cardHtml.match(/class="amz-item-title"[^>]*>([\s\S]*?)<\/?(?:p|div|a|span)/)
  if (!nameMatch) return null
  const name = stripTags(nameMatch[1])

  // 描述
  const descMatch = cardHtml.match(/class="amz-item-intro(?:-B)?[^"]*"[^>]*>([\s\S]*?)<\/?(?:p|div|a|span)/)
  const desc = descMatch ? stripTags(descMatch[1]) : ''

  // 链接：按文本分类
  // 普通区域：amz-link-item 文本是"平台首页" / "开店指南"
  // 热门区域：amz-item-16 链接是 amz123 详情页（amz123.com/xxx），不是真实平台首页
  //  - 真实平台首页需要从 amz123 详情页再 fetch 一次
  //  - 暂时用 amz123 链接作为兜底
  const linkItemRe = /<a[^>]+href="([^"]+)"[^>]*class="amz-link-item[^"]*"[^>]*>([^<]*)<\/a>/g
  const linkItems = []
  let m
  while ((m = linkItemRe.exec(cardHtml)) !== null) {
    linkItems.push({ href: m[1], text: m[2].trim() })
  }
  let homepage = ''
  let guide = ''
  for (const li of linkItems) {
    if (li.text === '平台首页') homepage = li.href
    else if (li.text === '开店指南' || li.text === '平台知识') guide = li.href
  }
  if (!homepage) {
    const itemLinkMatch = cardHtml.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="amz-item-\d/)
    if (itemLinkMatch) homepage = itemLinkMatch[1]
  }
  if (!guide && homepage) {
    const amzMatch = homepage.match(/amz123\.com\/([^/?]+)/)
    if (amzMatch) guide = `https://www.amz123.com/${amzMatch[1]}/guide`
  }

  if (!name || !homepage) return null
  return { id: slugify(name), name, region, logoUrl: logo, description: desc, homepageUrl: homepage, openGuideUrl: guide }
}
function main() {
  const html = fs.readFileSync('/Users/zyc/Desktop/砚都跨境/.tmp-amz123-kd.html', 'utf-8')
  const ulRe = /<ul[^>]+data-sdk-position="([^"]+)"[^>]*>([\s\S]*?)<\/ul>/g
  const liRe = /<li[^>]*class="[^"]*amz-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g
  const sites = []
  let m
  while ((m = ulRe.exec(html)) !== null) {
    const region = REGION_MAP[m[1].trim()]
    if (!region) continue
    const body = m[2]
    let li
    liRe.lastIndex = 0
    while ((li = liRe.exec(body)) !== null) {
      const s = parseCard(li[1], region)
      if (s) sites.push(s)
    }
  }
  console.log(`提取 ${sites.length} 张`)
  // 统计真实平台首页（不是 amz123）的数量
  const realCount = sites.filter(s => !s.homepageUrl.includes('amz123.com')).length
  console.log(`真实平台首页: ${realCount} 条`)
  const byRegion = {}
  sites.forEach(s => { byRegion[s.region] = (byRegion[s.region] || 0) + 1 })
  Object.entries(byRegion).forEach(([r, n]) => console.log(`  ${r}: ${n}`))
  // 去重
  const seen = new Set()
  const dedup = sites.filter(s => {
    const key = `${s.region}:${s.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  console.log(`去重后 ${dedup.length} 张`)
  fs.writeFileSync('/Users/zyc/Desktop/砚都跨境/.tmp-sites.json', JSON.stringify(dedup, null, 2), 'utf-8')
}
main()
