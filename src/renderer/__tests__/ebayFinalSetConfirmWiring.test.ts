/**
 * 「确认所有最终图片」接线守卫：
 * 简版③排序区尾右槽显式人工确认键；缺类沿用已选原图补齐落采纳态并持久化 preConfirmKept 供撤销；
 * 手动改采纳即作废确认；存优品门禁判据（imageAdoptionComplete）本身不放宽。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const panel = readFileSync(path.join(root, 'src/renderer/EbayImageStagePanel.tsx'), 'utf8')
const app = readFileSync(path.join(root, 'src/renderer/App.tsx'), 'utf8')
const css = readFileSync(path.join(root, 'src/renderer/ebay-image-stage-panel.css'), 'utf8')

describe('确认键与补齐接线', () => {
  it('排序区尾右槽渲染确认行', () => {
    expect(panel).toContain('className="ebay-stage-final-confirm-row"')
    expect(css).toContain('.ebay-stage-final-confirm-row {')
  })

  it('确认键文案与撤销态文案齐备', () => {
    expect(panel).toContain('>确认所有最终图片</button>')
    expect(panel).toContain('✓ 已确认所有最终图片 · 点击撤销</button>')
  })

  it('补齐走共享纯函数并落采纳态＋持久化＋回传下游', () => {
    expect(panel).toContain("import { fillMissingFinalCategories } from '../shared/ebayFinalSetConfirmFill'")
    expect(panel).toContain('const filled = fillMissingFinalCategories({')
    expect(panel).toContain('persist({ keptByCategory: filled, preConfirmKept: keptByCategory })')
    expect(panel).toContain('emit(filled)')
  })

  it('撤销恢复确认前采纳态并清 preConfirmKept', () => {
    expect(panel).toContain('persist({ keptByCategory: restore, preConfirmKept: null })')
    expect(panel).toContain('emit(restore)')
  })

  it('手动改采纳即作废确认（persist 默认清 preConfirmKept）', () => {
    expect(panel).toContain('preConfirmKept: next.preConfirmKept ?? null,')
  })

  it('无排序图时确认键禁用', () => {
    expect(panel).toContain('disabled={!simpleOrderEffective.length} onClick={confirmAllFinalImages}')
  })
})

describe('门禁判据不放宽', () => {
  it('存优品仍须 imageAdoptionComplete（确认键通过补齐采纳态满足它）', () => {
    expect(app).toContain("if(!imageAdoptionComplete){setEbayError('请先完成图片自然化处理并确认所有最终图片。')")
    expect(app).toContain('const imageAdoptionComplete=Boolean(allImagePurposesAccepted&&confirmedGeneratedImageUrls.length)')
  })
})