/**
 * 选品分析报告 → Word (.docx) 导出纯函数。
 *
 * 输入：v1.2 模板 6 部分 markdown 报告（包含附录 systemFact 块）。
 * 输出：JSZip-generated .docx 二进制 buffer（OOXML 2007+）。
 *
 * 设计目标：
 *   1. 纯函数：无副作用，输入 → 输出，相同输入必得相同输出
 *   2. 章节/表格/字号映射清晰，便于用户/客户/工厂直接打开使用
 *   3. 不依赖 Electron，可在 Node 端跑通
 *   4. 6 部分齐全 + 附录 systemFact 块都保留
 *
 * Markdown → docx 元素映射：
 *   - `# 标题`            → Heading 1 (22pt, 黑体加粗)
 *   - `## 二级标题`        → Heading 2 (16pt, 加粗)
 *   - `### 三级标题`        → Heading 3 (13pt, 加粗)
 *   - `- 列表项`           → bullet list
 *   - `1. 列表项`         → numbered list
 *   - `> 引用`            → blockquote (缩进 + 灰字)
 *   - `| col | col |`     → table (带表头 + 边框)
 *   - `---`              → 水平分割线
 *   - `**bold**`          → 加粗 run
 *   - `` `code` ``        → 等宽字体 run
 *   - `[text](url)`       → 超链接
 *   - 普通段落            → 11pt 宋体
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  TabStopType,
  TabStopPosition,
  Footer,
  Header,
  PageNumber,
  ITableCellOptions
} from 'docx'

const FONT_HEADING = '黑体'
const FONT_BODY = '宋体'
const FONT_MONO = 'Consolas'

// ─── Markdown 行级解析 ──────────────────────────────────────

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'bullet' | 'number'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'hr' }
  | { kind: 'table'; header: string[]; rows: string[][] }

function parseMarkdown(md: string): Block[] {
  const lines = md.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('# ')) { blocks.push({ kind: 'h1', text: line.slice(2).trim() }); i += 1; continue }
    if (line.startsWith('## ')) { blocks.push({ kind: 'h2', text: line.slice(3).trim() }); i += 1; continue }
    if (line.startsWith('### ')) { blocks.push({ kind: 'h3', text: line.slice(4).trim() }); i += 1; continue }
    if (line.startsWith('---')) { blocks.push({ kind: 'hr' }); i += 1; continue }
    if (line.startsWith('> ')) { blocks.push({ kind: 'quote', text: line.slice(2).trim() }); i += 1; continue }
    if (line.startsWith('- ') || line.startsWith('* ')) { blocks.push({ kind: 'bullet', text: line.slice(2).trim() }); i += 1; continue }
    const numberMatch = line.match(/^(\d+)\.\s+(.*)$/)
    if (numberMatch) { blocks.push({ kind: 'number', text: numberMatch[2] }); i += 1; continue }
    // 代码块
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i += 1 }
      blocks.push({ kind: 'code', text: buf.join('\n'), lang: lang || undefined })
      i += 1
      continue
    }
    // 表格：必须 ≥ 2 行（第 1 行表头 + 第 2 行 |---|---| 分隔），后面跟着数据行
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const header = parseTableRow(lines[i])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|') && lines[i].trim().length > 0) {
        rows.push(parseTableRow(lines[i]))
        i += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    // 空行 → 跳过
    if (line.trim().length === 0) { i += 1; continue }
    // 普通段落（可能跨行直到空行）
    const buf: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim().length > 0 && !lines[i].startsWith('#') && !lines[i].startsWith('|') && !lines[i].startsWith('- ') && !lines[i].startsWith('* ') && !lines[i].startsWith('> ') && !/^\d+\.\s/.test(lines[i]) && !lines[i].startsWith('```')) {
      buf.push(lines[i])
      i += 1
    }
    blocks.push({ kind: 'p', text: buf.join(' ') })
  }
  return blocks
}

function parseTableRow(line: string): string[] {
  // 跳过首尾的 |，按 | 分割，去掉每个单元格的空白
  const inner = line.replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map(cell => cell.trim())
}

// ─── 内联文本解析（**bold** / `code` / [text](url)）──────────

type InlineRun = { text: string; bold?: boolean; mono?: boolean; href?: string }

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  // 用正则一次扫描：**bold** / `code` / [text](url) / 普通文本
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, m.index) })
    }
    const token = m[0]
    if (token.startsWith('**')) {
      runs.push({ text: token.slice(2, -2), bold: true })
    } else if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), mono: true })
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) runs.push({ text: linkMatch[1], href: linkMatch[2] })
      else runs.push({ text: token })
    }
    lastIndex = m.index + token.length
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) })
  return runs
}

function runsToTextRuns(runs: InlineRun[]): TextRun[] {
  return runs.map(r => {
    if (r.href) {
      return new TextRun({ text: r.text, bold: r.bold, font: r.mono ? FONT_MONO : FONT_BODY, style: 'Hyperlink', color: '0563C1', underline: {} })
    }
    return new TextRun({ text: r.text, bold: r.bold, font: r.mono ? FONT_MONO : FONT_BODY })
  })
}

// ─── Block → docx 元素转换 ─────────────────────────────────

function blockToDocx(block: Block): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'h1':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } })]
    case 'h2':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } })]
    case 'h3':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } })]
    case 'p':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), spacing: { after: 100 } })]
    case 'bullet':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), bullet: { level: 0 }, spacing: { after: 60 } })]
    case 'number':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), numbering: { reference: 'default-numbering', level: 0 }, spacing: { after: 60 } })]
    case 'quote':
      return [new Paragraph({ children: runsToTextRuns(parseInline(block.text)), indent: { left: 360 }, spacing: { after: 100 }, run: { italics: true, color: '666666' } })]
    case 'code': {
      const codeLines = block.text.split('\n')
      return codeLines.map(line => new Paragraph({ children: [new TextRun({ text: line, font: FONT_MONO, size: 18 })], spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, fill: 'F4F4F4' } }))
    }
    case 'hr':
      return [new Paragraph({ border: { bottom: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 120, after: 120 } })]
    case 'table': {
      const headerCells = block.header.map(cell => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: cell, bold: true, font: FONT_HEADING })], alignment: AlignmentType.LEFT })],
        shading: { type: ShadingType.CLEAR, fill: 'E7E6E6' },
        width: { size: Math.floor(100 / block.header.length), type: WidthType.PERCENTAGE }
      }))
      const dataRows = block.rows.map(row => new TableRow({
        children: row.map(cell => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: cell, font: FONT_BODY })] })],
          width: { size: Math.floor(100 / block.header.length), type: WidthType.PERCENTAGE }
        }))
      }))
      return [new Table({
        rows: [new TableRow({ children: headerCells, tableHeader: true }), ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE }
      })]
    }
  }
}

// ─── 主入口：reportMarkdownToDocxBuffer ──────────────────────

/**
 * 把 markdown 报告转成 .docx 二进制 buffer。
 * @param markdown v1.2 模板 6 部分报告（包含附录）
 * @param options.title 报告主标题（用于页眉）
 * @param options.author 作者（用于文档元数据）
 * @returns Promise<Buffer> .docx 文件二进制
 */
