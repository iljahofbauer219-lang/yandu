// 选品报告 DOM 增强：字面 <br> 转真实换行 + 空列自动移除 + 竞品链接真实化（交叉引用 dp 升级 + 内置浏览器实时解析）+ 证据等级中文化 + 术语悬停注解
// 纯逻辑见 src/shared/reportEnhance.ts；本模块只做 DOM 操作，失败时静默降级

import {
  GLOSSARY,
  amazonAsinUrl,
  amazonBrandUrl,
  columnRole,
  convertEvidenceToChinese,
  extractAsin,
  findGlossaryToken,
  isLinkableText
} from '../shared/reportEnhance'

const GLOSSARY_LOOKUP = new Map(GLOSSARY.map(([token, title]) => [token, title]))

const LITERAL_BREAK = /<br\s*\/?>/i

type Hit = { index: number; length: number; title: string }

/** 在单个文本节点内迭代命中并包裹 abbr 注解 */
function splitDecorate(node: Text, find: (text: string) => Hit | null): void {
  let current: Text = node
  let guard = 0
  while (current.nodeValue && guard++ < 60) {
    const hit = find(current.nodeValue)
    if (!hit) return
    const rest = current.splitText(hit.index)
    const tail = rest.splitText(hit.length)
    const el = document.createElement('abbr')
    el.className = 'report-abbr'
    el.title = hit.title
    el.textContent = rest.nodeValue || ''
    rest.parentNode?.replaceChild(el, rest)
    current = tail
  }
}

function collectTextNodes(scope: Element): Text[] {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent) continue
    // 不破坏链接/代码/已注解内容
    if (parent.closest('a, code, pre, abbr, button')) continue
    if (node.nodeValue && node.nodeValue.trim()) nodes.push(node)
  }
  return nodes
}

/** 模型按 GFM 惯例在表格单元格内用 <br> 换行，渲染器不解析原始 HTML 会原样显示，这里统一转为真实换行 */
function normalizeLiteralBreaks(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent || parent.closest('a, code, pre, abbr, button')) continue
    if (node.nodeValue && LITERAL_BREAK.test(node.nodeValue)) targets.push(node)
  }
  for (const node of targets) {
    const parts = (node.nodeValue || '').split(LITERAL_BREAK)
    if (parts.length < 2) continue
    const fragment = document.createDocumentFragment()
    parts.forEach((part, index) => {
      if (index > 0) fragment.appendChild(document.createElement('br'))
      if (part) fragment.appendChild(document.createTextNode(part))
    })
    node.parentNode?.replaceChild(fragment, node)
  }
}

/** 模型输出偶发多余空列：表头与全部数据行均为空时整列移除，复制/CSV 导出同步受益 */
function dropEmptyColumns(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const rows = Array.from(table.rows)
    if (!rows.length) continue
    const columnCount = Math.max(...rows.map(row => row.cells.length))
    if (columnCount < 2) continue
    const emptyIndexes: number[] = []
    for (let i = 0; i < columnCount; i++) {
      if (rows.every(row => !row.cells[i] || !(row.cells[i].textContent || '').trim())) emptyIndexes.push(i)
    }
    if (!emptyIndexes.length || emptyIndexes.length === columnCount) continue
    // 从高列号往低列号删，保证未删列的物理下标不变
    for (const index of emptyIndexes.sort((a, b) => b - a)) {
      for (const row of rows) {
        if (row.cells.length === columnCount) row.cells[index]?.remove()
      }
    }
  }
}

/** 证据等级列：旧报告的 F/E/A/U 字母直接替换为中文（事实/外部估算/分析假设/未知） */
function localizeEvidence(cell: HTMLTableCellElement): void {
  const text = (cell.textContent || '').trim()
  if (!text) return
  const converted = convertEvidenceToChinese(text)
  if (converted !== text) cell.textContent = converted
}

/** 同表内「品牌列 + 代表商品/ASIN 列」交叉引用，构建 品牌→ASIN 映射，供链接升级为真实商品页 */
function buildBrandAsinMap(root: HTMLElement): Map<string, string> {
  const map = new Map<string, string>()
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const headerRow = table.querySelector('thead tr') as HTMLTableRowElement | null
    if (!headerRow) continue
    const headers = Array.from(headerRow.cells).map(cell => (cell.textContent || '').trim())
    const brandIndex = headers.findIndex(header => columnRole(header) === 'brand')
    const asinIndex = headers.findIndex(header => /ASIN|Listing|代表商品/i.test(header))
    if (brandIndex < 0 || asinIndex < 0 || brandIndex === asinIndex) continue
    for (const row of Array.from(table.querySelectorAll('tbody tr')) as HTMLTableRowElement[]) {
      const brand = (row.cells[brandIndex]?.textContent || '').trim()
      const asin = extractAsin(row.cells[asinIndex]?.textContent || '')
      if (brand && asin) map.set(brand.toLowerCase(), asin)
    }
  }
  return map
}

const DP_LINK_RE = /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}/i

