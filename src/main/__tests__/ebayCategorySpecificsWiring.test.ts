import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * H2/H4 接线守卫：类目级缓存与段头两键跨 main / preload / App / 编辑器四处，
 * 任何一处漏接都会退化成「同类目每个产品都开页重读」或「键画了没接线」，故用源码切片钉住接线本身。
 * 行为层另有 DAO 单测（AppDatabase.categorySpecifics）与 shared 填写计划单测（ebaySpecificsFillPlan）。
 */

const read = (...parts: string[]) => readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
const mainSource = read('main.ts')
const preloadSource = read('..', 'preload', 'preload.ts')
const appSource = read('..', 'renderer', 'App.tsx')

const slice = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  expect(from, `锚点必须存在：${start}`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

describe('H2 · 读取链路双写类目缓存', () => {
  it('requirements 处理器在写产品行之外，按 (店铺, 平台类目) 双写类目缓存，且只在真有槽位时写', () => {
    const handler = slice(mainSource, "ipcMain.handle('ebay:local-products:requirements'", "ipcMain.handle('ebay:business-policies:list'")
    expect(handler).toContain('saveEbayCategorySpecificsSection')
    expect(handler).toContain('if(categoryId&&requirements.attributeSection.slots.length)')
    expect(handler).toContain('categoryKey:categoryId')
  })

  it('类目缓存有独立读取通道，preload 原样暴露给渲染器', () => {
    expect(mainSource).toContain("ipcMain.handle('ebay:category-specifics:get'")
    expect(preloadSource).toContain("ipcRenderer.invoke('ebay:category-specifics:get',storeId,categoryKey)")
  })
})

describe('H4 · 进发布种子序与段头两键接线', () => {
  it('种子序：会话 → 产品行 → 类目缓存 → 才静默自读（同类目第二产品不再开页）', () => {
    const seed = slice(appSource, 'const seedSpecificsFromStore', 'const uploadPublishEditorMedia')
    expect(seed).toContain('categorySpecificsSection(')
    expect(seed.indexOf('localProductSpecificsSection(')).toBeLessThan(seed.indexOf('categorySpecificsSection('))
    const tail = slice(appSource, 'const seeded=await seedSpecificsFromStore', 'const uploadPublishEditorMedia')
    expect(tail).toContain('specificsAutoReadDone.current[lp.id]=true')
  })

  it('两个功能键真的接进编辑器：读取走非静默按类目、填写走 shared 计划写本地草稿', () => {
    expect(appSource).toContain('onReadSpecifics=')
    expect(appSource).toContain('onFillSpecifics=')
    expect(appSource).toContain('planEbaySpecificsFill')
    expect(appSource).toContain('applyLlmSpecificAnswers')
  })

  it('填写结果带来源与时间落进草稿 itemSpecifics，人工值不被覆盖由 shared 判据保证', () => {
    expect(appSource).toContain('source:fill.source')
    expect(appSource).toContain("needsConfirmation:fill.source==='AI'")
    expect(appSource).toContain('specificsFilledAtByProduct')
  })
})
