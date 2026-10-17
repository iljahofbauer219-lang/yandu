// 入库「自动分类」：千问回复的目录路径解析与逐级校验（节点名必须来自当前产品目录库）
export interface CatalogBranch {
  category: string
  subcategories: { name: string; tertiaries: string[] }[]
}

export interface InboundCategorySuggestion {
  category: string
  subcategory: string
  tertiaryCategory: string
}

const cleanFences = (value: string) => value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
const norm = (value: string) => String(value || '').replace(/[\s　]/g, '').replace(/[，、,;；:：/｜|>》()（）]/g, '').toLowerCase()
const unquote = (value: string) => String(value || '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()

function dedupe(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const text = String(name || '').trim()
    if (!text) continue
    const key = norm(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

/** 渲染器目录树（一级 + 二级 + 三级）压平为主进程候选清单，只保留有子节点的分支 */
export function buildCategoryPromptTree(input: {
  categories: readonly { name: string; children: readonly string[] }[]
  tertiary: Readonly<Record<string, readonly { name: string }[]>>
}): CatalogBranch[] {
  const branches: CatalogBranch[] = []
  for (const group of input.categories) {
    const category = String(group.name || '').trim()
    if (!category) continue
    const subcategories = dedupe(group.children).map(name => ({
      name,
      tertiaries: dedupe((input.tertiary[name] || []).map(option => option.name)),
    }))
    if (subcategories.length) branches.push({ category, subcategories })
  }
  return branches
}

function findNode(names: readonly string[], value: string): string {
  const key = norm(value)
  if (!key) return ''
  const exact = names.find(name => norm(name) === key)
  if (exact) return exact
  if (key.length < 2) return ''
  return names.find(name => {
    const node = norm(name)
    return node.length >= 2 && (node.includes(key) || key.includes(node))
  }) || ''
}

function splitPath(value: string): string[] {
  const slash = value.split(/[/｜|>》]+/).map(unquote).filter(Boolean)
  if (slash.length >= 2) return slash
  if (!slash.length) return []
  const colon = slash[0].split(/[：:]/).map(item => item.trim()).filter(Boolean)
  return colon.length >= 2 ? colon : [slash[0]]
}

/** 回复正文 → 原始路径片段（JSON 字段 / path 数组 / 「一级：… 二级：…」行） */
function rawPathSegments(clean: string): string[] {
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>
      const fields = ['category', 'subcategory', 'tertiaryCategory', 'tertiary'].map(key => parsed[key]).filter((value): value is string => typeof value === 'string' && Boolean(unquote(value)))
      if (fields.length) return fields.map(item => unquote(item))
      if (Array.isArray(parsed.path)) {
        const list = parsed.path.map(item => unquote(String(item))).filter(Boolean)
        if (list.length) return list
      }
    } catch {
      // 继续走文本回落
    }
  }
  const segments: string[] = []
  for (const line of clean.split(/\r?\n/)) {
    const text = line.replace(/^[\s\-*·、(.0-9）)]+/, '').trim()
    if (!text || /[{}"']/.test(text)) continue
    const labeled = /^(?:一级|二级|三级)(?:类目)?\s*[:：]\s*(.+)$/.exec(text)
    segments.push(...splitPath(labeled ? labeled[1] : text))
  }
  return segments.filter(Boolean)
}

/** 千问回复 → 逐级校验的类目路径；任一级不在目录库即 null（三级允许为空） */
export function parseInboundCategorySuggestionReply(content: string, branches: readonly CatalogBranch[]): InboundCategorySuggestion | null {
  if (!branches.length) return null
  const raw = String(content || '').trim()
  if (!raw) return null
  const segments = rawPathSegments(cleanFences(raw)).map(item => item.trim()).filter(Boolean)
  if (!segments.length) return null

  const branchIndex = segments.findIndex(segment => findNode(branches.map(branch => branch.category), segment))
  if (branchIndex < 0) return null
  const category = branches.find(branch => branch.category === findNode(branches.map(branch => branch.category), segments[branchIndex]))
  if (!category) return null
  const rest = segments.slice(branchIndex + 1)
  if (!rest.length) return null

  const subcategory = category.subcategories.find(sub => findNode([sub.name], rest[0]))
  if (!subcategory) return null
  const tertiary = rest[1] ? findNode(subcategory.tertiaries, rest[1]) : ''
  return { category: category.category, subcategory: subcategory.name, tertiaryCategory: tertiary }
}
