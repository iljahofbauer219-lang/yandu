import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 缺陷：草稿页（经手动发布/草稿查看打开）点「自动填写/固定填写」无反应——
 * ebayFillTargetId 仅认 publishEditorProduct/localEditorProduct/ebayFillLastProduct，
 * 而手动/草稿查看不置这些状态 → target 空 → runCurrentTabFill 仅 setEbayError 返回。
 * 修复：填写目标增加「当前刊登页 URL 反解 ref → 匹配本地产品 publishRef」一路；
 * 手动发布/草稿查看同时置 ebayFillLastProduct 兜底。
 */
const source = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('填写目标 · 草稿页 URL 反解兜底', () => {
  it('ebayFillTargetId 含 URL 反解一路 urlFillTarget', () => {
    expect(source).toContain('const urlFillTarget=')
    expect(source).toContain('publishEditorProduct?.id||localEditorProduct?.id||urlFillTarget||ebayFillLastProduct')
  })
  it('urlFillTarget 由当前页 URL ref 匹配本地产品 publishRef', () => {
    expect(source).toContain('ebayPublishRefFromUrl(ebayBrowserState?.url||\'\')')
    expect(source).toContain('p.publishRef?.id===currentListingRef.id')
  })
  it('手动发布/草稿查看置 ebayFillLastProduct 兜底', () => {
    expect(source).toContain('const manualPublishLocal=async(product:EbayLocalProduct,alsoSaveDraft=false)=>{setEbayFillLastProduct(product.id)')
    expect(source).toContain('const viewPublishDraft=(product:EbayLocalProduct)=>{setEbayFillLastProduct(product.id)')
  })
})

describe('手动/草稿发布 · 预填→自动填写→固定填写串联', () => {
  it('runCurrentTabFill 接受显式目标 id（串联不依赖异步 state），并返回结果供汇总', () => {
    expect(source).toContain("const runCurrentTabFill=async(mode:'auto'|'fixed',targetId?:string)=>{")
    expect(source).toContain('const fillId=targetId||ebayFillTargetId')
    expect(source).toContain('return result')
  })
  it('manualPublishLocal 在 prepare 后依次自动执行自动填写→固定填写（显式 product.id）', () => {
    const seg = source.split('const manualPublishLocal=')[1]?.split('const sendBackToPremium=')[0] ?? ''
    expect(seg).toContain("await runCurrentTabFill('auto',product.id)")
    expect(seg).toContain("await runCurrentTabFill('fixed',product.id)")
    expect(seg.indexOf("runCurrentTabFill('auto',product.id)")).toBeLessThan(seg.indexOf("runCurrentTabFill('fixed',product.id)"))
  })
  it('串联完成 notice 汇总自动填写与固定填写两阶段，且声明未点最终提交', () => {
    const seg = source.split('const manualPublishLocal=')[1]?.split('const sendBackToPremium=')[0] ?? ''
    expect(seg).toContain('自动填写')
    expect(seg).toContain('固定填写')
    expect(seg).toContain('最终提交')
  })
})