import { describe, expect, it } from 'vitest'
import { shouldForceSupplyAreaOnEnter } from '../candidateAreaGuard'

describe('shouldForceSupplyAreaOnEnter', () => {
  it('供应仓＋跨境方无数据＋当前 MARKET 时纠正为供应侧', () => {
    expect(shouldForceSupplyAreaOnEnter('ozon', 'SUPPLY', 'MARKET', 0)).toBe(true)
  })

  it('跨境方有数据时尊重用户选择', () => {
    expect(shouldForceSupplyAreaOnEnter('ozon', 'SUPPLY', 'MARKET', 3)).toBe(false)
  })

  it('已在供应侧不干预', () => {
    expect(shouldForceSupplyAreaOnEnter('ozon', 'SUPPLY', 'SUPPLY', 0)).toBe(false)
  })

  it('非供应仓或非候选页不干预', () => {
    expect(shouldForceSupplyAreaOnEnter('ozon', 'MARKET', 'MARKET', 0)).toBe(false)
    expect(shouldForceSupplyAreaOnEnter('tasks', 'SUPPLY', 'MARKET', 0)).toBe(false)
  })
})
