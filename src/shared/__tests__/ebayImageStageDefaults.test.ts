import { describe, expect, it } from 'vitest'
import * as plan from '../ebayImageCategoryPlan'

type LaneDecision = { lane: 'simple' | 'model' | undefined; migrated: boolean }
const getFn = () => {
  const fn = (plan as Record<string, unknown>).migrateEbayImageStageLane
  expect(typeof fn).toBe('function')
  return fn as (parsed: unknown) => LaneDecision
}

const LEGACY = { HERO: 2, PRODUCT: 1, PAIN_POINT: 1, SCENE: 1 }

describe('图片优化档位新默认常量', () => {
  it('四类张数零默认：主图/细节/痛点/场景全 0', () => {
    expect((plan as Record<string, unknown>).ZERO_EBAY_IMAGE_CATEGORY_COUNTS).toEqual({ HERO: 0, PRODUCT: 0, PAIN_POINT: 0, SCENE: 0 })
  })
  it('旧默认签名恰为 2/1/1/1（截图时代持久化值）', () => {
    expect((plan as Record<string, unknown>).LEGACY_IMAGE_STAGE_DEFAULT_COUNTS).toEqual(LEGACY)
  })
})

describe('migrateEbayImageStageLane 迁移判据', () => {
  it('无持久化：不迁移，档位交给新默认（简版）', () => {
    expect(getFn()(null)).toEqual({ lane: undefined, migrated: false })
  })
  it('显式简版＋旧张数：尊重不迁移（一次性写回后不再触发）', () => {
    expect(getFn()({ lane: 'simple', counts: LEGACY })).toEqual({ lane: 'simple', migrated: false })
  })
  it('显式模型＋恰旧默认 2/1/1/1：一次性迁移为简版', () => {
    expect(getFn()({ lane: 'model', counts: LEGACY })).toEqual({ lane: 'simple', migrated: true })
  })
  it('档位缺失＋恰旧默认 2/1/1/1：一次性迁移为简版', () => {
    expect(getFn()({ counts: LEGACY })).toEqual({ lane: 'simple', migrated: true })
  })
  it('模型＋非旧默认 3/1/1/1：尊重不覆盖', () => {
    expect(getFn()({ lane: 'model', counts: { HERO: 3, PRODUCT: 1, PAIN_POINT: 1, SCENE: 1 } })).toEqual({ lane: 'model', migrated: false })
  })
  it('档位缺失＋共享默认 3/3/2/2：不迁移，张数保留、档位走新默认', () => {
    expect(getFn()({ counts: { HERO: 3, PRODUCT: 3, PAIN_POINT: 2, SCENE: 2 } })).toEqual({ lane: undefined, migrated: false })
  })
  it('模型＋2/1/1/2（仅一类不同）：不满足恰等于判据，不迁移', () => {
    expect(getFn()({ lane: 'model', counts: { HERO: 2, PRODUCT: 1, PAIN_POINT: 1, SCENE: 2 } })).toEqual({ lane: 'model', migrated: false })
  })
  it('张数缺失＋档位缺失：不迁移', () => {
    expect(getFn()({})).toEqual({ lane: undefined, migrated: false })
  })
  it('迁移结果幂等：写回后的 blob 再读不再迁移', () => {
    const fn = getFn()
    const first = fn({ lane: 'model', counts: LEGACY })
    expect(first.migrated).toBe(true)
    expect(fn({ lane: first.lane, counts: LEGACY })).toEqual({ lane: 'simple', migrated: false })
  })
})