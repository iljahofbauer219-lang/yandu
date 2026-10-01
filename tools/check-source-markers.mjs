/**
 * 源码标记自检：防止并行会话覆写/回滚掏空已完成功能点。
 * 任一标记缺失即 exit 1。运行：npm run verify:markers
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const checks = [
  { file: 'src/renderer/App.tsx', must: ['isExcludedSupply', 'activeSelectionItems', 'candidate-heading-title-row', 'const activeItems = items.filter', '__BUILD_STAMP__'], mustNot: ['eliminate-dialog-meta', 'candidate-controls-row'] },
  { file: 'src/renderer/erp/PalletWarehousePage.tsx', must: ['pallet-heading-title-row', "key: 'PRODUCT_URL'"], mustNot: [] },
  { file: 'src/renderer/styles.css', must: ['candidate-heading-title-row', 'pallet-heading-title-row', '.build-stamp'], mustNot: ['candidate-controls-row'] },
  { file: 'src/renderer/eliminated-products.css', must: [], mustNot: ['eliminate-dialog-meta'] },
  { file: 'package.json', must: ['rebuild:clean', 'verify:markers'], mustNot: [] },
  { file: 'vite.config.ts', must: ['__BUILD_STAMP__'], mustNot: [] }
]

let failures = 0
for (const check of checks) {
  const content = read(check.file)
  for (const token of check.must) {
    if (!content.includes(token)) { failures += 1; console.error(`  ✘ ${check.file} 缺少标记: ${token}`) }
  }
  for (const token of check.mustNot) {
    if (content.includes(token)) { failures += 1; console.error(`  ✘ ${check.file} 残留应删除标记: ${token}`) }
  }
}
if (failures === 0) console.log('MARKERS_OK 全部源码标记在位')
else console.error(`MARKERS_FAILED ${failures} 项标记异常`)
process.exit(failures === 0 ? 0 : 1)
