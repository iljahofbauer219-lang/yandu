/**
 * 场景标注显示接线守卫：
 * - contracts 新增独立 scenario 字段（不复用 strengths）
 * - 面板模型下拉（多生图片区＋单张重生成区两处共用）下显示所选模型「适用场景」一行，未标注隐行
 * - 默认推荐匹配与下拉 option 文案口径不动
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const panel = readFileSync(path.join(root, 'src/renderer/EbayImageStagePanel.tsx'), 'utf8')
const contracts = readFileSync(path.join(root, 'src/shared/contracts.ts'), 'utf8')
const css = readFileSync(path.join(root, 'src/renderer/ebay-image-stage-panel.css'), 'utf8')

describe('场景字段与显示接线', () => {
  it('ImageModelProfile 声明独立 scenario 可选字段', () => {
    expect(contracts).toContain('scenario?: string')
  })

  it('renderModelSelect 内取所选模型 profile', () => {
    expect(panel).toContain('const selected = props.imageModels.find(model => model.id === modelId)')
  })

  it('所选模型有场景才渲染「适用场景」行，未标注隐行', () => {
    expect(panel).toContain('{selected?.scenario ? <p className="ebay-stage-model-scenario">适用场景：{selected.scenario}</p> : null}')
  })

  it('两处模型选择区（多生图片＋单张重生成）共用同一渲染函数', () => {
    expect(panel.match(/\{renderModelSelect\(\)\}/g)?.length).toBe(2)
  })

  it('场景行样式登记在面板 CSS', () => {
    expect(css).toContain('.ebay-stage-model-scenario {')
  })
})

describe('既有口径不动', () => {
  it('默认推荐仍按 strengths/description 关键词匹配，不被场景字段替代', () => {
    expect(panel).toContain("['主图', '白底', '保真'].some(keyword => (model.strengths || '').includes(keyword) || (model.description || '').includes(keyword))")
  })

  it('下拉 option 仍为 名称 · 成本标签，不塞场景文案', () => {
    expect(panel).toContain('{model.name}{model.costLabel ? ` · ${model.costLabel}` : \'\'}')
  })
})