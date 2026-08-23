export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)

function tableCells(line: string): string[] {
  const content = line.trim().slice(1, -1)
  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const character of content) {
    if (escaped) {
      // GFM 表格里 \| 表示单元格内的字面量竖线，不能当作分列符。
      cell += character === '|' ? '|' : `\\${character}`
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += character
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|')
}

function isTableDivider(line: string): boolean {
  return isTableRow(line) && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell))
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** 将报告中的 GFM 表格转为 Word/WPS 可识别的 HTML 表格；普通段落不再包进 pre。 */
export function renderMarkdownForWord(content: string): string {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isTableRow(line) && isTableDivider(lines[index + 1] || '')) {
      const headers = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && isTableRow(lines[index]) && !isTableDivider(lines[index])) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      index -= 1
      const cellStyle = 'border:1.5pt solid #000000;padding:7px 8px;vertical-align:top;text-align:left'
      const head = headers.map(cell => `<th style="${cellStyle}">${inlineMarkdown(cell)}</th>`).join('')
      const body = rows.map(cells => `<tr>${headers.map((_, column) => `<td style="${cellStyle}">${inlineMarkdown(cells[column] || '')}</td>`).join('')}</tr>`).join('')
      blocks.push(`<table border="1" bordercolor="#000000" cellspacing="0" cellpadding="0" style="border:1.5pt solid #000000"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length + 1
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    blocks.push(`<p>${inlineMarkdown(trimmed)}</p>`)
  }
  return blocks.join('\n') || '<p>（无内容）</p>'
}

export const wordDocumentCss = `@page{size:A4 landscape;margin:1.2cm}body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#202424;margin:0;line-height:1.65}h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;margin:28px 0 10px;padding-bottom:7px;border-bottom:1px solid #e5e8e8}h3{font-size:15px;margin:20px 0 8px}p{font-size:14px;margin:0 0 10px;word-break:break-word}.meta{color:#66706f;font-size:12px}section{page-break-inside:auto}table{width:100%;border-collapse:collapse;border:1.5pt solid #000000;margin:12px 0 18px;table-layout:auto}th,td{border:1.5pt solid #000000;padding:7px 8px;vertical-align:top;text-align:left;font-size:12px;line-height:1.45;word-break:break-word}th{font-weight:700;background:#f3f3f3}code{font-family:Menlo,Consolas,monospace}`
