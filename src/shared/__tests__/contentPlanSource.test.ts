import { describe, expect, it } from 'vitest'
import { resolveContentPlanSource } from '../contentPlanSource'

const local = { sourceDescription: '旧乱文 帮助中心 单价(件) $235.00', itemSpecifics: [{ name: 'Brand', value: 'X' }] }
const latest = { sourceDescription: '座椅采用优质PVC皮革包裹。', itemSpecifics: [{ name: 'Material', value: 'PVC' }] }

describe('resolveContentPlanSource（生成方案重读最新下载图文）', () => {
  it('最新事实有内容时整体采纳（覆盖本地旧文）', () => {
    const resolved = resolveContentPlanSource(local, latest)
    expect(resolved.refreshed).toBe(true)
    expect(resolved.source).toEqual(latest)
  })

  it('最新事实为空时保留本地事实', () => {
    expect(resolveContentPlanSource(local, { sourceDescription: '', itemSpecifics: [] })).toEqual({ source: local, refreshed: false })
    expect(resolveContentPlanSource(local, null)).toEqual({ source: local, refreshed: false })
  })

  it('最新仅有规格无描述也采纳（描述取最新空串以外内容优先）', () => {
    const resolved = resolveContentPlanSource(local, { sourceDescription: '', itemSpecifics: latest.itemSpecifics })
    expect(resolved.refreshed).toBe(true)
    expect(resolved.source.itemSpecifics).toEqual(latest.itemSpecifics)
    expect(resolved.source.sourceDescription).toBe(local.sourceDescription)
  })
})
