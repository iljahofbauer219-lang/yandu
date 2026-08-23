#!/usr/bin/env node
/**
 * F 阶段：报告 Word 导出链路 verify 工具。
 *
 * 验证 4 个样例报告能正确转成 .docx：
 *   1. .docx 文件能成功生成（≥ 5KB）
 *   2. .docx 是合法 ZIP（PK\x03\x04 头 + 多个 entry）
 *   3. 4 个样例的 .docx 归档到 artifacts/online-advisor-parity/
 *   4. 元数据正确：H1/H2/表格/列表/段落齐全
 *   5. 纯函数幂等性：相同输入两次输出 size 差 ≤ 64 字节（ZIP 时间戳）
 *   6. 报告 .docx 内容包含原始报告的关键章节（用 JSZip 解 document.xml 检查）
 *   7. 报告样例库文档增加了"Word 导出链路"章节
 *   8. src/shared/reportWordExport.ts 存在 + ≥ 300 行
 *   9. extractReportMetadata 元数据函数可用
 *   10. package.json 已添加 docx 依赖
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function extractDocxXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const docEntry = zip.file('word/document.xml')
  if (!docEntry) return ''
  return await docEntry.async('string')
}

async function main() {
  const samples = [
    { label: 'A', file: 'sample-A-recommend-entry.md', expectedDecision: '✅ 建议入场' },
    { label: 'B', file: 'sample-B-conditional-entry.md', expectedDecision: '⚠️ 有条件谨慎入场' },
    { label: 'C', file: 'sample-C-do-not-enter.md', expectedDecision: '❌ 不建议入场' },
    { label: 'D', file: 'sample-D-insufficient-data.md', expectedDecision: '❓ 数据不足，不能判定' }
  ]

  // ─── 1. 加载纯函数 ───────────────────────────────────────
  const reportWordExportPath = join(root, 'src/shared/reportWordExport.ts')
  assert('src/shared/reportWordExport.ts 存在', existsSync(reportWordExportPath))
  if (!existsSync(reportWordExportPath)) {
    console.log(`${failures} FAILURES`)
    process.exit(1)
  }

  const mod = await import(reportWordExportPath)
  const reportMarkdownToDocxBuffer = mod.reportMarkdownToDocxBuffer
  const extractReportMetadata = mod.extractReportMetadata
  const reportMarkdownToDocxFile = mod.reportMarkdownToDocxFile
  assert('reportMarkdownToDocxBuffer 是函数', typeof reportMarkdownToDocxBuffer === 'function')
  assert('extractReportMetadata 是函数', typeof extractReportMetadata === 'function')
  assert('reportMarkdownToDocxFile 是函数', typeof reportMarkdownToDocxFile === 'function')

  const exportLines = readFileSync(reportWordExportPath, 'utf-8').split('\n')
  assert('reportWordExport.ts ≥ 300 行', exportLines.length >= 300, `lines=${exportLines.length}`)

  // ─── 2. 4 个样例的元数据正确 ──────────────────────────────
  const sampleContents: Record<string, string> = {}
  for (const s of samples) {
    const p = join(root, 'artifacts/online-advisor-parity', s.file)
    if (!existsSync(p)) { assert(`样例 ${s.label} 文件存在`, false); continue }
    sampleContents[s.label] = readFileSync(p, 'utf-8')
  }

  for (const s of samples) {
    const content = sampleContents[s.label]
    if (!content) continue
    const meta = extractReportMetadata(content)
    assert(`样例 ${s.label} 解析出 1 个 H1 主标题`, meta.h1Count === 1, `h1Count=${meta.h1Count} h1=${JSON.stringify(meta.h1Titles)}`)
    assert(`样例 ${s.label} H1 包含「选品分析报告」`, meta.h1Titles.some((t: string) => t.includes('选品分析报告')))
    assert(`样例 ${s.label} H2 ≥ 6（6 部分）`, meta.h2Count >= 6, `h2Count=${meta.h2Count}`)
    assert(`样例 ${s.label} 含表格 ≥ 1`, meta.tableCount >= 1, `tableCount=${meta.tableCount}`)
    // 段落数较少（报告大量用 bullet/table），合并判断：H3 + bullet ≥ 5
    const contentUnits = meta.h3Count + meta.bulletCount + meta.paragraphCount
    assert(`样例 ${s.label} 文本单元 ≥ 5（H3+bullet+para）`, contentUnits >= 5, `h3=${meta.h3Count} bullet=${meta.bulletCount} p=${meta.paragraphCount}`)
    assert(`样例 ${s.label} 含附录 H2`, meta.h2Titles.some((t: string) => t.includes('附录')))
  }

  // ─── 3. .docx 真的能生成 + 归档 ───────────────────────────
  const outputDir = join(root, 'artifacts/online-advisor-parity')
  for (const s of samples) {
    const content = sampleContents[s.label]
    if (!content) continue
    const buf = await reportMarkdownToDocxBuffer(content, { title: `选品分析报告 · 样例 ${s.label}`, author: '砚都跨境·选品分析师' })
    assert(`样例 ${s.label} .docx buffer ≥ 5KB`, buf.length >= 5000, `size=${buf.length}`)

    const header = buf.subarray(0, 4)
    const isZip = header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04
    assert(`样例 ${s.label} .docx 是合法 ZIP（PK\\x03\\x04 头）`, isZip, `bytes=${[...header].map(b => b.toString(16)).join(' ')}`)

    const containsDocumentXml = buf.includes(Buffer.from('word/document.xml'))
    const containsContentTypes = buf.includes(Buffer.from('[Content_Types]'))
    assert(`样例 ${s.label} .docx 含 word/document.xml`, containsDocumentXml)
    assert(`样例 ${s.label} .docx 含 [Content_Types].xml`, containsContentTypes)

    const outPath = join(outputDir, s.file.replace('.md', '.docx'))
    writeFileSync(outPath, buf)
    const stat = statSync(outPath)
    assert(`样例 ${s.label} .docx 归档到 artifacts/online-advisor-parity · ≥5KB`, stat.size >= 5000, `path=${s.file.replace('.md', '.docx')} size=${stat.size}`)
  }

  // ─── 4. 纯函数幂等性：相同输入两次输出 size 接近（ZIP 含时间戳字段） ───
  {
    const content = sampleContents.A
    if (content) {
      const buf1 = await reportMarkdownToDocxBuffer(content, { title: 'test' })
      const buf2 = await reportMarkdownToDocxBuffer(content, { title: 'test' })
      const diff = Math.abs(buf1.length - buf2.length)
      assert('纯函数幂等性：相同输入 size 差 ≤ 64 字节（ZIP 时间戳可漂移）', diff <= 64, `s1=${buf1.length} s2=${buf2.length} diff=${diff}`)
    }
  }

  // ─── 5. .docx 内容含原始报告关键章节（用 JSZip 解 document.xml） ──────
  {
    const buf = await reportMarkdownToDocxBuffer(sampleContents.A, { title: 'test' })
    const xml = await extractDocxXml(buf)
    assert('document.xml 非空', xml.length > 1000, `xml.length=${xml.length}`)
    assert('.docx 含中文「选品分析报告样本 A」', xml.includes('选品分析报告样本 A'))
    assert('.docx 含「第一部分」章节标题', xml.includes('第一部分'))
    assert('.docx 含「附录」章节', xml.includes('附录'))
    assert('.docx 含表格元素 <w:tbl>', xml.includes('<w:tbl>'))
    const paraCount = (xml.match(/<w:p[ >]/g) || []).length
    assert('.docx 段数 ≥ 30', paraCount >= 30, `paraCount=${paraCount}`)
  }

  // ─── 6. 报告样例库文档增加了"Word 导出链路"章节 ───────────
  const libraryPath = join(root, 'docs/选品分析师-报告样例库.md')
  if (existsSync(libraryPath)) {
    const lib = readFileSync(libraryPath, 'utf-8')
    assert('样例库含「Word 导出链路」章节', lib.includes('Word 导出链路') || lib.includes('Word (.docx) 导出'))
    assert('样例库含 reportWordExport.ts 引用', lib.includes('reportWordExport.ts'))
    assert('样例库含 verify-report-word-export.ts 引用', lib.includes('verify-report-word-export.ts'))
    assert('样例库含 .docx 归档路径（artifacts/online-advisor-parity/*.docx）', lib.includes('artifacts/online-advisor-parity') && lib.includes('.docx'))
  } else {
    assert('样例库 docs/选品分析师-报告样例库.md 存在', false)
  }

  // ─── 7. package.json 已添加 docx 依赖 ─────────────────────
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
  assert('package.json dependencies.docx 存在', typeof pkg.dependencies?.docx === 'string' && pkg.dependencies.docx.startsWith('^'), `docx=${pkg.dependencies?.docx}`)

  // ─── 收尾 ─────────────────────────────────────────────
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('FATAL', err)
  process.exit(1)
})
