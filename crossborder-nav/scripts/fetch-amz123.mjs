#!/usr/bin/env node
// 抓取 amz123.com/kd 首页 → 拆解为多个 .ts 数据文件
// 仅供桌面端（macOS 住宅 IP）执行，避免阿里云 IP 风控

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CACHE = resolve(__dirname, '.cache')
mkdirSync(CACHE, { recursive: true })

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ========================== 解析 ==========================

// 1. 顶部 10 个一级入口：<a class="amz-nav-title-link" href="...">首页</a>
function parseTopNav(html) {
  const re = /<a[^>]+class="amz-nav-title-link"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g
  const items = []
  let m
  while ((m = re.exec(html)) !== null) {
    items.push({ label: m[2].trim(), href: m[1] })
  }
  return items
}

// 2. 热门搜索词：<div class="amz-hot-search"> ... <a title=".."><span>N.</span> 词</a>
function parseHotSearch(html) {
  const sec = html.match(/<div class="amz-hot-search[\s\S]*?<\/section><\/div>/)
  if (!sec) return []
  const words = [...sec[0].matchAll(/<a[^>]+title="([^"]+)"[^>]*>\s*<span>[^<]+<\/span>\s*([^<]+?)\s*<\/a>/g)]
    .map((m) => (m[1] || m[2] || '').trim())
    .filter((t) => t && t.length <= 30)
  return Array.from(new Set(words))
}
// 3. 平台大全：12 个 <ul class="amz-show" data-sdk-position="区域名">，
//    每块内是 <li class="amz-item amz-qrcode-item"> 平台项。
//    - 标题：<a class="amz-item-title"> / <div class="amz-item-title">
//    - logo：<img data-raw-src="真实URL" src="empty.png" ...>
//    - desc：<a class="amz-item-intro"> / <div class="amz-item-intro-B">
//    - href：<a href="https://www.amz123.com/{slug}?from=kd">
//    - guide：<a href="https://www.amz123.com/{slug}/guide">
function parsePlatforms(html) {
    const regions = []
    const blocks = splitByUlBlocks(html)
    for (const { region, body } of blocks) {
        const sites = []
        const seen = new Set()

        // 每块内的每个 li
        const liRe = /<li[^>]+class="amz-item amz-qrcode-item"[\s\S]*?<\/li>/g
        let lm
        while ((lm = liRe.exec(body)) !== null) {
            const li = lm[0]
            // 1) 平台名：<a> 或 <div> class="amz-item-title">
            const nameMatch = li.match(/<[adiv]+[^>]+class="amz-item-title"[^>]*>([^<]+)<\/(?:a|div)>/)
            const name = nameMatch ? nameMatch[1].trim() : ''
            if (!name || seen.has(name)) continue

            // 2) logo：<img ... data-raw-src="...">（src 是 empty.png 占位）
            const logoMatch = li.match(/<img[^>]+data-raw-src="([^"]+)"/)
            const logo = logoMatch ? logoMatch[1] : ''

            // 3) desc：<a class="amz-item-intro"> 或 <div class="amz-item-intro-B...">
            const descMatch =
                li.match(/<a[^>]+class="amz-item-intro"[^>]*>([^<]+)<\/a>/) ||
                li.match(/<div[^>]+class="amz-item-intro[\s\-A-Za-z]*"[^>]*>([^<]+)<\/div>/)
            const desc = descMatch ? descMatch[1].replace(/&nbsp;/g, ' ').trim() : ''

            // 4) href / guide：热门平台用 /slug/{introduction|guide|news}，
            //    其他区域用 /slug?from=kd 或 /slug/guide。统一从子链接推断 slug。
            const allHrefs = [...li.matchAll(/href="(https?:\/\/www\.amz123\.com\/(?:[a-z0-9-]+\/)?[a-z0-9-]+(?:\/[a-z0-9-]+)*)(?:\?[^"]*)?\"/g)].map((x) => x[1])
            const directHref = [...li.matchAll(/href="(https?:\/\/www\.amz123\.com\/[a-z0-9-]+\?from=kd)"/g)].map((x) => x[1])[0]
            let slug = ''
            let guide = ''
            for (const h of allHrefs) {
                const m = h.match(/^https?:\/\/www\.amz123\.com\/([a-z0-9-]+)\/(introduction|guide|news|kaipan|kaidian)/)
                if (m) { slug = m[1]; if (m[2] === 'guide') guide = h.split('?')[0]; break }
            }
            if (!slug && directHref) {
                slug = directHref.split('?')[0].split('/').pop()
            }
            const href = slug ? 'https://www.amz123.com/' + slug : ''

            seen.add(name)
            sites.push({ name, desc, logo, href, guide })
        }

        if (sites.length > 0) {
            regions.push({ title: region, sites })
        }
    }
    return regions
}

