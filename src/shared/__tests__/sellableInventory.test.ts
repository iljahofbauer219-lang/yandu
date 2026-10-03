import { describe, expect, it } from 'vitest'
import { matchSellableInventoryText } from '../sellableInventory'

describe('matchSellableInventoryText', () => {
  it('标签在前形态：可售库存 100', () => {
    expect(matchSellableInventoryText('采购数量 可售库存 100 全部库存可售')).toMatchObject({ sellableInventory: 100, stockText: '可售库存 100' })
  })

  it('数字在前形态：60 可售库存（大健云仓采购数量行）', () => {
    expect(matchSellableInventoryText('采购数量 − 1 + 件 60 可售库存 全部库存可售')).toMatchObject({ sellableInventory: 60, stockText: '可售库存 60' })
  })

  it('英文别名与千分位', () => {
    expect(matchSellableInventoryText('Available Stock: 1,200')).toMatchObject({ sellableInventory: 1200 })
    expect(matchSellableInventoryText('2,200 Available Stock')).toMatchObject({ sellableInventory: 2200 })
  })

  it('0 是合法值不得吞掉', () => {
    expect(matchSellableInventoryText('0 可售库存')).toMatchObject({ sellableInventory: 0 })
  })

  it('无库存信息返回 null', () => {
    expect(matchSellableInventoryText('物流费 $43.05 /件 阶梯价 $710.00')).toBeNull()
  })
})
