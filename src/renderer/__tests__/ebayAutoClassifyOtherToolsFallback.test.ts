/**
 * 自动分类无合适类目统一回落 Other tools 守卫：
 * 规则/LLM 双 miss 不再落未分类＋弹红错误；按名查当前店铺类目树 Other tools 并走 setLocalCategory 写入；
 * 单卡按钮与批量 backfill 两路径同口径；店铺树缺 Other tools 时点名保留未分类（不擅自建类目）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const app = readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8')
const cardSeg = app.split('const autoClassifyLocalCard=')[1]?.split('\n  useEffect')[0] ?? ''
const backfillSeg = app.split('const classifyTargets=localProducts.filter')[1]?.split('},[activeTab,activeStore?.id,localProducts])')[0] ?? ''

describe('回落查找与写入', () => {
  it('按名查店铺类目树 Other tools（不硬编码 ID）', () => {
    expect(app).toContain("const otherToolsFallbackCategory=()=>categoryWorkspace.categories.find(item=>item.name.trim().toLowerCase()==='other tools')||null")
  })

  it('单卡 miss 走 setLocalCategory 回落并通知含理由', () => {
    expect(cardSeg).toContain('const fallback=otherToolsFallbackCategory()')
    expect(cardSeg).toContain('window.desktop.ebay.setLocalCategory(productId,fallback.categoryId,fallback.name)')
    expect(cardSeg).toContain('未匹配到合适类目，已统一归入')
  })

  it('单卡店铺树缺 Other tools 点名保留未分类', () => {
    expect(cardSeg).toContain('当前店铺类目树缺少 Other tools')
  })

  it('批量 backfill miss 同口径回落并计 fallbackHit', () => {
    expect(backfillSeg).toContain('let fallbackHit=0')
    expect(backfillSeg).toContain('window.desktop.ebay.setLocalCategory(target.id,fallback.categoryId,fallback.name)')
    expect(backfillSeg).toContain('含 ${fallbackHit} 个无合适类目统一归入 Other tools')
  })

  it('命中分支与手动分类语义不动', () => {
    expect(cardSeg).toContain('setLocalAutoSuggestions(current=>({...current,[productId]:{categoryId:suggestedId,categoryName:result.categoryName}}))')
    expect(app).toContain('const adoptLocalSuggestion=(product:EbayLocalProduct)=>')
  })
})