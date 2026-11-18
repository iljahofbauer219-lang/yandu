import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../image-studio.css', import.meta.url), 'utf8')
const readability = readFileSync(new URL('../ui-readability.css', import.meta.url), 'utf8')

function blocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*[,{]([^}]*)\\}`, 'g')
  return [...css.matchAll(re)].map(m => m[1])
}

function pxProp(selector: string, name: string): number {
  for (const b of blocks(selector)) {
    const m = b.match(new RegExp(`${name}:\\s*([\\d.]+)px`))
    if (m) return parseFloat(m[1])
  }
  throw new Error(`no ${name} for ${selector}`)
}

const fontSize = (selector: string) => pxProp(selector, 'font-size')
const lineHeight = (selector: string) => pxProp(selector, 'line-height')

/** CSS  specificity：:where() 记 0，:not() 记其参数，其余伪类记一个 class。 */
function specificity(selector: string): [number, number, number] {
  let s = selector.trim()
  let extra: [number, number, number] = [0, 0, 0]
  const add = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  const takeBalanced = (open: number): string => {
    let depth = 0
    for (let i = open; i < s.length; i++) {
      if (s[i] === '(') depth++
      else if (s[i] === ')') { depth--; if (depth === 0) return s.slice(open + 1, i) }
    }
    return s.slice(open + 1)
  }
  for (const fn of [':where', ':not', ':is']) {
    let idx = s.indexOf(`${fn}(`)
    while (idx >= 0) {
      const inner = takeBalanced(idx + fn.length)
      const weight = fn === ':where' ? [0, 0, 0] as [number, number, number] : specificity(inner.split(',')[0])
      extra = add(extra, weight)
      s = s.slice(0, idx) + s.slice(idx + fn.length + inner.length + 2)
      idx = s.indexOf(`${fn}(`)
    }
  }
  const ids = (s.match(/#[\w-]+/g) || []).length
  const classes = (s.match(/\.[\w-]+/g) || []).length
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length
  const pseudoClasses = (s.match(/:(?!:)[\w-]+/g) || []).length
  const stripped = s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, ' ')
  const elements = (stripped.match(/[a-zA-Z][\w-]*/g) || []).length
  return add([ids, classes + attrs + pseudoClasses, elements], extra)
}

function beats(mine: string, theirs: string): boolean {
  const a = specificity(mine), b = specificity(theirs)
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]
}

const SUMMARY_B = '.ebay-profit-workbench .ebay-profit-summary b'
const FIELD_INPUT = '.ebay-profit-workbench .ebay-profit-fields label input'
const FIELD_SELECT = '.ebay-profit-workbench .ebay-profit-fields label select'
const READABILITY_B = '.ebay-platform-page :where(article,section,aside,details,header,footer)>b'
const READABILITY_INPUT = 'input:not([type="checkbox"]):not([type="radio"])'
const READABILITY_INPUT_SCOPED = '.ebay-platform-page :where(input:not([type="checkbox"]):not([type="radio"]),select,textarea)'

describe('售价设定可读字号尺度（红框微字美化）', () => {
  it('四卡标题/副标题与核算公式行不低于 11px', () => {
    expect(fontSize('.ebay-profit-summary small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-summary span')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-formula span')).toBeGreaterThanOrEqual(11)
  })

  it('四卡数值为醒目主数字（≥20px）', () => {
    expect(fontSize(SUMMARY_B)).toBeGreaterThanOrEqual(20)
  })

  it('输入组标签/输入框/说明小字达到可读尺度', () => {
    expect(fontSize('.ebay-profit-fields label')).toBeGreaterThanOrEqual(11)
    expect(fontSize(FIELD_INPUT)).toBeGreaterThanOrEqual(12)
    expect(fontSize(FIELD_SELECT)).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-fields small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-input-groups>section>header b')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-input-groups>section>header small')).toBeGreaterThanOrEqual(11)
  })

  it('工作台头/核算带标题/自动填充/采用按钮微字全部≥11px', () => {
    expect(fontSize('.ebay-profit-workbench>header b')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-workbench>header small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-workbench>header>span')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-formula b')).toBeGreaterThanOrEqual(12)
    expect(fontSize('.ebay-profit-formula small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-autofill-row small')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-autofill-row button')).toBeGreaterThanOrEqual(11)
    expect(fontSize('.ebay-profit-target-price button')).toBeGreaterThanOrEqual(11)
  })

  it('微字颜色加深保证浅底对比度（不再用浅灰）', () => {
    const grab = (sel: string) => {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = css.match(new RegExp(`${escaped}\\s*\\{[^}]*?color:\\s*(#[0-9a-fA-F]{6})`))
      return m ? m[1].toLowerCase() : null
    }
    for (const sel of ['.ebay-profit-summary small', '.ebay-profit-summary span', '.ebay-profit-fields small', '.ebay-profit-formula small']) {
      const c = grab(sel)
      expect(c, sel).not.toBeNull()
      expect(['#7d8987', '#84908e', '#89918f', '#84918f', '#7a8986', '#71807e', '#70817e']).not.toContain(c)
    }
  })

  it('主数字与输入框字号压过后加载的 ui-readability 覆盖层（活体实测曾被盖成 14/13px）', () => {
    expect(readability).toContain(READABILITY_B)
    expect(readability).toContain(READABILITY_INPUT)
    expect(beats(SUMMARY_B, READABILITY_B)).toBe(true)
    expect(beats(FIELD_INPUT, READABILITY_INPUT)).toBe(true)
    expect(beats(FIELD_INPUT, READABILITY_INPUT_SCOPED)).toBe(true)
    expect(beats(FIELD_SELECT, READABILITY_INPUT)).toBe(true)
    // 覆盖层同时给 article>b 设了 line-height:20px，主数字必须自带足够行高否则被裁
    expect(lineHeight(SUMMARY_B)).toBeGreaterThanOrEqual(fontSize(SUMMARY_B))
  })

  it('输入框禁用/聚焦/只读态选择器权重不低于基础态（否则状态色被基础规则盖掉）', () => {
    expect(beats(`${FIELD_INPUT}:disabled`, FIELD_INPUT)).toBe(true)
    expect(beats(`${FIELD_INPUT}:focus`, FIELD_INPUT)).toBe(true)
    expect(beats('.ebay-profit-workbench .ebay-profit-fields .ebay-profit-target-price input', FIELD_INPUT)).toBe(true)
    expect(css).toContain('.ebay-profit-workbench .ebay-profit-fields .ebay-profit-target-price input')
  })
})