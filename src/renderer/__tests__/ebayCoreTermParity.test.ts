import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 核心词三处同源：发布行 chip/本地卡中文产品读 coreTermZh，AI优化核心词初值优先 coreTermEn。
 * 根因＝优品 seed 重建本地行不携带/不补取 coreTerm→chip 读—。修复＝seed 携带草稿 coreTerm 否则补取；
 * 存量空值在 publish/local 可见时按行有界补取（每行一次，失败保留原值＋中文提示）。
 */
const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
const app = read('renderer', 'App.tsx')
const main = read('main', 'main.ts')

describe('seed 重建行携带/补取核心词', () => {
  const start = main.indexOf("ipcMain.handle('ebay:local-products:seed-from-premium'")
  const body = main.slice(start, start + 1200)
  it('handler 改 async；空 coreTerm 时 fetchLocalCoreTerms 补取落库（草稿契约无 coreTerm 字段，不扩契约）', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("async (_event, storeId:string, draft:EbayOptimizationDraft, draftId:string)")
    expect(body).toContain('fetchLocalCoreTerms(seeded.title)')
    expect(body).toContain('database!.setEbayLocalProductCoreTerms(seeded.id')
  })
})

describe('存量空值有界补取', () => {
  it('publish/local 可见时对空 coreTerm 行按行补取，每行一次，失败保留原值＋中文提示', () => {
    expect(app).toContain('const coreTermHealAttempted=useRef<Set<string>>(new Set())')
    const start = app.indexOf('const coreTermHealAttempted=')
    const body = app.slice(start, start + 1800)
    expect(body).toContain("(activeTab!=='publish'&&activeTab!=='local')")
    expect(body).toContain('!p.coreTermZh&&!p.coreTermEn&&!coreTermHealAttempted.current.has(p.id)')
    expect(body).toContain('window.desktop.ebay.localCoreTerms(p.id)')
    expect(body).toContain('核心商品词补取失败')
    expect(body).toContain('保留原值')
  })
  it('AI优化核心词初值优先 coreTermEn（用户偏好仍最优先）', () => {
    expect(app).toContain('setResearchQuery(preference?.query||product.coreTermEn||suggestion.query)')
  })
  it('发布行 chip 与本地卡中文产品仍读 coreTermZh（口径不变）', () => {
    expect(app).toContain("{product.coreTermZh||'—'}")
    expect(app).toContain('<dt>中文产品</dt><dd title={product.coreTermZh||\'\'}>{product.coreTermZh||\'—\'}</dd>')
  })
})