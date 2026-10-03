import { describe, expect, it } from 'vitest'
import { mergeCandidateFacts } from '../candidateFactsMerge'

const EXACT = { platformCode: 'GIGACLOUD', status: 'EXACT', pathNames: ['汽车配件与运输', '电动代步车', '电动代步车'], pathIds: ['1', '2', '3'], level1: { id: '1', name: '汽车配件与运输' }, level2: { id: '2', name: '电动代步车' }, level3: { id: '3', name: '电动代步车' }, catalogVersion: 'v1', capturedFrom: 'BREADCRUMB', capturedAt: '2026-01-01T00:00:00.000Z' }
const DEGRADED = { platformCode: 'GIGACLOUD', status: 'NEEDS_REVIEW', pathNames: [], pathIds: [], catalogVersion: 'v1', capturedFrom: 'PAGE_CONTEXT', capturedAt: '2026-01-02T00:00:00.000Z' }

describe('mergeCandidateFacts', () => {
  it('空串/null/undefined 不覆盖既有值', () => {
    const merged = mergeCandidateFacts({ salesText: '可售库存 60', sellableInventory: 60, shippingFeeText: '$43.05 /件' }, { salesText: '', sellableInventory: null, shippingFeeText: undefined, priceText: '$99' })
    expect(merged).toMatchObject({ salesText: '可售库存 60', sellableInventory: 60, shippingFeeText: '$43.05 /件', priceText: '$99' })
  })

  it('0 库存是合法新值，覆盖旧值', () => {
    expect(mergeCandidateFacts({ sellableInventory: 60, salesText: '可售库存 60' }, { sellableInventory: 0, salesText: '可售库存 0' })).toMatchObject({ sellableInventory: 0, salesText: '可售库存 0' })
  })

  it('降级 sourceCategory 不覆盖 EXACT 旧值', () => {
    const merged = mergeCandidateFacts({ sourceCategory: EXACT }, { sourceCategory: DEGRADED })
    expect(merged.sourceCategory).toEqual(EXACT)
  })

  it('EXACT 新值覆盖 PARTIAL 旧值', () => {
    const merged = mergeCandidateFacts({ sourceCategory: { ...DEGRADED, status: 'PARTIAL' } }, { sourceCategory: EXACT })
    expect(merged.sourceCategory).toEqual(EXACT)
  })

  it('旧值缺失时降级新值也写入', () => {
    const merged = mergeCandidateFacts({}, { sourceCategory: DEGRADED })
    expect(merged.sourceCategory).toEqual(DEGRADED)
  })

  it('非保护字段按新值覆盖', () => {
    expect(mergeCandidateFacts({ gigaIndex: 64.1 }, { gigaIndex: 70.5 })).toMatchObject({ gigaIndex: 70.5 })
  })
})
