import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 草稿发布完成态（2026-11-16）：成功后该产品「草稿发布」禁用＋异色（已完成不可操作），
 * 持久化 draftSavedAt（重启不丢）；仅当 eBay 侧草稿被删除（refDeleted）才清位恢复可操作。
 * 手动发布/草稿查看不受影响。
 */
const contracts = readFileSync(path.resolve(process.cwd(), 'src/shared/contracts.ts'), 'utf8')
const db = readFileSync(path.resolve(process.cwd(), 'src/main/database/AppDatabase.ts'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/preload.ts'), 'utf8')
const globalDts = readFileSync(path.resolve(process.cwd(), 'src/renderer/global.d.ts'), 'utf8')
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')

describe('草稿发布完成态 · 持久化契约与库', () => {
  it('EbayLocalProduct 增 draftSavedAt；DB 建列/映射/ setter 齐备', () => {
    expect(contracts).toContain('draftSavedAt?:string|null')
    expect(db).toContain("ensureColumn('ebay_local_products', 'draft_saved_at'")
    expect(db).toContain('draftSavedAt:String(row.draft_saved_at||\'\')||null')
    expect(db).toContain('setEbayLocalProductDraftSaved(localProductId:string, at:string|null)')
  })
  it('save-current-draft 成功置位；prepare 判 eBay 草稿已删（refDeleted）清位', () => {
    expect(main).toContain("ipcMain.handle('ebay:save-current-draft', async (_event, localProductId?:string)")
    expect(main).toContain("if(result.status==='SAVED'&&localProductId)database.setEbayLocalProductDraftSaved(localProductId,new Date().toISOString())")
    const refSeg = main.split('if(result.refDeleted){')[1]?.split('if(result.publishRef)')[0] ?? ''
    expect(refSeg).toContain('database.setEbayLocalProductDraftSaved(product.id,null)')
  })
  it('preload/global.d.ts 的 saveCurrentDraft 接受 localProductId', () => {
    expect(preload).toContain('saveCurrentDraft: (localProductId?:string)')
    expect(globalDts).toContain('saveCurrentDraft(localProductId?:string)')
  })
})

describe('草稿发布完成态 · 按钮禁用异色与恢复', () => {
  it('草稿发布按钮按 draftSavedAt 禁用＋draft-saved 异色类；手动发布不受影响', () => {
    expect(app).toContain("className={product.draftSavedAt?'draft-saved':''} disabled={Boolean(busy)||Boolean(product.draftSavedAt)}")
    expect(app).toContain('onClick={()=>void manualPublishLocal(product,true)}>草稿发布')
    expect(app).toContain('onClick={()=>product.draftSavedAt?viewPublishDraft(product):void manualPublishLocal(product)}>手动发布')
  })
  it('保存草稿成功后回拉本地产品使按钮立即进入完成态', () => {
    const seg = app.split('const manualPublishLocal=')[1]?.split('const sendBackToPremium=')[0] ?? ''
    expect(seg).toContain('window.desktop.ebay.saveCurrentDraft(product.id)')
    expect(seg).toContain('setLocalProducts(await window.desktop.ebay.localProducts(product.storeId))')
  })
  it('CSS 有 draft-saved 异色规则（区别于绿色常态）', () => {
    expect(css).toContain('.ebay-scheduled-row button.draft-saved{')
  })
  it('完成态后手动发布仅打开既有草稿（viewPublishDraft），未置位保持原串联', () => {
    expect(app).toContain('onClick={()=>product.draftSavedAt?viewPublishDraft(product):void manualPublishLocal(product)}>手动发布')
  })
})