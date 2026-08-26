#!/usr/bin/env node
// 从 amz123 CDN 下载所有平台 logo → public/logos/
// 同时把 _regions.ts 里的 logo URL 替换成本地路径（避免外链）

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const LOGO_DIR = resolve(ROOT, 'public/logos')
const DATA_FILE = resolve(ROOT, 'src/data/_regions.ts')
const SITES_FILE = resolve(ROOT, 'src/data/_sites.ts')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(LOGO_DIR, { recursive: true })

// 1) 读 regions 数据
const regionsSrc = readFileSync(DATA_FILE, 'utf-8')
const regions = JSON.parse(regionsSrc.split('export const REGIONS: Region[] = ')[1])

// 2) 收集所有 logo URL
const urlSet = new Set()
for (const r of regions) {
  for (const s of r.sites) {
    if (s.logo) urlSet.add(s.logo)
  }
}
const allUrls = [...urlSet]
console.log(`📦 共 ${allUrls.length} 个不同 logo URL`)

// 3) 下载到本地，生成 url→localPath 映射
const urlToLocal = {}
let success = 0
let fail = 0

for (let i = 0; i < allUrls.length; i++) {
  const url = allUrls[i]
  // 用 URL 路径的最后一段作为文件名（去 query），保留扩展名
  const urlPath = new URL(url).pathname
  const ext = extname(urlPath) || '.png'
  // 用 md5(16 字符) 作为文件名（避免 base64 截断后前缀冲突）
  const hash = createHash('md5').update(url).digest('hex').slice(0, 16)
  const name = hash + ext
  const localPath = resolve(LOGO_DIR, name)
  urlToLocal[url] = `./logos/${name}`

  if (existsSync(localPath)) {
    success++
    if (i % 20 === 0) console.log(`  [${i + 1}/${allUrls.length}] ⏭  ${name} (cached)`)
    continue
  }

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.amz123.com/' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(localPath, buf)
    success++
    if (i % 20 === 0) console.log(`  [${i + 1}/${allUrls.length}] ✓ ${name} (${buf.length}B)`)
  } catch (e) {
    fail++
    console.log(`  [${i + 1}/${allUrls.length}] ✗ ${url}  ${e.message}`)
  }
  await sleep(120) // 防止打爆 CDN
}

console.log(`\n📊 下载完成：${success} 成功 / ${fail} 失败`)

// 4) 把 _regions.ts 和 _sites.ts 的 logo 字段替换成本地路径
function rewriteLogos(src) {
  let out = src
  for (const [url, local] of Object.entries(urlToLocal)) {
    out = out.split(`"${url}"`).join(`"${local}"`)
  }
  return out
}

writeFileSync(DATA_FILE, rewriteLogos(regionsSrc))

const sitesSrc = readFileSync(SITES_FILE, 'utf-8')
writeFileSync(SITES_FILE, rewriteLogos(sitesSrc))

// 5) 写一个 urlToLocal 映射文件（备用）
writeFileSync(
  resolve(ROOT, 'src/data/_logoMap.ts'),
  `export const LOGO_MAP: Record<string, string> = ${JSON.stringify(urlToLocal, null, 2)}\n`,
)

console.log(`✅ logo 已本地化（写入 public/logos/）`)
console.log(`✅ _regions.ts / _sites.ts 已替换 logo URL`)
