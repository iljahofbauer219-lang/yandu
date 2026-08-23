/**
 * 《跨境AI选品调研员·标准分析报告.docx》的机器可校验格式合同。
 *
 * 该合同只定义交付结构，不承载模型生成的数据。选品调研员和
 * 选品分析师（Amazon-Skills）都必须向同一份 payload 填充内容，最终由
 * 渲染器按本合同输出 Markdown 与 Word，避免模型自行增删章节或改表头。
 */

export const SELECTION_REPORT_TEMPLATE_REFERENCE = {
  fileName: '跨境AI选品调研员·标准分析报告.docx',
  sha256: '7b61fdbd0904a752f6051f121a27c71a896d9912bfb66e04c6c01993df6e0ecc',
  version: '2026-08-17',
  outputRules: '六大部分、11张原生表格；Word 表格为黑色边框。'
} as const

export interface SelectionReportTableContract {
  id: string
  title: string
  columns: readonly string[]
}

export interface SelectionReportSectionContract {
  id: string
  title: string
  tables: readonly SelectionReportTableContract[]
}

export const SELECTION_REPORT_TEMPLATE: readonly SelectionReportSectionContract[] = [
  {
    id: 'part-1', title: '第一部分：本品基础信息解析', tables: [
      { id: 'product-basics', title: '本品基础信息表', columns: ['信息分类', '明细项', '本品数据', '备注'] }
    ]
  },
  {
    id: 'part-2', title: '第二部分：目标平台细分市场大盘调研', tables: [
      { id: 'market-overview', title: '2.1 细分市场大盘数据', columns: ['统计指标', '大盘数据', '区间分布', '市场判断'] },
      { id: 'category-recommendation', title: '2.2 类目推荐', columns: ['推荐类目', '类目路径', '推荐理由', '竞争程度', '机会判断', '备注'] },
      { id: 'compliance-ip', title: '2.3 合规与IP风险', columns: ['核验项', '本品情况', '平台/法规要求', '证据与来源', '处理建议'] }
    ]
  },
  {
    id: 'part-3', title: '第三部分：本品与核心竞品多维对比', tables: [
      { id: 'core-competitors', title: '核心竞品对比表', columns: ['对比维度', '本品', '竞品1', '竞品2', '竞品3', '结论'] }
    ]
  },
  {
    id: 'part-4', title: '第四部分：头部竞店竞争实力拆解', tables: [
      { id: 'top-stores', title: '头部竞店拆解表', columns: ['竞店/品牌', '核心产品', '价格带', '评分/评论', '流量/销量线索', '差异化卖点', '运营动作', '可借鉴点'] }
    ]
  },
  {
    id: 'part-5', title: '第五部分：入市机会与盈利可行性判定', tables: [
      { id: 'profitability', title: '5.1 利润测算表', columns: ['测算项目', '快速市场口径', '全成本口径', '证据/说明'] },
      { id: 'opportunity', title: '5.2 入市机会评估表', columns: ['评估维度', '证据与结果', '风险', '建议动作'] },
      { id: 'entry-decision', title: '5.3 最终入市判定', columns: ['决策项', '结论'] }
    ]
  },
  {
    id: 'part-6', title: '第六部分：产品改良方案与长期市场机会', tables: [
      { id: 'improvement', title: '6.1 本品改良优化清单表', columns: ['改良方向', '具体优化方案', '对应痛点/竞品', '改造成本', '预期效果'] },
      { id: 'long-term-opportunity', title: '6.2 长期市场机会', columns: ['机会方向', '验证与落地建议'] }
    ]
  }
] as const

export const SELECTION_REPORT_REQUIRED_TABLE_COUNT = SELECTION_REPORT_TEMPLATE.reduce((count, section) => count + section.tables.length, 0)

function markdownTableHeaders(content: string): string[][] {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n')
  const headers: string[][] = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index].trim()
    const divider = lines[index + 1].trim()
    if (!/^\|.+\|$/.test(header) || !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(divider)) continue
    headers.push(header.slice(1, -1).split('|').map(cell => cell.trim()))
  }
  return headers
}

/** 校验 Markdown 是否仍是参考 DOCX 规定的六部分、11 表格及其列名。 */
export function validateSelectionReportTemplate(content: string): string[] {
  const source = String(content || '')
  const issues: string[] = []
  const tables = markdownTableHeaders(source)
  for (const section of SELECTION_REPORT_TEMPLATE) {
    if (!source.includes(`## ${section.title}`)) issues.push(`缺少固定章节：${section.title}`)
    for (const table of section.tables) {
      const present = tables.some(headers => headers.length === table.columns.length && table.columns.every((column, index) => headers[index] === column))
      if (!present) issues.push(`缺少固定表格或表头不一致：${table.title}`)
    }
  }
  if (tables.length < SELECTION_REPORT_REQUIRED_TABLE_COUNT) issues.push(`固定表格数量不足：应至少 ${SELECTION_REPORT_REQUIRED_TABLE_COUNT} 张，实际 ${tables.length} 张`)
  return issues
}
