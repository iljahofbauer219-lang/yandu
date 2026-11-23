import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 发布行核心词行：中文粉 chip 旁新增英文蓝 chip（coreTermEn，空值—），异色框区分；
 * 字号/圆角/内边距对齐现有 chip，全译与按钮不动。
 */
const app = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')
const css = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')

describe('发布行英文核心词 chip', () => {
  it('coreline 中文 chip 后紧跟英文 chip，读 coreTermEn 空值—', () => {
    const start = app.indexOf('className="ebay-scheduled-coreline"')
    expect(start).toBeGreaterThan(-1)
    const body = app.slice(start, start + 400)
    const zhAt = body.indexOf('<span className="ebay-scheduled-coreterm">')
    const enAt = body.indexOf('<span className="ebay-scheduled-coreterm-en">')
    expect(zhAt).toBeGreaterThan(-1)
    expect(enAt).toBeGreaterThan(zhAt)
    expect(body).toContain("{product.coreTermEn||'—'}")
  })
  it('CSS 异色类：蓝系边框/底/字，规格对齐中文 chip', () => {
    const start = css.indexOf('.ebay-scheduled-coreterm-en{')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toContain('border:1.5px solid #0369a1')
    expect(block).toContain('background:#f0f9ff')
    expect(block).toContain('color:#075985')
    expect(block).toContain('padding:1px 7px')
    expect(block).toContain('border-radius:7px')
  })
})