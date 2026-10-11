import { describe, expect, it } from 'vitest'
import { applyWarehouseQuickFilter, warehouseQuickCounts, type WarehouseQuickFlags } from '../warehouseQuickFilter'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const statusOf = (item: { id: string }) => ({ a: 'DOWNLOADED', b: 'FAILED' } as Record<string, string>)[item.id]
const copied = ['a']
const off: WarehouseQuickFlags = { notCopied: false, notDownloaded: false }

describe('warehouseQuickFilter（正式入库快捷筛选）', () => {
  it('两开关均关：原样返回', () => {
    expect(applyWarehouseQuickFilter(items, copied, statusOf, off)).toEqual(items)
  })

  it('未抄货盘：仅留不在 copiedIds 的商品', () => {
    expect(applyWarehouseQuickFilter(items, copied, statusOf, { ...off, notCopied: true }).map(i => i.id)).toEqual(['b', 'c'])
  })

  it('未下图文：仅留状态非 DOWNLOADED（含无记录）的商品', () => {
    expect(applyWarehouseQuickFilter(items, copied, statusOf, { ...off, notDownloaded: true }).map(i => i.id)).toEqual(['b', 'c'])
  })

  it('两开关叠加为 AND', () => {
    expect(applyWarehouseQuickFilter(items, copied, statusOf, { notCopied: true, notDownloaded: true }).map(i => i.id)).toEqual(['b', 'c'])
    expect(applyWarehouseQuickFilter([{ id: 'a' }], copied, statusOf, { notCopied: true, notDownloaded: true })).toEqual([])
  })

  it('计数与筛选口径一致', () => {
    expect(warehouseQuickCounts(items, copied, statusOf)).toEqual({ notCopied: 2, notDownloaded: 2 })
  })
})
