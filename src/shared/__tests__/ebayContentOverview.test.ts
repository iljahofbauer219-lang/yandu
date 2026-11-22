import { describe, expect, it } from 'vitest'
import { buildOverviewParagraph } from '../ebayDescriptionSections'
import { normalizeEnglishDescription } from '../ebaySpecificsEnglish'

const TITLE = '6" Running Boards Side Steps for 2009-2024 Dodge Ram 1500 2500 3500 Crew Cab'

describe('buildOverviewParagraph 概览段组合跳过中文事实', () => {
  it('中文 FEATURE 事实不入概览单行，英文事实保留，整行过 normalize 不被清空', () => {
    const overview = buildOverviewParagraph(TITLE, [
      { kind: 'FEATURE', text: '图文描述' },
      { kind: 'FEATURE', text: 'Heavy Duty Carbon Steel Construction' },
      { kind: 'SPECIFICATION', text: 'Brand: XINHUIYING' }
    ])
    expect(overview).toBe(`${TITLE}. Heavy Duty Carbon Steel Construction.`)
    expect(overview).not.toMatch(/[一-鿿]/)
    expect(normalizeEnglishDescription(overview)).toBe(overview)
  })

  it('FEATURE 全中文时概览仍保留标题句，不为空串', () => {
    const overview = buildOverviewParagraph(TITLE, [{ kind: 'FEATURE', text: '图文描述' }])
    expect(overview).toBe(`${TITLE}.`)
    expect(normalizeEnglishDescription(overview)).not.toBe('')
  })

  it('无 FEATURE 事实时概览为标题句；英文 FEATURE 至多取5条', () => {
    expect(buildOverviewParagraph(TITLE, [])).toBe(`${TITLE}.`)
    const facts = Array.from({ length: 7 }, (_, index) => ({ kind: 'FEATURE', text: `Feature ${index + 1}` }))
    const overview = buildOverviewParagraph(TITLE, facts)
    expect(overview).toContain('Feature 5')
    expect(overview).not.toContain('Feature 6')
  })
})