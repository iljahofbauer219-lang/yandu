import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

import { readFileSync } from 'node:fs'
async function fetchText(url) {
  if (url === 'https://www.amz123.com/kd') {
    return readFileSync('/Users/zyc/Desktop/砚都跨境/.tmp-amz123-kd.html', 'utf-8')
  }
  return ''
}
process.env.SKIP_OG = '1'

// 重新 import 原脚本的 main
const code = readFileSync(resolve(__dirname, 'fetch-amz123.mjs'), 'utf-8')
// 直接 eval main 部分
const mainMatch = code.match(/async function main\(\)[\s\S]+?^}/m)
if (!mainMatch) { console.log('no main'); process.exit(1) }

// 提取 parsePlatforms 并执行
const parseMatch = code.match(/function parsePlatforms\(html\)[\s\S]+?^}/m)
const parseFn = new Function('html', parseMatch[0] + '; return parsePlatforms(html)')
const html = await fetchText('https://www.amz123.com/kd')
const regions = parseFn(html)
console.log(`\n📊 解析结果：`)
console.log(`  区域板块: ${regions.length} 个`)
let total = 0
for (const r of regions) {
  console.log(`  [${r.title}] ${r.sites.length} 个平台`)
  total += r.sites.length
  if (r.sites[0]) {
    const s = r.sites[0]
    console.log(`      示例: ${s.name} | logo=${s.logo.slice(0,60)}... | desc=${s.desc.slice(0,30)}`)
  }
}
console.log(`  平台总数: ${total} 个`)
