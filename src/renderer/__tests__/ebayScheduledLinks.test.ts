import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 本地定时发布列表的「优化版本/发布版本」须与优品仓库卡片「查看优化版本/进入发布」同链路：
 * 有优品草稿时走草稿链路（openOptimizedVersion / openPublishEditorFromDraft），无草稿回落本地编辑/本地发布种子。
 * 钉住命名函数提取与列表两按钮的草稿优先接线。
 */
const source = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('本地定时发布列表 · 优化版本/发布版本 与优品卡片同链路', () => {
  it('提取 openOptimizedVersion 命名函数（优品卡片复用）', () => {
    expect(source).toContain('const openOptimizedVersion=(draft:EbayOptimizationDraft)=>{')
    expect(source).toContain('onClick={()=>openOptimizedVersion(draft)}>查看优化版本')
  })
  it('列表优化版本：有草稿走 openOptimizedVersion，无草稿回落 openLocalEditor', () => {
    expect(source).toContain('if(draft)openOptimizedVersion(draft);else void openLocalEditor(product)')
  })
  it('列表发布版本：有草稿走 openPublishEditorFromDraft，无草稿回落 openPublishVersion', () => {
    expect(source).toContain('if(draft)void openPublishEditorFromDraft(draft);else openPublishVersion(product)')
  })
})