import type { SelectionReportPayload } from './selectionReportPayload'
import { validateSelectionReportPayload } from './selectionReportPayload'
import { SELECTION_REPORT_TEMPLATE, validateSelectionReportTemplate } from './selectionReportTemplate'
import type { SelectionReportEnrichment } from './selectionReportEnrichment'

function markdownCell(value: string): string {
  return String(value || '待验证').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim() || '待验证'
}

function markdownTable(columns: string[], rows: string[][]): string {
  return [
    `| ${columns.map(markdownCell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(markdownCell).join(' | ')} |`)
  ].join('\n')
}

/**
 * 确定性报告渲染：标题、平台、章节、表头和表格均只来自结构事实包。
 * 这里不拼接模型原文，防止模型改平台、删表、改变列名或输出 /tmp 路径。
 */
export function renderSelectionReportMarkdown(payload: SelectionReportPayload, enrichment?: SelectionReportEnrichment | null): string {
  const payloadIssues = validateSelectionReportPayload(payload)
  if (payloadIssues.length) throw new Error(`报告事实包不合法：${payloadIssues.join('；')}`)
  const lines = [
    `# ${markdownCell(payload.productName)} · ${markdownCell(payload.targetPlatform)}选品分析报告`,
    '',
    `> 报告状态：${payload.status}｜数据截止：${payload.generatedAt.slice(0, 10)}｜目标平台：${markdownCell(payload.targetPlatform)}｜履约：FBA｜币种：USD`,
    '> 说明：所有“待验证”字段均未被系统事实包证实，不能据此推导确定性市场、合规或利润结论。',
    ''
  ]
  const insightByAsin = new Map((enrichment?.listingInsights || []).map(item => [item.asin.toUpperCase(), item]))
  const improvementByDirection = new Map((enrichment?.improvementInsights || []).map(item => [item.direction, item]))
  for (const section of payload.sections) {
    lines.push(`## ${section.title}`, '')
    for (const table of section.tables) {
      const rows = table.id === 'top-stores'
        ? table.rows.map(row => {
          const asin = row[1]?.match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase()
          const insight = asin ? insightByAsin.get(asin) : null
          if (!insight) return row
          const trace = row[7] === '待验证' ? '' : `${row[7]}；`
          return [...row.slice(0, 7), `${trace}页面要素归纳（待验证）：${insight.observation}；借鉴方向：${insight.learning}`]
        })
        : table.id === 'improvement'
          ? table.rows.map(row => {
            const insight = improvementByDirection.get(row[0] as '外观/结构改良' | '规格/SKU拓展')
            if (!insight) return row
            return [row[0], `页面要素归纳（待验证）：${insight.proposal}`, `DIRECT详情页：${insight.asins.join('、')}`, row[3], '待小批量验证']
          })
        : table.rows
      lines.push(`### ${table.title}`, markdownTable(table.columns, rows), '')
    }
  }
  lines.push('## 报告结论与待办', '')
  lines.push(`- 系统入市结论：${payload.decision}`)
  lines.push('- 必做验证：补齐包装尺寸/毛重、Amazon FBA履约费、全成本物流税费区间、合规/IP检索，以及同一核心用途、同一形态、同一对象的DIRECT竞品证据。')
  if (enrichment?.hypotheses.length || enrichment?.validationTasks.length || enrichment?.listingInsights.length || enrichment?.improvementInsights.length) {
    lines.push('- 受控分析补充：以下为模型提出的待验证假设/任务，不作为系统事实或入市决策依据。')
    enrichment.listingInsights.forEach(item => lines.push(`  - 页面要素归纳（待验证，${item.asin}）：${markdownCell(item.observation)}；借鉴方向：${markdownCell(item.learning)}`))
    enrichment.improvementInsights.forEach(item => lines.push(`  - 改良方向（待验证，${item.direction}）：${markdownCell(item.proposal)}；依据DIRECT详情页：${item.asins.join('、')}`))
    enrichment.hypotheses.forEach(item => lines.push(`  - 分析假设（待验证）：${markdownCell(item)}`))
    enrichment.validationTasks.forEach(item => lines.push(`  - 验证任务：${markdownCell(item)}`))
  }
  return lines.join('\n').trim() + '\n'
}

/**
 * 最后一层交付兜底：即使上游事实包异常，也输出模板合同内的预备报告，
 * 而不是向用户暴露错误消息或本地文件路径。此函数只使用固定模板与平台锁定值。
 */
export function renderSelectionReportFallback(productName: string, targetPlatform: string): string {
  const safeProductName = markdownCell(productName)
  const safePlatform = markdownCell(targetPlatform)
  const lines = [
    `# ${safeProductName} · ${safePlatform}选品分析报告`,
    '',
    `> 报告状态：预备｜数据截止：待验证｜目标平台：${safePlatform}｜履约：FBA｜币种：USD`,
    '> 说明：上游数据或渲染校验异常，系统已保留固定模板预备报告；所有字段均需重新核验。',
    ''
  ]
  for (const section of SELECTION_REPORT_TEMPLATE) {
    lines.push(`## ${section.title}`, '')
    for (const table of section.tables) {
      const columns = [...table.columns]
      lines.push(`### ${table.title}`, markdownTable(columns, [columns.map(() => '待验证')]), '')
    }
  }
  lines.push('## 报告结论与待办', '')
  lines.push('- 系统入市结论：❓ 数据不足，不能判定')
  lines.push('- 必做验证：重新提取商品身份、三组检索词的DIRECT样本、费用与合规/IP证据后再生成正式评估。')
  return lines.join('\n').trim() + '\n'
}

/** 渲染后再次验证格式合同，供保存/导出前调用。 */
export function validateRenderedSelectionReport(content: string): string[] {
  return validateSelectionReportTemplate(content)
}
