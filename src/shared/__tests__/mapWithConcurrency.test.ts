/**
 * 有界并发守卫：最终图集检查批量读图须限并发（上游限流下无限并发瞬时超时曾被误判 BLOCKED），
 * 结果按输入序返回；空输入不发 worker。
 */
import { describe, expect, it } from 'vitest'

async function getFn() {
  const mod = await import('../mapWithConcurrency.js').catch(() => null)
  return mod?.mapWithConcurrency
}

describe('mapWithConcurrency', () => {
  it('并发峰值不超过 limit 且结果按输入序', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    let active = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, i) => i)
    const out = await fn!(items, 4, async item => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return item * 2
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(out).toEqual(items.map(i => i * 2))
  })

  it('空输入返回空数组', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    expect(await fn!([], 4, async () => 1)).toEqual([])
  })

  it('limit 大于长度时按长度开 worker', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    let peak = 0
    let active = 0
    const out = await fn!([1, 2], 9, async item => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return item
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(out).toEqual([1, 2])
  })
})