/**
 * 发布编辑器 footer 缺口列项守卫：
 * 「还有 N 项必须修改后才能保存」必须显式列出缺失必填项名称（formatFormGaps 真值），
 * 不得只报数量让操作手猜；errors 来源口径不动。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const editor = readFileSync(path.resolve(__dirname, '../EbayLocalListingEditor.tsx'), 'utf8')

describe('footer 缺口列项', () => {
  it('计数后显式列项（validateDraft ERROR message 真值）', () => {
    expect(editor).toContain('还有 ${errors.length} 项必须修改后才能保存：${errors.map(item=>item.message).join(\'、\')}')
  })

  it('errors 来源口径不动', () => {
    expect(editor).toContain("const errors=issues.filter(item=>item.level==='ERROR')")
  })

  it('无缺口时的保存语义文案不动', () => {
    expect(editor).toContain('保存标题、描述、价格、状况、数量、SKU、类目属性与政策所在地；库存与业务政策仍只在 eBay 页面生效')
  })
})