/** 竞品链接真实化：品牌列与「🔗 商品/品牌链接」行——已有有效 dp 链接保留；有 ASIN 交叉引用升级为 dp 商品页；否则兑底品牌搜索页并标记 Tier2 异步升级 */
function realizeBrandLinks(root: HTMLElement): void {
  const map = buildBrandAsinMap(root)
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const headerRow = table.querySelector('thead tr') as HTMLTableRowElement | null
    const roles = headerRow ? Array.from(headerRow.cells).map(cell => columnRole(cell.textContent || '')) : []
    for (const row of Array.from(table.rows)) {
      if (row.parentElement?.tagName === 'THEAD') continue
      const isLinkRow = /商品\/品牌链接/.test(row.cells[0]?.textContent || '')
      Array.from(row.cells).forEach((cell, i) => {
        const targeted = isLinkRow ? i > 0 : roles[i] === 'brand'
        if (!targeted) return
        const brand = (cell.textContent || '').trim()
        if (!isLinkableText(brand)) return
        // 商品/品牌链接行通常直接填写 ASIN。此前这里把 ASIN 当成品牌名，
        // 生成了 /s?k=B... 搜索链接，Amazon 会进入错误页面。
        const directAsin = isLinkRow ? extractAsin(brand) || '' : ''
        const asin = directAsin || map.get(brand.toLowerCase()) || ''
        const target = asin ? amazonAsinUrl(asin) : amazonBrandUrl(brand)
        const anchor = cell.querySelector('a')
        if (anchor) {
          const href = anchor.getAttribute('href') || ''
          if (DP_LINK_RE.test(href) && extractAsin(href)) return
          anchor.href = target
          if (asin) delete anchor.dataset.amazonResolve
          else anchor.dataset.amazonResolve = brand
        } else {
          const link = document.createElement('a')
          link.href = target
          link.textContent = brand
          link.target = '_blank'
          link.rel = 'noreferrer'
          if (!asin) link.dataset.amazonResolve = brand
          cell.textContent = ''
          cell.appendChild(link)
        }
      })
    }
  }
}

const RESOLVE_CACHE_PREFIX = 'report-amazon-brand-asin:'
const RESOLVE_CACHE_TTL = 7 * 24 * 3600 * 1000
const RESOLVE_MAX_PER_RENDER = 6

/** Tier2：报告内无 ASIN 交叉引用的品牌，请主进程内置浏览器解析 Amazon 搜索首结果，异步升级为 dp 链接并本地缓存 7 天 */
async function resolveBrandLinksAsync(root: HTMLElement): Promise<void> {
  const api = window.desktop?.aiEmployee?.amazonResolve
  if (!api) return
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[data-amazon-resolve]')).slice(0, RESOLVE_MAX_PER_RENDER)
  for (const anchor of anchors) {
    const brand = anchor.dataset.amazonResolve || ''
    delete anchor.dataset.amazonResolve
    if (!brand) continue
    const key = RESOLVE_CACHE_PREFIX + brand.toLowerCase()
    let asin = ''
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null') as { asin?: string; at?: number } | null
      if (cached?.asin && cached.at && Date.now() - cached.at < RESOLVE_CACHE_TTL) asin = cached.asin
    } catch {
      // 缓存读取失败则走实时解析
    }
    if (!asin) {
      try {
        asin = (await api(brand))?.asin || ''
      } catch {
        asin = ''
      }
      if (asin) {
        try {
          localStorage.setItem(key, JSON.stringify({ asin, at: Date.now() }))
        } catch {
          // 忽略写入失败
        }
      }
    }
    if (asin && anchor.isConnected) anchor.href = amazonAsinUrl(asin)
  }
}

function enhanceTables(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const headerRow = table.querySelector('thead tr') as HTMLTableRowElement | null
    if (!headerRow) continue
    const roles = Array.from(headerRow.cells).map(cell => columnRole(cell.textContent || ''))
    if (!roles.some(role => role)) continue
    for (const row of Array.from(table.querySelectorAll('tbody tr')) as HTMLTableRowElement[]) {
      Array.from(row.cells).forEach((cell, i) => {
        if (roles[i] === 'evidence') localizeEvidence(cell)
      })
    }
  }
}

/** 全文术语悬停注解（跳过链接/代码/已注解节点） */
function annotateGlossary(root: HTMLElement): void {
  for (const node of collectTextNodes(root)) {
    splitDecorate(node, text => {
      const hit = findGlossaryToken(text)
      return hit ? { index: hit.index, length: hit.token.length, title: `${hit.token}：${glossaryTitle(hit.token)}` } : null
    })
  }
}

function glossaryTitle(token: string): string {
  return GLOSSARY_LOOKUP.get(token) || ''
}

export function enhanceReportDom(root: HTMLElement | null): void {
  if (!root) return
  try {
    normalizeLiteralBreaks(root)
    dropEmptyColumns(root)
    realizeBrandLinks(root)
    enhanceTables(root)
    annotateGlossary(root)
  } catch {
    // 增强失败不影响报告主体渲染
  }
  void resolveBrandLinksAsync(root).catch(() => undefined)
}
