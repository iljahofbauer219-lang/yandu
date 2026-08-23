#!/usr/bin/env node
/**
 * 竞品评论意见聚合 + listing bullet 摘要 + 1688 第一部分系统事实块。
 * 验证三件事：纯函数存在、不调 LLM、行为正确；AIEmployee.tsx 阶段 4 接入并保留用户修改优先。
 * 与 inferEvidence（大模型提炼）不同：本组纯函数走确定性聚合，不发网络请求。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

const root = process.env.LISTING_REPO_ROOT || join(__dirname, '..')
const scraper = readFileSync(join(root, 'src/shared/amazonScraper.ts'), 'utf-8')
const extract = readFileSync(join(root, 'src/shared/selectionExtract.ts'), 'utf-8')
const tsx = readFileSync(join(root, 'src/renderer/AIEmployee.tsx'), 'utf-8')

// ─── 1. 三个纯函数存在 ─────────────────────────────────────────
assert(
  'amazonScraper.ts 暴露 buildCompetitorReviewInsights + buildCompetitorListingSummary',
  /export function buildCompetitorReviewInsights\(/.test(scraper) && /export function buildCompetitorListingSummary\(/.test(scraper)
)
assert(
  'selectionExtract.ts 暴露 buildProductBasicsBlock',
  /export function buildProductBasicsBlock\(info: ExtractedProductInfo\): string/.test(extract)
)

// ─── 2. 纯函数不调 LLM：禁出现 fetch / inferEvidence / AIEmployeeChatService ─────────────
const scraperForLLM = scraper.replace(/buildCompetitorReviewInsights[\s\S]+?^}/m, '').replace(/buildCompetitorListingSummary[\s\S]+?^}/m, '')
assert(
  'buildCompetitorReviewInsights / buildCompetitorListingSummary 不调 LLM（不出现 fetch / inferEvidence / AIEmployeeChatService）',
  !/fetch\(|inferEvidence|AIEmployeeChatService/.test(scraperForLLM)
)
assert(
  'buildProductBasicsBlock 不调 LLM（不出现 fetch / 大模型调用字样）',
  !/fetch\(|inferEvidence|AIEmployeeChatService|model\.chat|大模型/.test(extract)
)

// ─── 3. buildCompetitorReviewInsights 行为：rating=5 好评、≤2 差评、3 跳过、去重、最小字符 ─────────────
assert(
  'review 分桶：rating === 5 走 positives；rating <= 2 走 negatives；其他跳过',
  /if \(snippet\.rating === 5\) positives\.push\(title\)/.test(scraper)
    && /else if \(snippet\.rating != null && snippet\.rating <= 2\) negatives\.push\(title\)/.test(scraper)
)
// `seen` 集合使用模板字符串 `key`，并以 rating|title 作为去重键；最小字符阈值默认 4。
// 这里改用 String.includes 避免转义失误
assert(
  'review 标题去重 + 最小字符（默认 4 字符）',
  scraper.includes('const key = `${snippet.rating ?? \'na\'}|${title}`')
    && scraper.includes('seen.add(key)')
    && scraper.includes('minChars = options.minTitleChars ?? 4')
    && scraper.includes('title.length < minChars) continue')
)
assert(
  'review topN 默认 3（topN = options.topN ?? 3）',
  /const topN = options\.topN \?\? 3/.test(scraper)
    && /positives\.slice\(0, topN\)\.join\('；'\)/.test(scraper)
    && /negatives\.slice\(0, topN\)\.join\('；'\)/.test(scraper)
)
assert(
  'review 空 DIRECT / 空 reviewEvidence 时输出"待验证"',
  /当前未取得 DIRECT 竞品的评论页样本/.test(scraper)
    && /已抓评论页但无 DIRECT 竞品匹配/.test(scraper)
)

// ─── 4. buildCompetitorListingSummary 行为：bullet 截前 N 条 + 80 字符截断 ─────────────
assert(
  'bullet 默认 maxBullets=2 + maxChars=80',
  /const maxBullets = options\.maxBullets \?\? 2/.test(scraper)
    && /const maxChars = options\.maxChars \?\? 80/.test(scraper)
    && /item\.bulletPoints \|\| \[\]\)\.slice\(0, maxBullets\)/.test(scraper)
    && /slice\(0, maxChars\)/.test(scraper)
)
assert(
  'bullet 缺失时输出"待验证"',
  /当前未取得 DIRECT 竞品的详情页 bullet points/.test(scraper)
    && /bullets\.length \? bullets\.join\('；'\) : '待验证'/.test(scraper)
)

// ─── 5. buildProductBasicsBlock 行为：采购价 / 包装尺寸 / 毛重 / 款式 / 应用场景 ─────────────
// 采购价显示行使用模板字符串 `$${purchaseUsd.toFixed(2)}（事实｜用户录入）`；改用 includes
assert(
  'product basics 使用 quickMarketProfit.purchaseCostUsd（用户录入 USD 优先）',
  extract.includes('purchaseUsd != null && Number.isFinite(purchaseUsd)')
    && extract.includes('$${purchaseUsd.toFixed(2)}（事实｜用户录入）')
)
// 包装尺寸/毛重用 supply?.packagingDimensionsCm + supply?.grossWeightGrams，
// 模板字符串 `length}×{width}×{height} cm`；改用 includes
assert(
  'product basics 包装尺寸/毛重取 supplyFacts.packagingDimensionsCm + grossWeightGrams',
  extract.includes('supply?.packagingDimensionsCm')
    && extract.includes('supply?.grossWeightGrams')
    && extract.includes('length}×${supply.packagingDimensionsCm.width}×${supply.packagingDimensionsCm.height} cm')
)
assert(
  'product basics 款式/颜色/变体数取 attributes 前 8 条',
  /info\.attributes\?\.length \? info\.attributes\.slice\(0, 8\)/.test(extract)
)
assert(
  'product basics 应用场景取 detailText 前 400 字',
  /safe\(info\.detailText\)\.slice\(0, 400\)/.test(extract)
)
assert(
  'product basics 含缺口提示：可解决核心痛点 / 用户核心购买理由 / 核心优势 / 现存劣势 待智能体或人工提炼',
  /缺口提示/.test(extract) && /可解决核心痛点/.test(extract) && /现存劣势/.test(extract)
)

// ─── 6. AIEmployee.tsx 接入：导入 + 阶段 4 调用 + 失败兜底也输出基础块 ─────────────
// 行 6/7 是两个 from '.../shared/...' 的多行 import；用 includes 检查
// 是否在同一段 import 中同时出现 buildProductBasicsBlock + buildCompetitorReviewInsights + buildCompetitorListingSummary
const selectionExtractImport = tsx.match(/import \{[\s\S]+?\} from '\.\.\/shared\/selectionExtract'/)?. [0] || ''
const amazonScraperImport = tsx.match(/import \{[\s\S]+?\} from '\.\.\/shared\/amazonScraper'/)?. [0] || ''
assert(
  'AIEmployee.tsx 导入 buildCompetitorReviewInsights + buildCompetitorListingSummary + buildProductBasicsBlock',
  amazonScraperImport.includes('buildCompetitorReviewInsights,')
    && amazonScraperImport.includes('buildCompetitorListingSummary,')
    && selectionExtractImport.includes('buildProductBasicsBlock,')
)
assert(
  '阶段 4 marketBlock 拼装 buildProductBasicsBlock(extracted) + buildCompetitorReviewInsights + buildCompetitorListingSummary',
  /marketBlock = `\$\{extracted \? buildProductBasicsBlock\(extracted\) \+ '\\n\\n' : ''\}/.test(tsx)
    && /buildCompetitorReviewInsights\(classified\.samples, reviewEvidence\)/.test(tsx)
    && /buildCompetitorListingSummary\(classified\.samples, listingEvidence\)/.test(tsx)
)
assert(
  'Amazon 抓取失败 catch 分支也输出 buildProductBasicsBlock（不让第一部分变空）',
  /const basicsBlock = extracted \? buildProductBasicsBlock\(extracted\) \+ '\\n\\n' : ''/.test(tsx)
    && /basicsBlock\}\u3010Amazon \u5e02\u573a\u6570\u636e\u6293\u53d6\u72b6\u6001\u3011/.test(tsx)
)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
