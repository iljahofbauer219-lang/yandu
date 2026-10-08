import { describe, expect, it } from 'vitest'
import { shouldActivateSupplyView, shouldAutoEnterGigaLogin } from '../supplyAutoEnter'

describe('shouldAutoEnterGigaLogin', () => {
  it('AI采集工作台且大健云仓仓时触发自动登录', () => {
    expect(shouldAutoEnterGigaLogin('tasks', 'GIGACLOUD')).toBe(true)
  })

  it('其他页面或其他仓不触发', () => {
    expect(shouldAutoEnterGigaLogin('tasks', '1688')).toBe(false)
    expect(shouldAutoEnterGigaLogin('review', 'GIGACLOUD')).toBe(false)
    expect(shouldAutoEnterGigaLogin('ozon', 'GIGACLOUD')).toBe(false)
  })
})

describe('shouldActivateSupplyView', () => {
  it('没有存活的大健云仓视图时需要激活', () => {
    expect(shouldActivateSupplyView(false, 'GIGACLOUD')).toBe(true)
    expect(shouldActivateSupplyView(false, '1688')).toBe(true)
  })

  it('存活视图属于其他供应平台时需要切换激活', () => {
    expect(shouldActivateSupplyView(true, '1688')).toBe(true)
  })

  it('存活视图已是大健云仓时跳过激活，避免关闭明细 TAB', () => {
    expect(shouldActivateSupplyView(true, 'GIGACLOUD')).toBe(false)
  })
})
