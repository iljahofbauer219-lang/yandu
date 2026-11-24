import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-24 双截图）：草稿发布过一次后在 eBay 侧删除草稿，二次点击「草稿发布」
 * 必须正常重新执行发布（新建草稿），不得经旧 continue URL 重定向停在「在售」列表页。
 * 根因：refDeleted 旧探测只认 lstng/error 错误页；删除后 continue URL 重定向 sh/lst/active 等列表页，
 * 探测 !ready 抛错、ref 保留 → 不重建。修复：列表页落地＋复用 draft ref 即判 refDeleted，
 * 交 main prepare-revision 既有「清 ref＋重试新建」分支重建新草稿。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')

describe('草稿eBay侧已删二次重发', () => {
  it('列表页落地＋draft ref 判 refDeleted（在售/草稿列表/未售/概览）', () => {
    expect(ws).toContain("if(!result.ready && product.publishRef?.kind==='draft' && /\\/sh\\/lst\\/(?:active|drafts|unsold)|\\/sh\\/ovw/.test(result.url)) {")
    expect(ws).toContain("publishRef:null,reusedRef:true,refDeleted:true}")
    expect(ws).toContain('eBay 侧草稿已删除（落地为列表页），清引用后重建新草稿')
  })
  it('探测位于 !ready throw 之前（先判删除再报错）', () => {
    const detect = ws.indexOf('eBay 侧草稿已删除（落地为列表页），清引用后重建新草稿')
    const throwIdx = ws.indexOf("if(!result.ready)throw new Error(target.kind==='revise'?")
    expect(detect).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(detect)
  })
  it('main 清 ref＋重试新建分支保留', () => {
    expect(main).toContain('if(result.refDeleted){')
    expect(main).toContain('database.setEbayLocalProductPublishRef(product.id,null)')
    expect(main).toContain('database.setEbayLocalProductDraftSaved(product.id,null)')
    expect(main).toContain('workspace.prepareEbayLocalProductRevision(`ebay:${product.storeId}`,{...product,publishRef:null},section)')
  })
})