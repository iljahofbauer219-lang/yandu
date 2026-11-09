/**
 * C 批 #6「通用语义兜底抽取」的纯函数层。
 *
 * 场景：结构化选择器读全了页面但漏了个别字段（标题/价格/描述），此前只能按 C4 口径报「字段没读全」。
 * 兜底做法是把页面原文压成摘要交给大模型**摘录**，不是让它「总结/补全」。
 *
 * 三条硬口径（都落在本文件，可单测）：
 *   1. 逐字闸门：兜底值必须在摘要里逐字可寻（折叠空白、忽略大小写后仍是子串），否则判为改写/编造并拒收；
 *      价格还要求成货币样子。理由见「一旦兜底值看起来像真值，就违反不伪造成功」。
 *   2. 只补空缺：调用方只在结构化实测缺失的字段上采用兜底值，实测值永不被兜底值覆盖。
 *   3. 必带来源标记：结果只配 SEMANTIC_FALLBACK_LABEL 与 semanticFallbackNote() 一起落地、一起显示，不混进实测字段。
 * 摘要预算、闸门阈值、字段清单改动都会让 semanticFallback.test.ts 先红。
 */

export const SEMANTIC_FALLBACK_LABEL = '语义兜底'

export type SemanticField = 'title' | 'price' | 'descriptionText' | 'condition'

export interface SemanticPage {
  url: string
  documentTitle: string
  headings: string[]
  bodyText: string
}

export interface SemanticDigest {
  markdown: string
  truncated: boolean
}

const FIELD_LABELS: Record<SemanticField, string> = {
  title: '标题',
  price: '价格',
  descriptionText: '商品描述',
  condition: '物品状况',
}

/** 正文太短时原文不足以支撑逐字摘录，兜底只会造出真值样子的东西，直接不试。 */
const MIN_BODY_CHARS = 300
const DEFAULT_DIGEST_BUDGET = 4_000

export function normalizeSemanticText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function buildSemanticDigest(page: SemanticPage, budget = DEFAULT_DIGEST_BUDGET): SemanticDigest {
  const lines = [`URL: ${normalizeSemanticText(page.url)}`, `页面标题: ${normalizeSemanticText(page.documentTitle)}`]
  const headings = page.headings.map(normalizeSemanticText).filter(Boolean).slice(0, 12).map(heading => heading.slice(0, 160))
  if (headings.length) lines.push('小标题:', ...headings.map(heading => `- ${heading}`))
  lines.push('正文:', normalizeSemanticText(page.bodyText))
  const markdown = lines.join('\n')
  if (markdown.length <= budget) return { markdown, truncated: false }
  const head = markdown.slice(0, budget)
  const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'))
  return { markdown: normalizeSemanticText(boundary > 0 ? head.slice(0, boundary) : head), truncated: true }
}

export function shouldAttemptSemanticFallback(input: { page: SemanticPage; missingFields: SemanticField[] }): boolean {
  if (!input.missingFields.length) return false
  return normalizeSemanticText(input.page.bodyText).length >= MIN_BODY_CHARS
}

export function buildSemanticExtractionMessages(digest: string, fields: SemanticField[]): { messages: Array<{ role: 'system' | 'user', content: string }> } {
  const wanted = fields.map(field => FIELD_LABELS[field]).join('、')
  return {
    messages: [
      {
        role: 'system',
        content: `你是跨境电商商品页字段摘录助手。只允许从给定「页面原文摘要」里逐字摘录，禁止总结、改写、翻译、补全或根据常识推断。`
          + `每个字段要么给出摘要里原样存在的文本，要么给 null。字段都找不到就全部返回 null，不要勉强。只输出 JSON，形如 {"title":null,"price":null}。`,
      },
      {
        role: 'user',
        content: `需要补齐的字段（JSON 键）：${JSON.stringify(fields)}（${wanted}）。\n\n页面原文摘要：\n${digest}`,
      },
    ],
  }
}

