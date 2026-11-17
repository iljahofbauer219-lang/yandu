import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 草稿发布须区别于手动发布（2026-11-16）：串联 预填→自动填写→固定填写 完成后，
 * 自动点 eBay「保存草稿稍后再完成」把产品存入 eBay 草稿栏；手动发布不点。
 * 绝不点最终「刊登」提交。主进程按文案匹配点击（避开刊登/预览），渲染器仅草稿发布传 saveDraft。
 */
const ws = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/preload.ts'), 'utf8')
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('eBay 保存草稿 · 主进程点击通道', () => {
  it('数量等 text-name 写入须 focus→写→input/change/focusout→blur，回读不一致重试一次', () => {
    const block = ws.split("if(t.control==='text-name'){")[1]?.split("if(t.control==='volume-pricing'){")[0] ?? ''
    expect(block, '写入前聚焦').toContain('el.focus()')
    expect(block, '写入后失焦同步 eBay 自定义 textbox 模型').toContain('el.blur()')
    expect(block, '补 focusout 事件').toContain("new Event('focusout',{bubbles:true})")
    expect(block, '回读不一致重试一次').toContain('if(clean(el.value)!==want){write();await wait(300)}')
    expect(block, '重试后仍不一致才记跳过').toContain('（写入后回读不一致）')
  })
  it('保存草稿锁定填写所用页签，不再回落任意 lstng 页签存错页', () => {
    expect(ws, '填写时记录页签').toContain('this.lastFillTabId=tab.id')
    expect(ws, '字段声明').toContain('private lastFillTabId:string|null=null')
    const save = ws.split('async saveEbayCurrentDraft(')[1]?.split('async fillCurrentEbayTab(')[0] ?? ''
    expect(save, '保存优先用填写页签').toContain('this.lastFillTabId?this.detailTabs.get(this.lastFillTabId):undefined')
  })
  it('BrowserWorkspace 有 saveEbayCurrentDraft，按「保存草稿稍后再完成/Save draft」文案匹配', () => {
    expect(ws).toContain('async saveEbayCurrentDraft(')
    expect(ws).toContain('保存草稿稍后再完成')
    expect(ws).toContain('Save draft')
  })
  it('点击匹配排除最终刊登与预览，绝不提交', () => {
    expect(ws).toContain('刊登')
    expect(ws).toContain('预览')
    expect(ws).toMatch(/!\/[^/]*刊登[^/]*\/[a-z]*\.test/)
  })
  it('main 注册 ebay:save-current-draft，preload 暴露 saveCurrentDraft', () => {
    expect(main).toContain("ipcMain.handle('ebay:save-current-draft'")
    expect(preload).toContain('saveCurrentDraft')
    expect(preload).toContain('ebay:save-current-draft')
  })
})

describe('eBay 保存草稿 · 渲染器仅草稿发布触发', () => {
  it('manualPublishLocal 接受 alsoSaveDraft 开关并在串联后调 saveCurrentDraft', () => {
    expect(app).toContain('const manualPublishLocal=async(product:EbayLocalProduct,alsoSaveDraft=false)')
    expect(app).toContain('window.desktop.ebay.saveCurrentDraft(product.id)')
  })
  it('草稿发布按钮传 true，手动发布按钮不传（保持不点保存草稿）', () => {
    expect(app).toContain('onClick={()=>void manualPublishLocal(product,true)}>草稿发布')
    expect(app).toContain('onClick={()=>product.draftSavedAt?viewPublishDraft(product):void manualPublishLocal(product)}>手动发布')
  })
})