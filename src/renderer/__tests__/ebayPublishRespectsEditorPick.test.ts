import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-22 双截图）：编辑器平台类目下拉已选值，点发布仍报「没有可用的平台类目」。
 * 根因：下拉选值＝hook pick 状态，须点「确定」才经 setLocalPlatformCategory 落库；
 * 路由（shared/ebayListingTarget）只认 product.platformCategoryId → 读空走 prelist 报错。
 * 修复：发布入口开页前把合法 pick（options 成员校验）经既有 IPC 落库再路由；
 * 不改「确定」语义、不下拉即自动写；编辑器关闭的定时链不受影响（controller null _no-op）。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('发布尊重编辑器已选平台类目', () => {
  it('helper：编辑器匹配＋pick 合法＋产品类目空才落库', () => {
    const seg = app.split('const ensurePlatformCategoryBeforePublish=async(product:EbayLocalProduct)=>{')[1]?.split('\n  const localEditorRouteKind')[0] ?? ''
    expect(seg).toContain('product.id===publishEditorProduct?.id?inlinePlatformCategory:product.id===localEditorProduct?.id?overlayPlatformCategory:null')
    expect(seg).toContain("if(!controller||!controller.pick||(product.platformCategoryId||'').trim())return product")
    expect(seg).toContain('const chosen=controller.options.find(option=>option.categoryId===controller.pick);if(!chosen)return product')
    expect(seg).toContain('window.desktop.ebay.setLocalPlatformCategory(product.id,controller.pick,chosen.name||controller.pick)')
    expect(seg).toContain('refreshLocalProduct(updated);return updated')
  })
  it('手动发布与本地编辑器准备两入口开页前接线', () => {
    expect(app).toContain('const manualPublishLocal=async(product:EbayLocalProduct,alsoSaveDraft=false)=>{product=await ensurePlatformCategoryBeforePublish(product);')
    expect(app).toContain('let product=await window.desktop.ebay.updateLocalProduct(productId,localEditorDraft);product=await ensurePlatformCategoryBeforePublish(product);')
  })
  it('路由纯函数与确定按钮语义不动', () => {
    const shared = readFileSync(path.resolve(process.cwd(), 'src/shared/ebayListingTarget.ts'), 'utf8')
    expect(shared).toContain('if (EBAY_CATEGORY_ID.test(categoryId)) {')
    const hook = readFileSync(path.resolve(process.cwd(), 'src/renderer/useEbayPlatformCategory.ts'), 'utf8')
    expect(hook).toContain('const confirm = useCallback')
    expect(hook).toContain('window.desktop.ebay.setLocalPlatformCategory(product.id, pick, chosen?.name || pick)')
  })
  it('选值即落库：默认值加载与手动改选静默写库，关编辑器后门禁仍读得到', () => {
    const hook = readFileSync(path.resolve(process.cwd(), 'src/renderer/useEbayPlatformCategory.ts'), 'utf8')
    expect(hook).toContain('if (!product || !pick || pick === savedId) return')
    expect(hook).toContain('const chosen = options.find(option => option.categoryId === pick)')
    expect(hook).toContain('window.desktop.ebay.setLocalPlatformCategory(product.id, pick, chosen.name || pick).then(updated => {')
    expect(hook).toContain('}, [productId, pick, savedId, options])')
    const autoSeg = hook.split('// 选值即落库')[1]?.split('}, [productId, pick, savedId, options])')[0] ?? ''
    expect(autoSeg).not.toContain('notify(')
    expect(hook).toContain('notify(`平台类目已保存为『${chosen?.name || pick}』`)')
  })
})