export async function reportMarkdownToDocxBuffer(
  markdown: string,
  options: { title?: string; author?: string } = {}
): Promise<Buffer> {
  const blocks = parseMarkdown(markdown)
  const children: (Paragraph | Table)[] = []
  for (const b of blocks) children.push(...blockToDocx(b))

  const title = options.title || '选品分析报告'
  const doc = new Document({
    creator: options.author || '砚都跨境·选品分析师',
    title,
    description: '由 砚都跨境·选品分析师 自动生成',
    styles: {
      default: {
        document: { run: { font: FONT_BODY, size: 22 } }  // 11pt
      }
    },
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.LEFT
        }]
      }]
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }  // 1 inch
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: title, font: FONT_HEADING, size: 18, color: '999999' })],
            alignment: AlignmentType.RIGHT
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [new TextRun({ text: '第 ', font: FONT_BODY, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: 18 }), new TextRun({ text: ' 页 / 共 ', font: FONT_BODY, size: 18 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_BODY, size: 18 }), new TextRun({ text: ' 页', font: FONT_BODY, size: 18 })],
            alignment: AlignmentType.CENTER
          })]
        })
      },
      children
    }]
  })

  return Packer.toBuffer(doc)
}

/**
 * 把 markdown 报告保存成 .docx 文件。
 * @param markdown 报告内容
 * @param filePath 输出文件绝对路径
 * @param options 同 reportMarkdownToDocxBuffer
 */
export async function reportMarkdownToDocxFile(
  markdown: string,
  filePath: string,
  options: { title?: string; author?: string } = {}
): Promise<void> {
  const buf = await reportMarkdownToDocxBuffer(markdown, options)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(filePath, buf)
}

/**
 * 提取 markdown 报告的元数据：标题、各章节标题、表格数、链接数。
 * 用于 verify-report-word-export.ts 的断言检查。
 */
export function extractReportMetadata(markdown: string): {
  h1Count: number; h2Count: number; h3Count: number
  tableCount: number; bulletCount: number; paragraphCount: number
  linkCount: number; boldCount: number; codeBlockCount: number
  h1Titles: string[]; h2Titles: string[]; h3Titles: string[]
  byteLength: number
} {
  const blocks = parseMarkdown(markdown)
  const meta = {
    h1Count: 0, h2Count: 0, h3Count: 0,
    tableCount: 0, bulletCount: 0, paragraphCount: 0,
    linkCount: 0, boldCount: 0, codeBlockCount: 0,
    h1Titles: [] as string[], h2Titles: [] as string[], h3Titles: [] as string[],
    byteLength: Buffer.byteLength(markdown, 'utf-8')
  }
  for (const b of blocks) {
    if (b.kind === 'h1') { meta.h1Count += 1; meta.h1Titles.push(b.text) }
    if (b.kind === 'h2') { meta.h2Count += 1; meta.h2Titles.push(b.text) }
    if (b.kind === 'h3') { meta.h3Count += 1; meta.h3Titles.push(b.text) }
    if (b.kind === 'p') meta.paragraphCount += 1
    if (b.kind === 'bullet') meta.bulletCount += 1
    if (b.kind === 'table') meta.tableCount += 1
    if (b.kind === 'code') meta.codeBlockCount += 1
    // 统计行内特征
    const text = 'text' in b ? b.text : ''
    meta.linkCount += (text.match(/\[[^\]]+\]\([^)]+\)/g) || []).length
    meta.boldCount += (text.match(/\*\*[^*]+\*\*/g) || []).length
  }
  return meta
}
