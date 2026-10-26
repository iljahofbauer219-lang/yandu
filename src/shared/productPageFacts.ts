export interface ProductPageFacts {
  specs: Array<{ key: string; value: string }>
  features: string[]
  descriptionText: string
  imageAssets: string[]
  videoAssets?: string[]
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
}

function sectionInner(html: string, className: string): string[] {
  const out: string[] = []
  const pattern = new RegExp(`<section class="${className}[^"]*"[^>]*>([\\s\\S]*?)</section>`, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) out.push(match[1])
  return out
}

const JUNK_LINE = /^(帮助中心|buyer中心|消息中心|会员中心|客服中心|登录|注册|搜索|首页|网站导航|联系方式|公司简介|我的收藏|购物车)/i
// 成本/履约侧栏行：涉及进货成本，禁止进入面向客户的内容生成事实
const COST_LINE = /^(单价|打包费|运费|物流费|预估总额|可售库存|一件代发时效|下载素材包|素材包|文件|下载中心)|^[$¥€£]\s?[\d,.]+/

/** 服务器产品页描述混入的原站导航/UI 碎片行剔除：过短且无数字的行与已知导航词行不入事实 */
export function cleanPageDescriptionText(text: string): string {
  return text
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => Boolean(line) && (line.length >= 4 || /\d/.test(line)) && !JUNK_LINE.test(line) && !COST_LINE.test(line))
    .join('\n')
}

/** 解析中央服务器公开产品页（render.ts 模板）中的规格/特点/图文描述，作为本地产品详情事实源 */
export function parseProductPageFacts(html: string): ProductPageFacts {
  const specs: Array<{ key: string; value: string }> = []
  const tablePattern = /<table class="([^"]*)"[^>]*>([\s\S]*?)<\/table>/g
  let tableMatch: RegExpExecArray | null
  while ((tableMatch = tablePattern.exec(html))) {
    if (tableMatch[1].includes('pp-fees')) continue
    const rowPattern = /<th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td>/g
    let row: RegExpExecArray | null
    while ((row = rowPattern.exec(tableMatch[2]))) {
      const key = stripTags(row[1]).replace(/\s+/g, ' ').trim()
      const value = stripTags(row[2]).replace(/\s+/g, ' ').trim()
      if (key && value) specs.push({ key, value })
    }
  }
  for (const inner of sectionInner(html, 'pp-spec-group')) {
    const cellPattern = /<div><span>([\s\S]*?)<\/span>([\s\S]*?)<\/div>/g
    let cell: RegExpExecArray | null
    while ((cell = cellPattern.exec(inner))) {
      const key = stripTags(cell[1]).replace(/:\s*$/, '').replace(/\s+/g, ' ').trim()
      const value = stripTags(cell[2]).replace(/\s+/g, ' ').trim()
      if (key && value) specs.push({ key, value })
    }
  }
  const features: string[] = []
  for (const inner of sectionInner(html, 'pp-desc pp-features')) {
    const itemPattern = /<li>([\s\S]*?)<\/li>/g
    let item: RegExpExecArray | null
    while ((item = itemPattern.exec(inner))) {
      const text = stripTags(item[1]).replace(/\s+/g, ' ').trim()
      if (text) features.push(text)
    }
  }
  const descriptionLines: string[] = []
  for (const inner of sectionInner(html, 'pp-desc')) {
    const body = inner.replace(/^[\s\S]*?<b>图文描述<\/b>/, '')
    if (body === inner) continue
    for (const line of stripTags(body).split(/\n+/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      if (!descriptionLines.includes(line)) descriptionLines.push(line)
    }
  }
  const imageAssets: string[] = []
  const shotPattern = /<img[^>]*class="[^"]*pp-shot[^"]*"[^>]*src="assets\/([^"?#]+)"/g
  let shot: RegExpExecArray | null
  while ((shot = shotPattern.exec(html))) {
    const name = decodeEntities(shot[1]).trim()
    if (name && !imageAssets.includes(name)) imageAssets.push(name)
  }
  const videoAssets: string[] = []
  const mp4Pattern = /src="assets\/([^"?#]+\.mp4)"/gi
  let mp4: RegExpExecArray | null
  while ((mp4 = mp4Pattern.exec(html))) {
    const name = decodeEntities(mp4[1]).trim()
    if (name && !videoAssets.includes(name)) videoAssets.push(name)
  }
  const seen = new Set<string>()
  const dedupedSpecs = specs.filter(item => {
    const key = `${item.key}:${item.value}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { specs: dedupedSpecs, features, descriptionText: cleanPageDescriptionText(descriptionLines.join('\n')), imageAssets, videoAssets: videoAssets.length ? videoAssets : undefined }
}
