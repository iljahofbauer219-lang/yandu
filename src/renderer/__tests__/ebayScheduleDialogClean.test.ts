import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 时间设置弹窗精简（2026-11-17）：删眉标 SCHEDULED PUBLISH／标题后缀（全部产品统一）／顶部说明段；
 * 自行设置表头末列改名「当地东部时间」；发布分钟输入框缩窄＋去 spinner；列对齐保持。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')

describe('时间设置弹窗 · 精简与缩宽', () => {
  it('眉标/标题后缀/顶部说明段已删除', () => {
    expect(app).not.toContain('SCHEDULED PUBLISH')
    expect(app).not.toContain('（全部产品统一）')
    expect(app).not.toContain('到点自动 prepare')
  })
  it('custom 表头末列＝当地东部时间', () => {
    expect(app).toContain('>当地东部时间</span>')
  })
  it('分钟输入缩窄＋去 spinner', () => {
    expect(css).toMatch(/\.ebay-schedule-custom-row input\[type=number\]\{[^}]*max-width:/)
    expect(css).toContain('.ebay-schedule-custom-row input[type=number]::-webkit-inner-spin-button')
    expect(css).toContain('.ebay-schedule-custom-row input[type=number]::-webkit-outer-spin-button')
  })
  it('确认/取消与校验错误提示保留', () => {
    expect(app).toContain('>确认</button>')
    expect(app).toContain('>取消</button>')
    expect(app).toContain('ebay-schedule-plan-error')
  })
})