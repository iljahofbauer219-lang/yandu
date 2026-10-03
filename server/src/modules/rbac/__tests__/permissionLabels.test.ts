import { describe, expect, it } from 'vitest'
import { PERMISSION_LABELS } from '../permissions.js'

describe('菜单权限显示名与桌面端菜单收敛一致', () => {
  it('menu.collect 系列显示名为货盘采集', () => {
    expect(PERMISSION_LABELS['menu.collect']).toBe('货盘采集')
    expect(PERMISSION_LABELS['menu.collect.gigacloud']).toBe('货盘采集·大健云仓')
    expect(PERMISSION_LABELS['menu.collect.1688']).toBe('货盘采集·1688')
    expect(PERMISSION_LABELS['menu.collect.aliexpress']).toBe('货盘采集·AliExpress')
    expect(PERMISSION_LABELS['menu.collect.ozon']).toBe('货盘采集·Ozon')
  })
})
