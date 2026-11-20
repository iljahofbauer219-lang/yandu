import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-19 双截图黄/红框）：优品卡按钮行新增「打回本地」＝产品回本地产品环节；
 * 「查看优化版本」按态改名：未完善＝重新优化（进优化工作台再优化）、全通过＝优化成功（绿洗色区别）；
 * 红框的未优化项 chips 与缺失提示行隐藏（占界面空间）。
 * 打回实现：seed 重建本地行＋草稿 returnedAt 历史标记；双向阶段过滤忽略已打回草稿，
 * 否则本地/优品两视图互斥会把产品藏没。草稿记录保留为历史，不新增删除 IPC。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const contracts = readFileSync(path.resolve(process.cwd(), 'src/shared/contracts.ts'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/image-studio.css'), 'utf8')

describe('优品打回本地 · 阶段互斥与历史标记', () => {
  it('契约有 returnedAt 历史标记字段', () => {
    expect(contracts).toContain('returnedAt?:string|null')
  })
  it('本地视图过滤忽略已打回草稿（重建行可见）', () => {
    expect(app).toContain('const localStageProducts=localProducts.filter(product=>!optimizationDrafts.some(draft=>!draft.returnedAt&&draft.listing.listingId===product.listingId))')
  })
  it('优品视图过滤忽略已打回草稿（让位）', () => {
    expect(app).toContain('const premiumStageDrafts=optimizationDrafts.filter(draft=>!draft.returnedAt&&draft.publishRef?.kind!==\'listing\'&&!localProducts.some(')
  })
  it('定时行重新优化不找回已打回草稿（回落新优化）', () => {
    expect(app).toContain('optimizationDrafts.find(item=>!item.returnedAt&&item.listing.listingId===product.listingId)')
  })
})

describe('优品打回本地 · handler 链路', () => {
  const seg = app.split('const sendPremiumBackToLocal=async(draft:EbayOptimizationDraft)=>{')[1]?.split('\n  const openOptimizedVersion')[0] ?? ''
  it('二次确认披露后果后才执行', () => {
    expect(seg).toContain('window.confirm(')
    expect(seg).toContain('打回本地产品？')
    expect(seg).toContain('退出优品仓库')
    expect(seg.indexOf('window.confirm(')).toBeLessThan(seg.indexOf('seedLocalProductFromPremium'))
  })
  it('先 seed 重建本地行再置 returnedAt，随后双列表刷新', () => {
    expect(seg).toContain("window.desktop.ebay.seedLocalProductFromPremium(draft.storeId,draft,draft.publishRef?.kind==='draft'?draft.publishRef.id:'')")
    expect(seg).toContain('window.desktop.ebay.saveOptimizationDraft({...draft,returnedAt:new Date().toISOString()})')
    expect(seg.indexOf('seedLocalProductFromPremium')).toBeLessThan(seg.indexOf('returnedAt:new Date()'))
    expect(seg).toContain('setLocalProducts(await window.desktop.ebay.localProducts(draft.storeId))')
    expect(seg).toContain('setOptimizationDrafts(await window.desktop.ebay.optimizationDrafts(draft.storeId))')
  })
  it('失败中文全文报错、成功 notice 点名', () => {
    expect(seg).toContain("readableError(reason,'打回本地产品失败')")
    expect(seg).toContain('已打回本地产品：')
  })
})

describe('优品卡按钮行 · 两态与配色', () => {
  const seg = app.split('className="ebay-premium-card-grid"')[1]?.split('</article>')[0] ?? ''
  it('首按钮按 fullyReady 两态文案与态类', () => {
    expect(seg).toContain("className={fullyReady?'ebay-premium-ok':'ebay-premium-redo'}")
    expect(seg).toContain("{fullyReady?'优化成功':'重新优化'}")
    expect(seg).toContain('onClick={()=>openOptimizedVersion(draft)}')
  })
  it('打回本地接 handler，进入发布链路不变', () => {
    expect(seg).toContain('className="ebay-premium-return"')
    expect(seg).toContain('onClick={()=>void sendPremiumBackToLocal(draft)}>打回本地')
    expect(seg).toContain('void openPublishEditorFromDraft(draft)')
  })
  it('CSS 成功绿洗/重新优化琥珀洗/打回红洗', () => {
    expect(css).toContain('.ebay-premium-card-actions .ebay-premium-ok { color:#08716c; background:#dff6f4; border-color:#9fd8d2; }')
    expect(css).toContain('.ebay-premium-card-actions .ebay-premium-redo { color:#8a5a00; background:#fff4d6; border-color:#e8cf9a; }')
    expect(css).toContain('.ebay-premium-card-actions .ebay-premium-return { color:#a33b3b; background:#fff7f6; border-color:#edc5c2; }')
  })
  it('按钮行一排三个等宽：三列网格＋nowrap 溢出省略（2026-11-19 用户拍板）', () => {
    expect(css).toContain('.ebay-premium-card-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:9px; }')
    expect(css).toContain('.ebay-premium-card-actions>button{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:8px 6px;}')
    expect(css).not.toContain('grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:9px;')
  })
})