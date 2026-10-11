import { describe, expect, it } from 'vitest'
import { hubTabsForScope } from '../PalletWarehousePage'

describe('我的货盘顶栏页签精简', () => {
  it('货盘仓库保留全部九页签且顺序不变', () => {
    expect([...hubTabsForScope('warehouse')]).toEqual(['入库处理', '全部产品', '地区货盘', '新品速递', '热销产品', '时节热品', '限时促销', '即将到货', '下架产品'])
  })

  it('我的货盘仅留四页签', () => {
    expect([...hubTabsForScope('mine')]).toEqual(['全部产品', '地区货盘', '即将到货', '下架产品'])
  })

  it('被删五签在我的货盘无残留', () => {
    const mine = hubTabsForScope('mine')
    for (const removed of ['入库处理', '新品速递', '热销产品', '时节热品', '限时促销']) expect(mine).not.toContain(removed)
  })
})
