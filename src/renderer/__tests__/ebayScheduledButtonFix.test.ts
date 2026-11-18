import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 行内按钮接线修复（2026-11-18）：重新优化＝有优品草稿恢复优化稿进 AI优化，无草稿进入
 * AI优化对该产品重新优化（selectForOptimization），不得误开本地编辑；
 * 本地版本＝恒以本地产品种子开发布编辑器（openPublishVersion），不得误用优品草稿种子。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('定时发布行 · 重新优化/本地版本 接线', () => {
  it('重新优化：有草稿恢复优化稿，无草稿进 AI优化重新优化（非本地编辑）', () => {
    expect(app).toContain('if(draft)openOptimizedVersion(draft);else selectForOptimization(product)')
    expect(app).not.toContain('if(draft)openOptimizedVersion(draft);else void openLocalEditor(product)')
  })
  it('本地版本：恒本地种子开发布编辑器', () => {
    expect(app).toContain('onClick={()=>openPublishVersion(product)}>本地版本')
    expect(app).not.toContain('if(draft)void openPublishEditorFromDraft(draft);else openPublishVersion(product)')
  })
})