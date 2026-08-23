#!/usr/bin/env node
/**
 * Listing精造师 P3 回归：归档纯逻辑 + 恢复无丢失 + 字段解析/CSV（用 P2 真实验收包做素材）。
 * 环境无 node 时用 Electron 代跑：先用 tsc 转译为 CJS 再执行（见会话记录）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildListingCsv, escapeCsvCell, LISTING_ARCHIVE_MAX, normalizeBatchForRestore,
  parseListingFields, summarizeBatch, upsertBatch
} from '../src/shared/listingArchive'
import type { ListingBatchRecord, ListingTaskRecord } from '../src/shared/listingArchive'
import { defaultLanguagesForSites, formatDraftAsMaterial, formatExtractedAsMaterial, siteIdsForMarketplace } from '../src/shared/listingBridge'

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures++
}

const makeBatch = (id: string, tasks: Partial<ListingTaskRecord>[] = []): ListingBatchRecord => ({
  id, createdAt: Date.now(), material: '素材', siteIds: ['amazon-us'], langCodes: ['en-US'],
  tasks: tasks.map((task, index) => ({
    id: `${id}-t${index}`, siteId: 'amazon-us', siteLabel: 'Amazon 美国站',
    languageCode: 'en-US', status: 'pending', content: '', ...task
  }))
})

// ─── 1. upsertBatch：同 id 覆盖置顶、上限裁剪 ─────────────────────
{
  let archive: ListingBatchRecord[] = []
  for (let index = 0; index < LISTING_ARCHIVE_MAX + 5; index++) archive = upsertBatch(archive, makeBatch(`b${index}`))
  assert(`upsert 上限裁剪 ≤ ${LISTING_ARCHIVE_MAX}`, archive.length === LISTING_ARCHIVE_MAX, `实际 ${archive.length}`)
  assert('upsert 最新置顶', archive[0].id === `b${LISTING_ARCHIVE_MAX + 4}`)
  assert('upsert 最旧被裁', !archive.some(item => item.id === 'b0'))
  const replaced = upsertBatch(archive, makeBatch('b25', [{ status: 'done', content: '新内容' }]))
  assert('upsert 同 id 覆盖不重复', replaced.filter(item => item.id === 'b25').length === 1)
  assert('upsert 覆盖后内容最新', replaced[0].tasks[0].content === '新内容')
}

// ─── 2. 恢复载入：在途任务转「已中断」，完成/失败不动 ─────────────
{
  const restored = normalizeBatchForRestore(makeBatch('r1', [
    { status: 'pending' }, { status: 'running' }, { status: 'done', content: 'ok' }, { status: 'failed', error: 'x' }
  ]))
  const statuses = restored.tasks.map(task => task.status)
  assert('恢复：pending/running → interrupted', statuses[0] === 'interrupted' && statuses[1] === 'interrupted')
  assert('恢复：done/failed 保持', statuses[2] === 'done' && statuses[3] === 'failed')
  assert('恢复：内容不丢失', restored.tasks[2].content === 'ok')
  const summary = summarizeBatch(restored)
  assert('恢复：汇总口径正确', summary.total === 4 && summary.done === 1 && summary.failed === 1 && summary.interrupted === 2)
}

// ─── 3. 字段解析 + CSV：对 P2 真实验收包逐一检验 ──────────────────
{
  const dir = join(process.env.LISTING_REPO_ROOT || process.cwd(), '.tmp-ui-verify')
  const files = readdirSync(dir).filter(name => name.startsWith('listing-matrix-') && name.endsWith('.md'))
  assert('真实包素材存在', files.length >= 9, `${files.length} 个`)
  const packages = files.map(name => {
    const content = readFileSync(join(dir, name), 'utf8')
    const fields = parseListingFields(content)
    assert(`解析标题 ${name}`, fields.title.length > 0, fields.title.slice(0, 60))
    assert(`解析要点 ${name}`, fields.bullets.length > 0, `${fields.bullets.split(' | ').length} 条`)
    assert(`解析描述 ${name}`, fields.description.length > 0)
    assert(`解析搜索词 ${name}`, fields.searchTerms.length > 0)
    return { siteLabel: name.replace(/^listing-matrix-|\.md$/g, ''), languageCode: 'x', conclusion: '需人工复核后发布', content }
  })

  assert('CSV 单元格转义引号', escapeCsvCell('a"b') === '"a""b"')
  assert('CSV 单元格逗号/换行包裹', escapeCsvCell('a,b\nc').startsWith('"') && escapeCsvCell('普通') === '普通')
  const csv = buildListingCsv(packages)
  const lines = csv.split('\r\n')
  assert('CSV 行数 = 表头 + 包数', lines.length === packages.length + 1, `${lines.length}`)
  assert('CSV 表头八字段', lines[0] === ['平台站点', '语言', '发布结论', '标题', '要点', '描述', '后台搜索词', '全文'].join(','))
  // 引号感知拆列：每行必须恰好 8 列，且末列全文与原始内容一致
  const splitCsvRow = (row: string): string[] => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let index = 0; index < row.length; index++) {
      const character = row[index]
      if (inQuotes) {
        if (character === '"') {
          if (row[index + 1] === '"') { current += '"'; index++ } else inQuotes = false
        } else current += character
      } else if (character === '"') inQuotes = true
      else if (character === ',') { cells.push(current); current = '' }
      else current += character
    }
    cells.push(current)
    return cells
  }
  const badRows = lines.slice(1).map((row, index) => { return { row, index, cells: splitCsvRow(row) } }).filter(item => item.cells.length !== 8 || item.cells[7] !== packages[item.index].content)
  assert('CSV 每行 8 列且全文可逆', badRows.length === 0, badRows.length ? `异常行 ${badRows.map(item => item.index).join(',')}` : '全部还原一致')
}

// ─── 4. P4 桥接：提取/草稿 → 素材格式化与平台映射 ──────────────
{
  const extracted = formatExtractedAsMaterial({
    title: '  宠物一键退毛梳  ',
    url: 'https://detail.1688.com/offer/x.html',
    price: '¥ 12.5',
    attributes: ['材质：不锈钢+ABS', '货号：PP-201', '无冒号属性'],
    images: ['a.jpg', 'b.jpg'],
    seller: '义乌宠具厂'
  })
  assert('提取→素材：标题/价格/供应商命中', extracted.includes('商品名称：宠物一键退毛梳') && extracted.includes('供货价：¥ 12.5') && extracted.includes('供应商：义乌宠具厂'))
  assert('提取→素材：属性并入', extracted.includes('材质：不锈钢+ABS') && extracted.includes('货号：PP-201') && extracted.includes('规格：无冒号属性'))
  assert('提取→素材：图片计数与来源', extracted.includes('主图素材：2 张') && extracted.includes('来源：https://detail.1688.com'))
  assert('提取→素材：零编造（无品牌/型号虚构）', !extracted.includes('品牌：') && !extracted.includes('型号：'))
  assert('提取→素材：空对象不崩溃且声明认证未知', formatExtractedAsMaterial({}).includes('认证：未知'))

  const draftMaterial = formatDraftAsMaterial({
    id: 'd1', marketplaceCode: 'AMAZON', title: 'Pet Brush PP-201',
    platformSku: 'AMAZON-JH-PP201', priceText: '$19.99', imageUrl: 'https://img/x.jpg', status: 'DRAFT'
  })
  assert('草稿→素材：四字段命中', draftMaterial.includes('商品名称：Pet Brush PP-201') && draftMaterial.includes('SKU：AMAZON-JH-PP201') && draftMaterial.includes('价格：$19.99') && draftMaterial.includes('主图：https://img/x.jpg'))
  assert('草稿→素材：标注字段薄弱需补充', draftMaterial.includes('其余字段需补充'))

  const amazonSites = siteIdsForMarketplace('AMAZON')
  assert('平台映射：AMAZON → 4 站点', amazonSites.length === 4 && amazonSites.includes('amazon-us') && amazonSites.includes('amazon-jp'), amazonSites.join(','))
  assert('平台映射：EBAY → 2 站点', siteIdsForMarketplace('EBAY').length === 2)
  assert('平台映射：OZON → 空（无对应站点）', siteIdsForMarketplace('OZON').length === 0)
  const languages = defaultLanguagesForSites(amazonSites)
  assert('站点→默认语言并集去重', languages.includes('en-US') && languages.includes('de') && languages.includes('ja') && new Set(languages).size === languages.length, languages.join(','))
}

console.log(failures === 0 ? '\nRESTORE REGRESSION PASS' : `\nRESTORE REGRESSION FAIL（${failures} 项）`)
process.exit(failures === 0 ? 0 : 1)
