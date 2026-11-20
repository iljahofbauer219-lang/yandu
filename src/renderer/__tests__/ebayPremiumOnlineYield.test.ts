import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-19 双截图）：流程环节互斥延伸到线上环节——产品成功发布进入线上产品后，
 * 其优品草稿让位优品仓库（记录保留为历史）。
 * 本提交含独立核心：markEbayDraftPublished helper＋发布主通道写回＋premiumStageDrafts 排除 listing 态。
 * migrate/reconcile 其余写回点与存量 heal、reconcile 入口扩 premium 依赖并行会话在途接线，
 * 留工作树待其提交吸收（实机已全链验证：优品 0/线上 1/草稿 listing 态与在架编号一致）。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')

describe('已上架优品让位 · 主进程写回核心', () => {
  it('markEbayDraftPublished：编号门禁＋同源草稿＋幂等', () => {
    const seg = main.split('function markEbayDraftPublished(')[1]?.split('\nfunction seedEbayLocalProductFromPremiumDraft')[0] ?? ''
    expect(seg).toContain("if(!database||!/^\\d{6,}$/.test(itemId))return")
    expect(seg).toContain('database.getEbayOptimizationDrafts(storeId).find(item=>item.listingId===listingId)')
    expect(seg).toContain("if(!draft||draft.publishRef?.kind==='listing')return")
    expect(seg).toContain("publishRef:{kind:'listing',id:itemId,at:new Date().toISOString()}")
  })
  it('发布主通道成功即写回同源草稿 listing 态', () => {
    expect(main).toContain('if(pubRow)markEbayDraftPublished(pubRow.storeId,pubRow.listingId,result.itemId)')
  })
})

describe('已上架优品让位 · 渲染过滤', () => {
  it('premiumStageDrafts 排除 listing 态草稿（优品视图与左树计数同源让位）', () => {
    expect(app).toContain("const premiumStageDrafts=optimizationDrafts.filter(draft=>!draft.returnedAt&&draft.publishRef?.kind!=='listing'&&!localProducts.some(")
  })
})