import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 时间设置弹窗两区域美化（2026-11-17）：批次表与自行设置各自独立面板；
 * 自行设置区新增列标题行（选取/设置方式/发布分钟/北京时间/当地时间）罩其下内容，
 * 与批次表头同款网格对齐；两面板底色/边框区分。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')

describe('时间设置 · 双面板与 custom 列标题', () => {
  it('JSX 有批次面板/custom 面板/custom 列标题行', () => {
    expect(app).toContain('ebay-schedule-batch-panel')
    expect(app).toContain('ebay-schedule-custom-panel')
    expect(app).toContain('ebay-schedule-custom-head')
    expect(app).toContain('>发布分钟</span>')
    expect(app).toContain('>北京时间</span>')
    expect(app).toContain('>当地时间</span>')
  })
  it('custom 列标题与行同网格对齐', () => {
    expect(css).toMatch(/ebay-schedule-custom-head[^{]*\{[^}]*grid-template-columns:34px 52px/)
  })
  it('两面板底色/边框区分', () => {
    expect(css).toContain('.ebay-schedule-batch-panel{')
    expect(css).toContain('.ebay-schedule-custom-panel{')
    const batch = css.split('.ebay-schedule-batch-panel{')[1]?.split('}')[0] ?? ''
    const custom = css.split('.ebay-schedule-custom-panel{')[1]?.split('}')[0] ?? ''
    expect(batch).toContain('background:')
    expect(custom).toContain('background:')
    expect(batch).not.toBe(custom)
  })
})