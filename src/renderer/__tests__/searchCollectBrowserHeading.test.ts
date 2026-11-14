import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')

const FILL_GROUP = '<div className="ebay-fill-actions"><button type="button" disabled={!ebayFillOnListing'

/**
 * 用户口径（2026-11-14 截图）：「搜索采集」与「AI跨境」两个内嵌浏览器是独立工作区，
 * 搜索采集 header 不得出现与 AI跨境 重复的刊登填写功能（自动填写/固定填写/预设/刊登资料）。
 * 两处共用 EbayPlatformWorkspace，故按 browserOnly 分流：采集组只在搜索采集显示，
 * 填写组与其预设弹窗只在 AI跨境 显示。预设弹窗虽只能由按钮打开，仍显式分流以免日后漏改。
 */
describe('搜索采集浏览器 header · 功能不重复守卫', () => {
  const fillStart = appSource.indexOf(FILL_GROUP)

  it('刊登填写组（自动填写/固定填写/预设/刊登资料）仍在代码中（AI跨境 入口不丢）', () => {
    expect(fillStart, '填写组必须仍存在，AI跨境 浏览器继续可用').toBeGreaterThan(-1)
    const group = appSource.slice(fillStart, appSource.indexOf('{!browserOnly&&ebayFixedPresetOpen', fillStart))
    for (const label of ['自动填写', '固定填写', '>预设</button>', '刊登资料']) {
      expect(group, `填写组缺少 ${label}`).toContain(label)
    }
  })

  it('刊登填写组必须处于 !browserOnly 分支（搜索采集不渲染重复功能）', () => {
    expect(appSource.slice(fillStart - '{!browserOnly&&'.length, fillStart)).toBe('{!browserOnly&&')
  })

  it('固定填写预设弹窗同样只在非搜索采集工作区渲染', () => {
    expect(appSource).toContain('{!browserOnly&&ebayFixedPresetOpen&&<div className="ebay-fixed-preset-backdrop"')
  })

  it('采集类填写组若存在则必须按 browserOnly 分流（不得无条件渲染）', () => {
    const headingStart = appSource.lastIndexOf('<div className="browser-heading-actions">', fillStart)
    expect(headingStart).toBeGreaterThan(-1)
    const heading = appSource.slice(headingStart, appSource.indexOf('<div className="browser-translation">', headingStart))
    const marker = '<div className="ebay-fill-actions">'
    for (let i = heading.indexOf(marker); i >= 0; i = heading.indexOf(marker, i + 1)) {
      const prefix = heading.slice(Math.max(0, i - 15), i)
      expect(prefix, `填写组必须显式分流，实际前缀 ${JSON.stringify(prefix)}`).toMatch(/(\{browserOnly&&|\{!browserOnly&&)$/)
    }
  })
})
