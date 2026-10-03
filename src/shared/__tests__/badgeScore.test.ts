import { describe, expect, it } from 'vitest'
import { badgeFallbackScore } from '../badgeScore'

describe('badgeFallbackScore', () => {
  it('选品快照得分优先，保证入库卡与优选卡同口径', () => {
    expect(badgeFallbackScore(73, 80)).toBe(73)
  })

  it('无选品快照时回退候选得分', () => {
    expect(badgeFallbackScore(undefined, 64)).toBe(64)
    expect(badgeFallbackScore(null, 64)).toBe(64)
  })

  it('两者皆缺返回 undefined，徽标显示待评分', () => {
    expect(badgeFallbackScore(undefined, undefined)).toBeUndefined()
    expect(badgeFallbackScore(null, null)).toBeUndefined()
  })

  it('忽略非有限数值', () => {
    expect(badgeFallbackScore(Number.NaN, 55)).toBe(55)
    expect(badgeFallbackScore(Number.POSITIVE_INFINITY, undefined)).toBeUndefined()
  })
})
