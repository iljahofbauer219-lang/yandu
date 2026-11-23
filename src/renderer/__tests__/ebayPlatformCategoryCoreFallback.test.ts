import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-22 双截图）：发布编辑器平台类目报「缺少核心商品词」，但 AI优化核心商品词
 * 输入已有值（Racing Seat）——seed 重建本地行不携带核心词致门禁误报。
 * 修复：hook 增 fallbackCoreTerm，与 AI优化输入同序（偏好‖标题建议，App.tsx seeding 链同口径）；
 * 无既有本地行核心词回写 IPC（仅货盘 saveCoreTerms），故回落为渲染期同源实时计算、不落库（已披露）。
 */
const hook = readFileSync(path.resolve(process.cwd(), 'src/renderer/useEbayPlatformCategory.ts'), 'utf8')
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('平台类目核心词同源回落', () => {
  it('hook 核心词取本地行‖回落，门禁不再对 seed 行误报', () => {
    expect(hook).toContain('fallbackCoreTerm?: string')
    expect(hook).toContain("const coreTerm = product ? (product.coreTermEn || product.coreTermZh || fallbackCoreTerm || '').trim() : ''")
    expect(hook).toContain("if (!coreTerm) { setError('缺少核心商品词，无法获取平台类目'); return }")
  })
  it('App 回落与 AI优化显示同源：持久化研究 snapshot.query 优先‖偏好‖标题建议', () => {
    expect(app).toContain("const platformCategoryFallback=(product:EbayLocalProduct|null)=>{if(!product)return '';const item=product.snapshot.sourceListing;const preference=activeStore?readEbayResearchQueryPreference(activeStore.id,item.listingId):undefined;return (preference?.query||ebayResearchQuerySuggestion(item).query||'').trim()}")
    expect(app).toContain("const platformFallbackFor=(product:EbayLocalProduct|null)=>product?(platformFallbackByProduct[product.id]||platformCategoryFallback(product)):''")
    expect(app).toContain("void window.desktop.ebay.marketResearch(activeStore.id,product.snapshot.sourceListing.listingId).then(snapshot=>{if(alive&&snapshot?.query)setPlatformFallbackByProduct(cur=>({...cur,[product.id]:snapshot.query}))})")
    expect(app).toContain("setResearchQuery(preference?.query||product.coreTermEn||suggestion.query)")
    expect(app).toContain("setMarketResearch(snapshot);setMarketResearchHistory(current=>[snapshot,...current.filter(item=>item.id!==snapshot.id)].slice(0,30));setResearchQuery(snapshot.query)")
  })
  it('两个编辑器 hook 调用点均接回落', () => {
    expect(app).toContain('fallbackCoreTerm:platformFallbackFor(localEditorProduct??null)')
    expect(app).toContain('fallbackCoreTerm:platformFallbackFor(publishEditorProduct)')
  })
})