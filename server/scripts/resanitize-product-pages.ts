/**
 * 存量产品详情页净化脚本：净化只在 POST 落盘时生效，本脚本把已存在的 index.html 重跑一遍白名单净化。
 * 部署新版 server 后必须执行一次，否则历史页面里的未净化脚本仍可执行。
 *
 * 用法：
 *   pnpm resanitize:product-pages -- --dry-run   只报告将改动哪些页面，不写盘
 *   pnpm resanitize:product-pages                实跑（tmp + rename 原子覆写）
 *
 * 只改 index.html，不触碰 assets/ 与 meta.json。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from '../src/config.js'
import { sanitizeProductPageHtml } from '../src/modules/product-pages/sanitize.js'

const dryRun = process.argv.includes('--dry-run')
const root = path.resolve(config.productPagesDir)

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, content, 'utf8')
  await fsp.rename(tmp, file)
}

console.log(`[resanitize] 目标目录：${root}${dryRun ? '（dry-run，不写盘）' : ''}`)
if (!(await pathExists(root))) {
  console.log('[resanitize] 目录不存在，无需处理')
  process.exit(0)
}

const entries = await fsp.readdir(root, { withFileTypes: true })
let scanned = 0
let changed = 0
let clean = 0
let broken = 0

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const file = path.join(root, entry.name, 'index.html')
  if (!(await pathExists(file))) {
    broken += 1
    console.warn(`  ! ${entry.name}：缺少 index.html，跳过`)
    continue
  }
  scanned += 1
  const before = await fsp.readFile(file, 'utf8')
  let after: string
  try {
    after = sanitizeProductPageHtml(before)
  } catch (error) {
    broken += 1
    console.error(`  ✘ ${entry.name}：净化失败，保留原文件 —— ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  if (after === before) {
    clean += 1
    continue
  }
  changed += 1
  console.log(`  ${dryRun ? '~' : '✔'} ${entry.name}：${before.length} → ${after.length} 字节`)
  if (!dryRun) await atomicWrite(file, after)
}

console.log(`\n[resanitize] 扫描 ${scanned} 页，${dryRun ? '将改动' : '已改动'} ${changed} 页，已干净 ${clean} 页，异常 ${broken} 页`)
if (dryRun && changed > 0) console.log('[resanitize] dry-run 未写盘，去掉 --dry-run 后重跑以生效')
process.exit(broken > 0 ? 1 : 0)
