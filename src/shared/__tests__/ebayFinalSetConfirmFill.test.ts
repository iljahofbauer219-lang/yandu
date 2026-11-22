/**
 * 「确认所有最终图片」缺类补齐判据：
 * 已采纳类不动；未生成类优先用该类生成图，否则按已选原图角色补齐（角色缺位时按池序沿用原图），
 * 同一 URL 不得跨类重复占用；无源可补时该类保持缺失（门禁仍拦，不臆造）。
 */
import { describe, expect, it } from 'vitest'

async function getFn() {
  const mod = await import('../ebayFinalSetConfirmFill.js').catch(() => null)
  return mod?.fillMissingFinalCategories
}

const SOURCES = [
  { url: 's-hero', role: 'HERO' },
  { url: 's-detail-1', role: 'DETAIL' },
  { url: 's-detail-2', role: 'DETAIL' },
  { url: 's-scene', role: 'SCENE' }
]

describe('fillMissingFinalCategories', () => {
  it('已采纳类原样保留，缺类按角色补齐', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    const out = fn!({ kept: { SCENE: ['g-scene'] }, sources: SOURCES, generated: {} })
    expect(out.SCENE).toEqual(['g-scene'])
    expect(out.HERO).toEqual(['s-hero'])
    expect(out.PRODUCT).toEqual(['s-detail-1'])
    expect(out.PAIN_POINT).toEqual(['s-detail-2'])
  })

  it('缺类优先用该类生成图而非原图', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    const out = fn!({ kept: {}, sources: SOURCES, generated: { PAIN_POINT: ['g-pain'] } })
    expect(out.PAIN_POINT).toEqual(['g-pain'])
    expect(out.HERO).toEqual(['s-hero'])
  })

  it('同一 URL 不跨类重复占用', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    const out = fn!({ kept: { HERO: ['s-detail-1'] }, sources: SOURCES, generated: {} })
    const all = Object.values(out).flat()
    expect(new Set(all).size).toBe(all.length)
    expect(out.PRODUCT).toEqual(['s-detail-2'])
  })

  it('角色缺位时按池序沿用原图补齐', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    const out = fn!({ kept: {}, sources: [{ url: 'a', role: 'DETAIL' }, { url: 'b', role: 'DETAIL' }], generated: {} })
    expect(out.HERO).toEqual(['a'])
    expect(out.PRODUCT).toEqual(['b'])
    expect(out.PAIN_POINT).toBeUndefined()
    expect(out.SCENE).toBeUndefined()
  })

  it('无源无生成时缺类保持缺失（不臆造）', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    const out = fn!({ kept: {}, sources: [], generated: {} })
    expect(Object.keys(out)).toEqual([])
  })
})