// 平衡括号定位每个 <ul class="amz-show..."> 块（避免非贪婪提前结束）
function splitByUlBlocks(html) {
    const re = /<ul class="amz-show[^"]+"[^>]*data-sdk-position="([^"]+)"[^>]*>/g
    const out = []
    let m
    while ((m = re.exec(html)) !== null) {
        const region = m[1].trim()
        const start = m.index
        let depth = 1
        let i = m.index + m[0].length
        while (depth > 0 && i < html.length) {
            const nextOpen = html.indexOf('<ul', i)
            const nextClose = html.indexOf('</ul>', i)
            if (nextClose === -1) break
            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth++
                i = nextOpen + 4
            } else {
                depth--
                i = nextClose + 5
            }
        }
        out.push({ region, body: html.slice(start, i) })
    }
    return out
}

// 4. 站点+专题：<div class="amz-site-and-topic"> → 按位置配对 span.link-group + ul
function parseTopics(html) {
  const sec = html.match(/<div class="amz-site-and-topic[\s\S]*?(?=<div class="amz-footer)/)
  if (!sec) return []
  const body = sec[0]
  // 先收集所有 span.link-group 的位置 + 名称
  const spans = []
  const spanRe = /<span class="link-group[^"]*">([^<]+)<\/span>/g
  let m
  while ((m = spanRe.exec(body)) !== null) {
    spans.push({ name: m[1].trim(), pos: m.index })
  }
  // 再收集所有 ul.data-sdk-position 的起止位置（平衡括号）
  const uls = []
  const ulRe = /<ul[^>]*data-sdk-position="([^"]*)"[^>]*>/g
  while ((m = ulRe.exec(body)) !== null) {
    let depth = 1, j = m.index + m[0].length
    while (depth > 0 && j < body.length) {
      const o = body.indexOf('<ul', j), c = body.indexOf('<\/ul>', j)
      if (c === -1) break
      if (o !== -1 && o < c) { depth++; j = o + 4 } else { depth--; j = c + 5 }
    }
    uls.push({ sdk: m[1], body: body.slice(m.index + m[0].length, j - 5), pos: m.index })
  }
  // 按位置配对：每个 ul 取它前面最近的 span
  const out = []
  for (const ul of uls) {
    const before = spans.filter(s => s.pos < ul.pos).pop()
    const items = [...ul.body.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
      .map((a) => ({ href: a[1], text: a[2].trim() }))
      .filter((a) => a.text)
    if (items.length) out.push({ group: before?.name || '其他', sdk: ul.sdk, items })
  }
  return out
}

