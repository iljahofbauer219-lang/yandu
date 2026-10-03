/**
 * routes 入参 schema 单测（P1-9：status 查询/写入 enum 校验）：
 *   - 产品列表查询 status：仅 ERP 状态机五态，任意状态串被拒（ZodError → 全局 400）
 *   - 下载任务查询 status：仅 PENDING/RUNNING/DONE/PARTIAL/FAILED
 *   - PUT /listings/:id 的 status：仅 listing 生命周期 DRAFT/READY/PUBLISHED
 * 路由挂载/门控（P1-8 权限边界）由 verify-erp-p0..p5 e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { productQuerySchema, downloadJobQuerySchema, listingUpdateSchema } from '../routes.js'

describe('productQuerySchema.status（P1-9）', () => {
  it('合法状态机值通过', () => {
    for (const status of ['COLLECTED', 'DOWNLOADED', 'PROCESSING', 'READY', 'PUBLISHED']) {
      expect(productQuerySchema.parse({ status }).status).toBe(status)
    }
  })

  it('任意状态串被拒（此前直写 where.status 可绕过状态机）', () => {
    expect(() => productQuerySchema.parse({ status: 'HACKED' })).toThrow()
    expect(() => productQuerySchema.parse({ status: 'published' })).toThrow()
  })

  it('status 可缺省（列表默认不过滤）', () => {
    expect(productQuerySchema.parse({}).status).toBeUndefined()
  })
})

describe('downloadJobQuerySchema.status（P1-9）', () => {
  it('合法任务状态通过', () => {
    for (const status of ['PENDING', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED']) {
      expect(downloadJobQuerySchema.parse({ status }).status).toBe(status)
    }
  })

  it('非法状态串被拒', () => {
    expect(() => downloadJobQuerySchema.parse({ status: 'WHATEVER' })).toThrow()
  })
})

describe('listingUpdateSchema（P1-9 / P1-8）', () => {
  it('status 仅接受 listing 生命周期枚举', () => {
    for (const status of ['DRAFT', 'READY', 'PUBLISHED']) {
      expect(listingUpdateSchema.parse({ status }).status).toBe(status)
    }
    expect(() => listingUpdateSchema.parse({ status: 'COLLECTED' })).toThrow()
    expect(() => listingUpdateSchema.parse({ status: 'x' })).toThrow()
  })

  it('price 走 coerce：数字串可解析（改价权限门控在路由层另行校验）', () => {
    expect(listingUpdateSchema.parse({ price: '19.99' }).price).toBe(19.99)
    expect(() => listingUpdateSchema.parse({ price: -1 })).toThrow()
  })

  it('全字段可缺省（空 patch 合法，交由业务层 no-op）', () => {
    expect(listingUpdateSchema.parse({})).toEqual({})
  })
})
