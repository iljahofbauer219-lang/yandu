// 千问「中文/英文核心商品词」回复解析：JSON 或 中文：/英文：标记行，坏回复回落空串
export interface LocalCoreTerms {
  zh: string
  en: string
}

// 围栏剥离：带语言标记（json/text）的围栏须紧跟换行才剥，否则「```Hood Cover」会把首个英文词当语言标记吃掉
const cleanFences = (value: string) => value
  .replace(/^```(?:json|text|markdown)?[ \t]*\r?\n/i, '')
  .replace(/^```[ \t]*/i, '')
  .replace(/[ \t\r\n]*```$/i, '')
  .trim()
const squash = (value: string) => value.replace(/\s+/g, ' ').trim()
const stripQuotes = (value: string) => value.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()

function validZh(value: string): string {
  const text = squash(stripQuotes(value)).replace(/[。，,.;；!！?？]+$/g, '')
  if (!text || text.length > 20) return ''
  if (!/[一-鿿]/.test(text)) return ''
  return text
}

function validEn(value: string): string {
  const text = squash(stripQuotes(value)).replace(/[.,;!?]+$/g, '')
  if (!text || text.length > 60) return ''
  if (/[一-鿿]/.test(text)) return ''
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'’\-/]*$/.test(text)) return ''
  const words = text.split(' ').filter(Boolean)
  if (words.length < 1 || words.length > 6) return ''
  if (!words.some(word => /[A-Za-z]{3,}/.test(word))) return ''
  return text
}

function fromRecord(record: Record<string, unknown>): LocalCoreTerms | null {
  let zh = ''
  let en = ''
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') continue
    const lower = key.toLowerCase()
    if (!zh && (lower === 'zh' || lower === 'chinese' || key === '中文' || key === '中文核心商品词' || key === '中文产品')) zh = validZh(value)
    if (!en && (lower === 'en' || lower === 'english' || key === '英文' || key === '英文核心商品词' || key === '英文产品')) en = validEn(value)
  }
  if (!zh && !en) return null
  return { zh, en }
}

export function parseCoreTermsReply(content: string): LocalCoreTerms | null {
  const raw = String(content || '').trim()
  if (!raw) return null
  const clean = cleanFences(raw)
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>
      const terms = fromRecord(parsed)
      if (terms) return terms
    } catch {
      // 继续走标记行回落
    }
  }
  let zh = ''
  let en = ''
  for (const line of clean.split(/\r?\n/)) {
    const match = /^\s*(中文|英文)\s*[:：]\s*(.+)$/.exec(line)
    if (!match) continue
    if (match[1] === '中文' && !zh) zh = validZh(match[2])
    if (match[1] === '英文' && !en) en = validEn(match[2])
  }
  if (!zh && !en) return null
  return { zh, en }
}

// 中文产品名词 → 英文：只接受纯英文名词短语，取首个有效行；坏回复一律空串由调用方给中文原因
const SENTENCE_MARK = /\b(is|are|was|were|this|that|these|those|it|we|you|they|there)\b/i
export function parseCoreTermTranslationReply(content: string): string {
  const clean = cleanFences(String(content || ''))
  for (const line of clean.split(/\r?\n/)) {
    if (SENTENCE_MARK.test(line)) continue
    const text = validEn(line)
    if (text) return text
  }
  return ''
}
