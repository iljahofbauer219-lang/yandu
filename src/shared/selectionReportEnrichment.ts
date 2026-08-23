import type { SelectionReportPayload } from './selectionReportPayload'

export interface SelectionReportEnrichment {
  /** 仅允许作为“待验证的分析假设”显示，不能作为事实、费用或最终决策。 */
  hypotheses: string[]
  /** 可执行的补数/核验动作；不会覆盖系统固定的验证清单。 */
  validationTasks: string[]
  /** 仅针对已采集的详情页 ASIN 的受控页面要素归纳；不覆盖原始字段和来源。 */
  listingInsights: Array<{ asin: string; observation: string; learning: string }>
  /** DIRECT 详情页要素驱动的改良假设；仅能改写 6.1 的待验证建议，不能写成本或效果事实。 */
  improvementInsights: Array<{ direction: '外观/结构改良' | '规格/SKU拓展'; proposal: string; asins: string[] }>
  sourceModelId?: string
}

const MAX_ITEMS_PER_KIND = 4
const MAX_ITEM_LENGTH = 180
const DECISION_TERMS = /建议入场|有条件谨慎入场|不建议入场|数据不足，不能判定/i
const UNSAFE_MARKDOWN = /(?:^|\s)#{1,6}\s|\||```|<\/?(?:table|script|style)/i
const MARKETPLACE_TERMS = /amazon|ebay|ozon|temu|tiktok|lazada|emag/i

function cleanItem(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || text.length > MAX_ITEM_LENGTH || UNSAFE_MARKDOWN.test(text) || DECISION_TERMS.test(text) || MARKETPLACE_TERMS.test(text)) return null
  return text
}

function items(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(cleanItem).filter((item): item is string => Boolean(item)))].slice(0, MAX_ITEMS_PER_KIND)
}

function listingInsights(value: unknown, allowedAsins: readonly string[]): SelectionReportEnrichment['listingInsights'] {
  if (!Array.isArray(value) || !allowedAsins.length) return []
  const allowed = new Set(allowedAsins.map(asin => String(asin || '').trim().toUpperCase()))
  const seen = new Set<string>()
  const result: SelectionReportEnrichment['listingInsights'] = []
  for (const valueItem of value) {
    if (!valueItem || typeof valueItem !== 'object' || Array.isArray(valueItem)) continue
    const record = valueItem as Record<string, unknown>
    const asin = typeof record.asin === 'string' ? record.asin.trim().toUpperCase() : ''
    const observation = cleanItem(record.observation)
    const learning = cleanItem(record.learning)
    if (!allowed.has(asin) || seen.has(asin) || !observation || !learning) continue
    seen.add(asin)
    result.push({ asin, observation, learning })
    if (result.length >= MAX_ITEMS_PER_KIND + 1) break
  }
  return result
}

function improvementInsights(value: unknown, allowedAsins: readonly string[]): SelectionReportEnrichment['improvementInsights'] {
  if (!Array.isArray(value) || !allowedAsins.length) return []
  const allowed = new Set(allowedAsins.map(asin => String(asin || '').trim().toUpperCase()))
  const allowedDirections = new Set(['外观/结构改良', '规格/SKU拓展'])
  const seen = new Set<string>()
  const result: SelectionReportEnrichment['improvementInsights'] = []
  for (const valueItem of value) {
    if (!valueItem || typeof valueItem !== 'object' || Array.isArray(valueItem)) continue
    const record = valueItem as Record<string, unknown>
    const direction = typeof record.direction === 'string' ? record.direction.trim() : ''
    const proposal = cleanItem(record.proposal)
    const asins = Array.isArray(record.asins)
      ? [...new Set(record.asins.map(item => typeof item === 'string' ? item.trim().toUpperCase() : '').filter(asin => allowed.has(asin)))].slice(0, 3)
      : []
    if (!allowedDirections.has(direction) || seen.has(direction) || !proposal || !asins.length) continue
    seen.add(direction)
    result.push({ direction: direction as '外观/结构改良' | '规格/SKU拓展', proposal, asins })
  }
  return result
}

function extractJson(content: string): unknown {
  const text = String(content || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || text
  try { return JSON.parse(candidate) } catch { return null }
}

/**
 * 模型输出只能是两个字符串数组。解析失败或命中结论/Markdown/HTML注入时，整段补充被丢弃。
 * 这让模型只能补充待核验思路，不能改标题、平台、表格、数字事实或系统入场结论。
 */
export function parseSelectionReportEnrichment(content: string, sourceModelId?: string, allowedAsins: readonly string[] = []): SelectionReportEnrichment | null {
  const parsed = extractJson(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const hypotheses = items(record.hypotheses)
  const validationTasks = items(record.validationTasks)
  const insights = listingInsights(record.listingInsights, allowedAsins)
  const improvements = improvementInsights(record.improvementInsights, allowedAsins)
  if (!hypotheses.length && !validationTasks.length && !insights.length && !improvements.length) return null
  return { hypotheses, validationTasks, listingInsights: insights, improvementInsights: improvements, sourceModelId }
}

/** 交给模型的最小、只读补充任务；报告正文永远由确定性渲染器负责。 */
export function selectionReportEnrichmentPrompt(payload: SelectionReportPayload): string {
  const allowedAsins = (payload.listingEvidence || []).map(item => item.asin).filter(Boolean)
  return [
    '你是选品报告的受控补充助手。只能基于下方只读事实包提出待验证的分析假设、验证任务和已采集详情页的页面要素归纳。',
    '严禁输出 Markdown、表格、标题、平台、价格、销量、评分、评论、费用、合规/IP结论、入场结论或本地文件路径。',
    '不得把未知信息补成事实；不得写“建议入场”“有条件谨慎入场”“不建议入场”“数据不足，不能判定”。',
    '只返回合法 JSON：{"hypotheses":["不超过4条，每条180字内"],"validationTasks":["不超过4条，每条180字内"],"listingInsights":[{"asin":"只可使用允许ASIN","observation":"不超过180字","learning":"不超过180字"}],"improvementInsights":[{"direction":"外观/结构改良或规格/SKU拓展","proposal":"不超过180字","asins":["只可使用允许ASIN"]}]}。',
    'hypotheses 必须是待验证的竞争/差异化假设；validationTasks 必须是可执行的补数或核验动作。',
    `listingInsights 只可使用以下允许 ASIN：${allowedAsins.join('、') || '无'}。observation 只能概括该 ASIN 已采集的卖点、徽标、变体或促销；learning 是待验证的借鉴方向。不得引入未出现的新页面事实。`,
    'improvementInsights 只能给“外观/结构改良”或“规格/SKU拓展”提出待验证方案，asins 必须来自允许 ASIN；不得输出成本、销量、利润、合规结论或预期效果事实。',
    `【只读事实包】\n${JSON.stringify(payload)}`
  ].join('\n')
}
