const MONEY = '((?:US\\s?\\$|\\$)\\s?[\\d,.]+(?:\\s*[~～\\-–]\\s*(?:US\\s?\\$|\\$)?\\s?[\\d,.]+)?(?:\\s*/\\s*件)?)'
const ESTIMATED_TOTAL = new RegExp(`预估总额\\s*[（(]?\\s*含物流费\\s*[）)]?\\s*[:：]?\\s{0,3}${MONEY}`)

/**
 * 从供应页/服务器详情页 HTML 中提取「预估总额(含物流费)」金额文本（如 $282.68 /件）。
 * 标签与金额常分处不同 DOM 节点，故先去标签压空白再匹配；未命中返回空串。
 */
export function parseEstimatedTotal(html: string): string {
  const flat = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  const match = ESTIMATED_TOTAL.exec(flat)
  return match?.[1] ? match[1].trim().replace(/\s+/g, ' ') : ''
}
