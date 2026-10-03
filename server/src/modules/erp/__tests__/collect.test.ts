import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  ERP_STATUS_ORDER,
  collectBatchSchema,
  collectItemSchema,
  diffProductFields,
  isProcessedStatus,
  isUniqueViolation,
  type CollectItemInput
} from '../collect.js'

function item(overrides: Partial<CollectItemInput> = {}): CollectItemInput {
  return collectItemSchema.parse({
    supplierId: 's1',
    sourceProductId: 'SP-1',
    sourceUrl: 'https://gigab2b.com/p/1',
    titleOriginal: '刹车片',
    costPrice: 10,
    shippingCost: 2,
    stockQuantity: 100,
    images: [{ imageType: 'MAIN', sourceUrl: 'https://img/1.jpg' }],
    ...overrides
  })
}

describe('ERP 采集去重三态：状态顺序与已加工判定', () => {
  it('状态顺序 COLLECTED<DOWNLOADED<PROCESSING<READY<PUBLISHED', () => {
    expect(ERP_STATUS_ORDER.COLLECTED).toBeLessThan(ERP_STATUS_ORDER.DOWNLOADED)
    expect(ERP_STATUS_ORDER.DOWNLOADED).toBeLessThan(ERP_STATUS_ORDER.PROCESSING)
    expect(ERP_STATUS_ORDER.PROCESSING).toBeLessThan(ERP_STATUS_ORDER.READY)
    expect(ERP_STATUS_ORDER.READY).toBeLessThan(ERP_STATUS_ORDER.PUBLISHED)
  })

  it('仅 COLLECTED 视为未加工（可覆盖），其余为已加工（只置 change_flag）', () => {
    expect(isProcessedStatus('COLLECTED')).toBe(false)
    expect(isProcessedStatus('DOWNLOADED')).toBe(true)
    expect(isProcessedStatus('PROCESSING')).toBe(true)
    expect(isProcessedStatus('READY')).toBe(true)
    expect(isProcessedStatus('PUBLISHED')).toBe(true)
  })
})

