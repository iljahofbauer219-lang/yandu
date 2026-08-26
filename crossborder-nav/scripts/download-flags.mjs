// 下载平台分站国旗 SVG 到 public/flags/（flagcdn 公共国旗图床）
// 圆形效果由前端 CSS（border-radius:50% + object-fit:cover）裁切，无需圆形源图
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'flags')

const FLAGS = ['us', 'gb', 'de', 'fr', 'it', 'es', 'jp', 'ca', 'mx', 'in', 'br', 'nl', 'se', 'pl', 'be', 'tr', 'au', 'ae', 'eg', 'sa', 'sg']

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

await mkdir(OUT, { recursive: true })

let ok = 0
let skip = 0
for (const code of FLAGS) {
  const dest = join(OUT, `${code}.svg`)
  if (await exists(dest)) { skip++; continue }
  const res = await fetch(`https://flagcdn.com/${code}.svg`)
  if (!res.ok) {
    console.error(`[flags] ${code} 下载失败: HTTP ${res.status}`)
    continue
  }
  const text = await res.text()
  if (!text.includes('<svg')) {
    console.error(`[flags] ${code} 响应不是 SVG`)
    continue
  }
  await writeFile(dest, text, 'utf8')
  ok++
}
console.log(`[flags] 完成: 新下载 ${ok}, 已存在跳过 ${skip}, 共需 ${FLAGS.length}`)
