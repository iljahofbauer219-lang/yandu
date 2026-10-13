// 千问核心商品词回复解析：只接受英文名词短语，坏回复/中文/超长一律 null 供规则回落
export function parseResearchQueryReply(content: string): string | null {
  const raw = String(content || '').trim()
  if (!raw) return null
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let text = ''
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>
      const candidate = [parsed.query, parsed.core, parsed.keyword, parsed.term].find(value => typeof value === 'string')
      text = String(candidate || '').trim()
    } catch {
      text = ''
    }
  }
  if (!text) text = clean.split(/\r?\n/).map(line => line.trim()).find(Boolean) || ''
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 60) return null
  if (/[一-鿿]/.test(text)) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'’\-/]*$/.test(text)) return null
  const words = text.split(' ').filter(Boolean)
  if (words.length < 1 || words.length > 6) return null
  if (!words.some(word => /[A-Za-z]{3,}/.test(word))) return null
  return text
}