describe('ERP 采集字段 diff（纯函数，巡盘/覆盖共用）', () => {
  it('内容一致时 diff 为空（触发 UNCHANGED，不弹确认）', () => {
    const existing = {
      titleOriginal: '刹车片',
      costPrice: 10,
      shippingCost: 2,
      stockQuantity: 100,
      weight: null,
      material: '',
      color: '',
      brand: '',
      category: '',
      currency: 'CNY',
      sourceUrl: 'https://gigab2b.com/p/1',
      variants: [],
      images: [{ sourceUrl: 'https://img/1.jpg' }]
    }
    expect(diffProductFields(existing, item())).toEqual([])
  })

  it('成本价变化被捕获', () => {
    const diffs = diffProductFields({ costPrice: 10, images: [] }, item({ costPrice: 12.5 }))
    expect(diffs).toContainEqual({ field: 'costPrice', oldValue: '10', newValue: '12.5' })
  })

  it('库存/运费/标题多字段同时变化各自成条', () => {
    const diffs = diffProductFields(
      { titleOriginal: '刹车片', costPrice: 10, shippingCost: 2, stockQuantity: 100, images: [] },
      item({ titleOriginal: '陶瓷刹车片', shippingCost: 3, stockQuantity: 50 })
    )
    const fields = diffs.map(d => d.field)
    expect(fields).toContain('titleOriginal')
    expect(fields).toContain('shippingCost')
    expect(fields).toContain('stockQuantity')
    expect(fields).not.toContain('costPrice')
  })

  it('变体 JSON 变化被捕获', () => {
    const diffs = diffProductFields({ variants: [{ sku: 'A' }], images: [] }, item({ variants: [{ sku: 'A' }, { sku: 'B' }] }))
    expect(diffs.some(d => d.field === 'variants')).toBe(true)
  })

  it('图片 URL 集合变化被捕获（忽略顺序）', () => {
    const sameButReordered = diffProductFields(
      { images: [{ sourceUrl: 'https://img/1.jpg' }] },
      item({ images: [{ imageType: 'MAIN', sourceUrl: 'https://img/1.jpg' }] })
    )
    expect(sameButReordered.some(d => d.field === 'images')).toBe(false)
    const changed = diffProductFields(
      { images: [{ sourceUrl: 'https://img/1.jpg' }] },
      item({ images: [{ imageType: 'MAIN', sourceUrl: 'https://img/2.jpg' }] })
    )
    expect(changed.some(d => d.field === 'images')).toBe(true)
  })

  it('null 与缺省归一化后不误报（weight 均为空）', () => {
    const diffs = diffProductFields({ weight: null, images: [] }, item({ weight: null }))
    expect(diffs.some(d => d.field === 'weight')).toBe(false)
  })

  it('P1-11：币种变化被捕获（货盘改币种此前不产生变更标记，直接影响定价换算）', () => {
    const diffs = diffProductFields({ currency: 'CNY', images: [] }, item({ currency: 'USD' }))
    expect(diffs).toContainEqual({ field: 'currency', oldValue: 'CNY', newValue: 'USD' })
  })

  it('P1-11：原始描述变化被捕获', () => {
    const diffs = diffProductFields({ descriptionOriginal: '旧描述', images: [] }, item({ descriptionOriginal: '新描述' }))
    expect(diffs).toContainEqual({ field: 'descriptionOriginal', oldValue: '旧描述', newValue: '新描述' })
  })

  it('P1-11：源链接变化被捕获', () => {
    const diffs = diffProductFields({ sourceUrl: 'https://gigab2b.com/p/1', images: [] }, item({ sourceUrl: 'https://gigab2b.com/p/9' }))
    expect(diffs.some(d => d.field === 'sourceUrl')).toBe(true)
  })

  it('P1-11：dimensions（Json 列）按 JSON 序列化比对；缺省与 {} 归一化后不产生假 diff', () => {
    // existing 为库默认 {}，incoming 未传 dimensions（undefined）→ 两侧统一 ?? {} 后相等
    expect(diffProductFields({ dimensions: {}, images: [] }, item()).some(d => d.field === 'dimensions')).toBe(false)
    const changed = diffProductFields({ dimensions: { len: 10 }, images: [] }, item({ dimensions: { len: 12 } }))
    expect(changed).toContainEqual({ field: 'dimensions', oldValue: '{"len":10}', newValue: '{"len":12}' })
  })
})

describe('P1-13：唯一约束冲突判定（findFirst→create 竞态重查，不吞成 UNCHANGED）', () => {
  it('P2002 被识别为撞车（触发重查已存在行）', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
    expect(isUniqueViolation(error)).toBe(true)
  })

  it('其它 Prisma 已知错误不算撞车（照常抛出）', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' })
    expect(isUniqueViolation(error)).toBe(false)
  })

  it('普通 Error / null 不算撞车', () => {
    expect(isUniqueViolation(new Error('P2002'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})

describe('ERP 采集入参 schema 校验', () => {
  it('单品默认值填充（currency=CNY，images 默认空数组）', () => {
    const parsed = collectItemSchema.parse({ supplierId: 's1', sourceProductId: 'SP-1' })
    expect(parsed.currency).toBe('CNY')
    expect(parsed.images).toEqual([])
    expect(parsed.sourceUrl).toBe('')
  })

  it('批量 schema：items 至少 1 条，overwrite 可选', () => {
    const parsed = collectBatchSchema.parse({ items: [{ supplierId: 's1', sourceProductId: 'SP-1' }] })
    expect(parsed.items).toHaveLength(1)
    expect(parsed.overwrite).toBeUndefined()
  })

  it('批量 schema：空 items 被拒绝', () => {
    expect(() => collectBatchSchema.parse({ items: [] })).toThrow()
  })

  it('批量 schema：超过 200 条被拒绝（防止单次请求打爆）', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ supplierId: 's1', sourceProductId: `SP-${i}` }))
    expect(() => collectBatchSchema.parse({ items: many })).toThrow()
  })

  it('图片缺 sourceUrl 被拒绝', () => {
    expect(() => collectItemSchema.parse({ supplierId: 's1', sourceProductId: 'SP-1', images: [{ imageType: 'MAIN' }] })).toThrow()
  })
})
