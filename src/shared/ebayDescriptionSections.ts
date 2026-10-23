// eBay 描述优化详情页的固定区块顺序与「详细规格 / 包装内容」分区规则：
// 详细规格不得包含包装类行；规格行与包装行出现同一组尺寸/重量数值时只在包装内容保留一份。
export interface EbayDescriptionSectionLike {
  id: string
  title: string
  content: string
}

const DESCRIPTION_SECTION_ORDER: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'SUMMARY', title: 'Product Overview' },
  { id: 'SPECIFICATIONS', title: 'Detailed Specifications' },
  { id: 'FEATURES', title: 'Verified Features' },
  { id: 'PACKAGE', title: 'Package Contents' },
  { id: 'INSTALLATION', title: 'Installation & Setup' },
  { id: 'CARE', title: 'Care & Important Notes' },
  { id: 'PROBLEMS', title: 'Customer Problems & Solutions' },
  { id: 'SCENARIOS', title: 'Recommended Use Scenarios' },
]

const SECTION_ORDER = new Map(DESCRIPTION_SECTION_ORDER.map((section, index) => [section.id, index] as const))
const SECTION_ID_BY_TITLE = new Map(DESCRIPTION_SECTION_ORDER.map(section => [section.title.toUpperCase(), section.id] as const))
const SECTION_TITLE_BY_ID = new Map(DESCRIPTION_SECTION_ORDER.map(section => [section.id, section.title] as const))

const PACKAGE_ROW = /\bpackage\b|\bin the box\b/i
const DIMENSION_ROW = /\b(length|width|height|depth|diameter|weight|dimension|size|capacity|gross|net)\b/i

function numericTokens(line: string): Set<string> {
  return new Set((line.match(/\d+(?:\.\d+)?/g) || []).map(token => String(Number(token))))
}

function containsAll(set: Set<string>, subset: Set<string>): boolean {
  for (const value of subset) if (!set.has(value)) return false
  return true
}

export function reorderDescriptionSections<T extends EbayDescriptionSectionLike>(sections: readonly T[]): T[] {
  const rows: T[] = sections.map(section => ({ ...section }))
  const specsIndex = rows.findIndex(section => section.id === 'SPECIFICATIONS')
  let packageIndex = rows.findIndex(section => section.id === 'PACKAGE')

  if (specsIndex >= 0) {
    const specLines = rows[specsIndex].content.split('\n').filter(line => line.trim())
    const moved = specLines.filter(line => PACKAGE_ROW.test(line))
    const existingPackageLines = packageIndex >= 0 ? rows[packageIndex].content.split('\n').filter(line => line.trim()) : []
    if (packageIndex >= 0 || moved.length) {
      const seen = new Set<string>()
      const packageLines = [...existingPackageLines, ...moved].filter(line => {
        const key = line.trim().toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      const keptSpecLines = specLines
        .filter(line => !PACKAGE_ROW.test(line))
        .filter(line => {
          if (!DIMENSION_ROW.test(line)) return true
          const numbers = numericTokens(line)
          if (!numbers.size) return true
          return !packageLines.some(packageLine => containsAll(numericTokens(packageLine), numbers))
        })
      rows[specsIndex] = { ...rows[specsIndex], content: keptSpecLines.join('\n') }
      if (packageIndex < 0) {
        rows.push({ id: 'PACKAGE', title: SECTION_TITLE_BY_ID.get('PACKAGE') || 'Package Contents', content: '' } as T)
        packageIndex = rows.length - 1
      }
      rows[packageIndex] = { ...rows[packageIndex], content: packageLines.join('\n') }
    }
  }

  const orderOf = (section: T) => SECTION_ORDER.get(section.id) ?? DESCRIPTION_SECTION_ORDER.length
  return rows
    .map((section, index) => ({ section, index }))
    .sort((a, b) => (orderOf(a.section) - orderOf(b.section)) || (a.index - b.index))
    .map(item => item.section)
}

/** 把整段详情文本按固定顺序重排；识别方式为「整行等于已知大写区块标题」，其余行归入当前区块内容。
 * 区块内容内部允许空行（如痛点区块的多条收益）；首个标题行之前出现正文视为自由文本，原样返回以免破坏用户手改。 */
export function reorderDescriptionText(description: string): string {
  const blocks: EbayDescriptionSectionLike[] = []
  for (const line of description.split('\n')) {
    const id = SECTION_ID_BY_TITLE.get(line.trim())
    if (id) {
      blocks.push({ id, title: SECTION_TITLE_BY_ID.get(id) || line.trim(), content: '' })
    } else if (!blocks.length) {
      return description
    } else {
      const last = blocks[blocks.length - 1]
      last.content = last.content ? `${last.content}\n${line}` : line
    }
  }
  if (!blocks.length) return description
  return reorderDescriptionSections(blocks.map(block => ({ ...block, content: block.content.trim() })))
    .map(section => (section.content ? `${section.title.toUpperCase()}\n${section.content}` : section.title.toUpperCase()))
    .join('\n\n')
}