// 5. 底部 footer：<div class="amz-footer-wrapper"> → amz-site-title 分组
function parseFooter(html) {
  const sec = html.match(/<div class="amz-footer-wrapper[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/)
  if (!sec) return { groups: [] }
  const groups = []
  const re = /<div class="amz-site-title">([^<]+)<\/div>([\s\S]*?)(?=<div class="amz-site-title"|$)/g
  let m
  while ((m = re.exec(sec[0])) !== null) {
    const title = m[1].trim()
    const items = [...m[2].matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
      .map((a) => ({ href: a[1], text: a[2].trim() }))
      .filter((a) => a.text && a.text.length < 30)
    if (items.length) groups.push({ title, items })
  }
  return { groups }
}
// 6. 平台详情页 og:image（用于真实 logo）
async function fetchPlatformOgs(sites) {
  const out = {}
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    if (!s.href) continue
    try {
      const html = await fetchText(s.href)
      const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
      if (ogMatch) out[s.name] = ogMatch[1]
      if (i % 20 === 0) console.log(`  [${i + 1}/${sites.length}] ${s.name} → ${ogMatch ? '✓' : '✗'}`)
    } catch (e) { /* ignore */ }
    await sleep(250)
  }
  return out
}

// ========================== 主流程 ==========================

async function main() {
  console.log('📥 抓取 amz123.com/kd 首页…')
  const html = await fetchText('https://www.amz123.com/kd')
  console.log(`  ✓ size=${html.length}`)

  const topNav = parseTopNav(html)
  const hotSearch = parseHotSearch(html)
  const regions = parsePlatforms(html)
  const topics = parseTopics(html)
  const footer = parseFooter(html)
  const allSites = regions.flatMap((r) => r.sites.map((s) => ({ ...s, region: r.title })))

  console.log(`\n📊 解析结果：`)
  console.log(`  顶部导航: ${topNav.length} 个`)
  console.log(`  热门搜索: ${hotSearch.length} 词`)
  console.log(`  区域板块: ${regions.length} 个`)
  console.log(`  平台总数: ${allSites.length} 个`)
  console.log(`  专题入口: ${topics.length} 个`)
  console.log(`  Footer 链接: ${footer.groups.length} 个`)

  const dataDir = resolve(ROOT, 'src/data')
  mkdirSync(dataDir, { recursive: true })

  writeFileSync(resolve(dataDir, '_topNav.ts'),
    `export interface NavItem { label: string; href: string }\nexport const TOP_NAV: NavItem[] = ${JSON.stringify(topNav, null, 2)}\n`)
  writeFileSync(resolve(dataDir, '_hotSearch.ts'),
    `export const HOT_SEARCH: string[] = ${JSON.stringify(hotSearch, null, 2)}\n`)
  writeFileSync(resolve(dataDir, '_topics.ts'),
    `export interface Topic { href: string; slug: string; title: string; desc: string }\nexport const TOPICS: Topic[] = ${JSON.stringify(topics, null, 2)}\n`)
  writeFileSync(resolve(dataDir, '_regions.ts'),
    `export interface Site { name: string; desc: string; logo: string; href: string }\nexport interface Region { title: string; sites: Site[] }\nexport const REGIONS: Region[] = ${JSON.stringify(regions, null, 2)}\n`)
  writeFileSync(resolve(dataDir, '_sites.ts'),
    `import type { Site } from './_regions'\nexport interface SiteWithRegion extends Site { region: string }\nexport const ALL_SITES: SiteWithRegion[] = ${JSON.stringify(allSites, null, 2)}\n`)
  writeFileSync(resolve(dataDir, '_footer.ts'),
    `export const FOOTER = ${JSON.stringify(footer, null, 2)}\n`)

  console.log(`\n✅ 已写入 src/data/_*.ts`)

  if (process.env.SKIP_OG) {
    console.log('SKIP_OG=1 跳过 og:image 抓取')
  } else {
    console.log(`\n📥 抓取各平台 og:image（${allSites.length} 次，间隔 250ms）…`)
    const ogs = await fetchPlatformOgs(allSites)
    writeFileSync(resolve(dataDir, '_ogImages.ts'),
      `export const OG_IMAGES: Record<string, string> = ${JSON.stringify(ogs, null, 2)}\n`)
    console.log(`\n✅ og:image 映射写入 src/data/_ogImages.ts（${Object.keys(ogs).length} 个）`)
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