export interface SemanticExtractionResult {
  applied: boolean
  fields: Partial<Record<SemanticField, string>>
  rejected: Array<{ field: SemanticField, reason: string }>
}

const PRICE_SHAPE = /^(?:[A-Z]{2,3}\s?)?[€£$]\s?\d[\d,]*(?:\.\d{1,2})?$|^\d[\d,]*(?:\.\d{1,2})?\s?[A-Z]{3}$/

export function parseSemanticExtractionReply(raw: string, digest: string, fields: SemanticField[]): SemanticExtractionResult {
  const haystack = normalizeSemanticText(digest).toLowerCase()
  let payload: Record<string, unknown>
  try {
    const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    if (!text) throw new Error('空回复')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是对象')
    payload = parsed as Record<string, unknown>
  } catch {
    return { applied: false, fields: {}, rejected: fields.map(field => ({ field, reason: '模型未按约定返回 JSON，整批拒收' })) }
  }
  const result: SemanticExtractionResult = { applied: false, fields: {}, rejected: [] }
  for (const field of fields) {
    const value = typeof payload[field] === 'string' ? normalizeSemanticText(payload[field] as string) : ''
    if (!value) { result.rejected.push({ field, reason: '模型未给出该字段' }); continue }
    if (!haystack.includes(value.toLowerCase())) {
      result.rejected.push({ field, reason: '该值无法在页面原文摘要里逐字找到，判为改写或编造，拒收' })
      continue
    }
    if (field === 'price' && !PRICE_SHAPE.test(value)) {
      result.rejected.push({ field, reason: '价格不是成货币样子（缺币种或金额），拒收' })
      continue
    }
    result.fields[field] = value
    result.applied = true
  }
  return result
}

export function semanticFallbackNote(fields: SemanticField[]): string {
  if (!fields.length) return ''
  return `${fields.map(field => FIELD_LABELS[field]).join('、')}来自${SEMANTIC_FALLBACK_LABEL}（按页面原文逐字摘录，非结构化实测），请人工核对后再发布。`
}

export interface SemanticFallbackMark {
  label: string
  fields: SemanticField[]
  at: string
  note: string
  rejected: Array<{ field: SemanticField, reason: string }>
}

/**
 * 标记只能描述「眼前这一份落库值」：值被结构化实测覆盖、被用户手改或被别的来源刷新后，
 * 对应字段必须从标记里摘掉；一条都不剩时返回 undefined，避免空壳标记冒充「兜底过」。
 */
export function pruneSemanticFallbackMark(
  mark: SemanticFallbackMark | undefined,
  persisted: object,
  source: object,
): SemanticFallbackMark | undefined {
  if (!mark) return undefined
  const next = persisted as Record<string, unknown>
  const given = source as Record<string, unknown>
  const fields = mark.fields.filter(field => {
    const value = String(next[field] ?? '').trim()
    return Boolean(value) && value === String(given[field] ?? '').trim()
  })
  if (!fields.length) return undefined
  return { ...mark, fields, note: semanticFallbackNote(fields) }
}

/**
 * 兜底值落进结果对象的唯一入口：只填空字段，实测值一个字都不动。
 * 一条都没收下时原样返回、不挂标记，避免留下空壳标记冒充「兜底过」。
 */
export function mergeSemanticFallback<T extends Record<string, unknown>>(
  target: T,
  result: SemanticExtractionResult,
  at: string,
): { target: T, mark?: SemanticFallbackMark } {
  const merged = { ...target } as Record<string, unknown>
  const applied: SemanticField[] = []
  for (const field of Object.keys(result.fields) as SemanticField[]) {
    const value = result.fields[field]
    if (!value) continue
    if (String(merged[field] ?? '').trim()) continue
    merged[field] = value
    applied.push(field)
  }
  if (!applied.length) return { target }
  return {
    target: merged as T,
    mark: { label: SEMANTIC_FALLBACK_LABEL, fields: applied, at, note: semanticFallbackNote(applied), rejected: result.rejected },
  }
}
