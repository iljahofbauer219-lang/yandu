import { describe, expect, it } from 'vitest'
import { inferCandidateGigaIndex, missingCandidateFacts, type CandidateFactsGateInput } from '../candidateFactsGate'

const complete: CandidateFactsGateInput = {
  platformCode: 'GIGACLOUD',
  priceText: '$259.00',
  shippingFeeText: '$138.76 /件',
  sellableInventory: 136,
  salesText: '可售库存 136',
  exactCatalog: true,
  gigaIndex: 75.74
}

describe('missingCandidateFacts', () => {
  it('五要素齐全返回空清单', () => {
    expect(missingCandidateFacts(complete)).toEqual([])
  })

  it('可售库存 0 为有效读取', () => {
    expect(missingCandidateFacts({ ...complete, sellableInventory: 0, salesText: '' })).toEqual([])
  })

  it('逐项缺失返回对应中文标签', () => {
    expect(missingCandidateFacts({ ...complete, priceText: '' })).toEqual(['价格'])
    expect(missingCandidateFacts({ ...complete, priceText: '   ' })).toEqual(['价格'])
    expect(missingCandidateFacts({ ...complete, shippingFeeText: '' })).toEqual(['物流费'])
    expect(missingCandidateFacts({ ...complete, sellableInventory: null, salesText: '' })).toEqual(['可售库存'])
    expect(missingCandidateFacts({ ...complete, sellableInventory: undefined, salesText: '待补采' })).toEqual(['可售库存'])
    expect(missingCandidateFacts({ ...complete, exactCatalog: false })).toEqual(['原始类目'])
    expect(missingCandidateFacts({ ...complete, gigaIndex: null })).toEqual(['GIGA Index'])
  })

  it('多项缺失按价格/物流费/可售库存/原始类目/GIGA Index 顺序返回', () => {
    expect(missingCandidateFacts({ ...complete, priceText: '', shippingFeeText: '', gigaIndex: null }))
      .toEqual(['价格', '物流费', 'GIGA Index'])
  })

  it('可售库存数字缺失但 salesText 带真值时不算缺失', () => {
    expect(missingCandidateFacts({ ...complete, sellableInventory: null, salesText: 'Available Stock: 88' })).toEqual([])
  })

  it('非大健云仓平台不设闸口', () => {
    expect(missingCandidateFacts({ ...complete, platformCode: '1688', priceText: '', shippingFeeText: '', exactCatalog: false, gigaIndex: null })).toEqual([])
  })
})

describe('inferCandidateGigaIndex', () => {
  it('优先使用已采集的 gigaIndex', () => {
    expect(inferCandidateGigaIndex({ gigaIndex: 81.2, platformCode: 'GIGACLOUD', supplierBadges: [], score: 10 })).toBe(81.2)
  })

  it('无 gigaIndex 时按 GIGA_INDEX 徽标与得分回退', () => {
    expect(inferCandidateGigaIndex({ gigaIndex: null, platformCode: 'GIGACLOUD', supplierBadges: ['GIGA_INDEX'], score: 72 })).toBe(72)
  })

  it('无徽标或零分时返回 null', () => {
    expect(inferCandidateGigaIndex({ gigaIndex: null, platformCode: 'GIGACLOUD', supplierBadges: [], score: 72 })).toBeNull()
    expect(inferCandidateGigaIndex({ gigaIndex: null, platformCode: 'GIGACLOUD', supplierBadges: ['GIGA_INDEX'], score: 0 })).toBeNull()
  })
})
