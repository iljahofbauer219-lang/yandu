import { describe, expect, it } from 'vitest'
import { copiedWarehouseIds } from '../copiedPallet'

const row = (origin: string, warehouseProductId: string | null, status = 'PENDING') => ({ origin, warehouseProductId, status })

describe('copiedWarehouseIds（已抄送货盘状态派生）', () => {
  it('空队列返回空数组', () => {
    expect(copiedWarehouseIds([])).toEqual([])
  })

  it('仅收 WAREHOUSE 来源行的 warehouseProductId 并去重', () => {
    expect(copiedWarehouseIds([row('WAREHOUSE', 'wh-1'), row('ERP', 'wh-2'), row('WAREHOUSE', null), row('WAREHOUSE', 'wh-1')])).toEqual(['wh-1'])
  })

  it('驳回（REJECTED）行不算已抄送，确认（CONFIRMED）行仍算', () => {
    expect(copiedWarehouseIds([row('WAREHOUSE', 'wh-1', 'REJECTED'), row('WAREHOUSE', 'wh-2', 'CONFIRMED')])).toEqual(['wh-2'])
  })
})
