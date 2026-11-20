import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 目录标题区对齐货盘仓库「产品目录库」基准（2026-11-19）：
 * 三处 eBay 侧栏（线上产品/本地产品/优品仓库）标题行复用 .catalog-heading.catalog-heading-row
 * （h2 左 + 折叠按钮右同行），不再让折叠按钮独占首行；优品目录黄框小字删除；
 * 线上产品同步时间副标题保留为独立 .ebay-catalog-subtitle 行。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const readability = readFileSync(path.resolve(process.cwd(), 'src/renderer/ui-readability.css'), 'utf8')
const styles = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')

const headingRow = (label: string) =>
  `<div className="catalog-heading catalog-heading-row"><h2>${label}</h2><PanelCollapseButton panel={ebayCatalogPanel}/></div>`

describe('eBay 三目录标题区对齐产品目录库基准', () => {
  it('三处标题行复用基准结构：h2 与折叠按钮同行', () => {
    for (const label of ['产品目录', '本地产品目录', '优品目录']) {
      expect(app, `${label} 标题行`).toContain(headingRow(label))
    }
    expect(app.match(/<PanelCollapseButton panel=\{ebayCatalogPanel\}\/>/g)?.length).toBe(3)
  })
  it('折叠按钮不再独占 header 之前的独立行', () => {
    expect(app).not.toMatch(/<PanelCollapseButton panel=\{ebayCatalogPanel\}\/>\s*<header>/)
    expect(app).not.toContain('<header><b>优品目录</b>')
    expect(app).not.toContain('<header><b>本地产品目录</b>')
    expect(app).not.toContain('<header><b>产品目录</b>')
  })
  it('优品目录黄框小字整行删除', () => {
    expect(app).not.toContain('复用当前 eBay 店铺目录')
    expect(app).not.toContain('仅统计已保存的优化版本')
  })
  it('线上产品同步时间副标题保留为独立行', () => {
    expect(app).toContain('className="ebay-catalog-subtitle"')
    expect(app).toContain('eBay店铺目录 · ${categorySyncedAt}')
    expect(app).toContain('尚未同步店铺目录')
  })
  it('CSS：副标题有独立规格，旧 header 规格清除，基准行机制仍在', () => {
    expect(readability).toContain('.ebay-product-catalog>.ebay-catalog-subtitle')
    expect(readability).not.toContain('.ebay-product-catalog>header')
    expect(styles).toContain('.catalog-heading-row .panel-collapse-toggle')
    expect(styles).toContain('.catalog-heading-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }')
  })
})