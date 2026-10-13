// 核心商品词短语变体：千问拟定稿解析 + 已成交样本统计佐证（纯函数，单测覆盖）
export function normalizeVariantToken(token: string): string {
  if (token.length <= 4) return token
  if (/(?:ch|sh|x)es$/.test(token)) return token.slice(0, -2)
  if (/ies$/.test(token)) return `${token.slice(0, -3)}y`
  if (/[bcdfgklmnprtvz]es$/.test(token)) return token.slice(0, -1)
  if (/[bcdfghjklmnpqrtvwxz]s$/.test(token)) return token.slice(0, -1)
  return token
}

const variantTokens = (text: string) => (text.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || []).map(normalizeVariantToken).filter(Boolean)

export function parseCoreTermVariants(content: string): string[] {
  const raw = String(content || '').trim()
  if (!raw) return []
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let candidates: string[] = []
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1)) as unknown
      if (Array.isArray(parsed)) candidates = parsed.map(item => (typeof item === 'string' ? item : String((item as Record<string, unknown>)?.variant || (item as Record<string, unknown>)?.term || '')))
    } catch { candidates = [] }
  }
  if (!candidates.length) candidates = clean.split(/\r?\n/).map(line => line.replace(/^[\s\d.)-]+/, '').trim())
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    const text = candidate.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 60) continue
    if (/[一-鿿]/.test(text)) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9 &'’\-/]*$/.test(text)) continue
    const words = text.split(' ').filter(Boolean)
    if (words.length < 2 || words.length > 6) continue
    const key = variantTokens(text).join(' ')
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= 20) break
  }
  return result
}

/** 佐证门槛：回数≥2 或覆盖≥5%；变体必须包含核心商品词全部词元；按回数降序取前 14 */
export function backCoreTermVariants(variants: string[], coreQuery: string, sampleTitles: string[]): { term: string; count: number; coverage: number }[] {
  const coreTokens = variantTokens(coreQuery)
  if (!coreTokens.length) return []
  const titleTokenSets = sampleTitles.map(title => new Set(variantTokens(title)))
  if (!titleTokenSets.length) return []
  const seenSets = new Set<string>()
  const backed: { term: string; count: number; coverage: number }[] = []
  for (const variant of variants) {
    const tokens = variantTokens(variant)
    if (!coreTokens.every(token => tokens.includes(token))) continue
    const setKey = [...tokens].sort().join(' ')
    if (seenSets.has(setKey)) continue
    seenSets.add(setKey)
    const count = titleTokenSets.filter(set => tokens.every(token => set.has(token))).length
    const coverage = Math.round(count / titleTokenSets.length * 100)
    if (count >= 2 || coverage >= 5) backed.push({ term: variant.replace(/\s+/g, ' ').trim(), count, coverage })
  }
  return backed.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)).slice(0, 14)
}
