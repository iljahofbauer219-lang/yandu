/**
 * AI 网关配额单测（plan frosty-wood-gudgeon #5）：
 * - decideQuota 纯函数判定（null=不限 / 0=禁止 / 边界等值放行）
 * - assertQuota 原子预占：受限时必须在锁事务内写入 pending 预占行；
 *   第二次判定必须把第一次的预占计入已用，杜绝旧实现「先查后扣」的并发超卖
 * - recordUsage 落定预占不重复计数；releaseQuota 释放 pending 预占
 * 全程使用内存 fake db，不触库（沿用模块「纯函数单测不触库」约定）。
 */
import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { assertQuota, decideQuota, quotaKindOf, recordUsage, releaseQuota } from '../gateway.js'

interface UsageRow {
  id: string
  orgId: string
  userId: string
  provider: string
  model: string
  purpose: string
  units: number
}

interface FakeQuota {
  imageLimit: number | null
  videoLimit: number | null
  textLimit: number | null
}

function makeFakeDb(quota: FakeQuota | null) {
  const rows: UsageRow[] = []
  let seq = 0
  let lockCalls = 0
  // db 与事务内 tx 共用同一份 aiUsageLog fake（recordUsage/releaseQuota 走 db 顶层）
  const aiUsageLog = {
    aggregate: (args: { where?: { purpose?: { startsWith?: string } } }) => {
      const prefix = args.where?.purpose?.startsWith ?? ''
      const sum = rows.filter(row => row.purpose.startsWith(prefix)).reduce((acc, row) => acc + row.units, 0)
      return Promise.resolve({ _sum: { units: sum } })
    },
    create: (args: { data: Omit<UsageRow, 'id'> }) => {
      const row: UsageRow = { ...args.data, id: `row-${++seq}` }
      rows.push(row)
      return Promise.resolve(row)
    },
    update: (args: { where: { id: string }; data: Partial<UsageRow> }) => {
      const row = rows.find(item => item.id === args.where.id)
      if (!row) return Promise.reject(new Error('row not found'))
      Object.assign(row, args.data)
      return Promise.resolve(row)
    },
    deleteMany: (args: { where: { id?: string; provider?: string } }) => {
      const index = rows.findIndex(row => row.id === args.where.id && (!args.where.provider || row.provider === args.where.provider))
      if (index >= 0) rows.splice(index, 1)
      return Promise.resolve({ count: index >= 0 ? 1 : 0 })
    }
  }
  const tx = {
    // assertQuota 用 $queryRaw`...FOR UPDATE` 锁配额行；fake 只计数以断言确实走了锁事务
    $queryRaw: () => {
      lockCalls += 1
      return Promise.resolve([])
    },
    aiUsageLog
  }
  const db = {
    aiQuota: { findUnique: () => Promise.resolve(quota) },
    aiUsageLog,
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)
  }
  return { db: db as unknown as PrismaClient, rows, getLockCalls: () => lockCalls }
}

describe('decideQuota（纯函数判定）', () => {
  it('limit 为 null / undefined 视为不限，一律放行', () => {
    expect(decideQuota(null, 999, 10)).toBe(true)
    expect(decideQuota(undefined, 999, 10)).toBe(true)
  })

  it('已用 + 本次 <= 上限放行，超过拒绝（边界等值放行）', () => {
    expect(decideQuota(5, 3, 2)).toBe(true)
    expect(decideQuota(5, 3, 3)).toBe(false)
  })

  it('limit=0 表示完全禁止', () => {
    expect(decideQuota(0, 0, 1)).toBe(false)
  })

  it('已用已超限（历史超卖）时任何新请求都拒绝', () => {
    expect(decideQuota(3, 5, 1)).toBe(false)
  })
})

describe('quotaKindOf', () => {
  it('purpose 前缀映射到配额类别', () => {
    expect(quotaKindOf('image.generate')).toBe('image')
    expect(quotaKindOf('video.generate')).toBe('video')
    expect(quotaKindOf('text.translate')).toBe('text')
    expect(quotaKindOf('text.chat')).toBe('text')
  })
})

describe('assertQuota（原子预占）', () => {
  it('无配额记录 → 空预占，且不开锁事务', async () => {
    const { db, getLockCalls, rows } = makeFakeDb(null)
    const reservation = await assertQuota(db, 'org1', 'u1', 'image.generate', 3)
    expect(reservation.id).toBeNull()
    expect(getLockCalls()).toBe(0)
    expect(rows).toHaveLength(0)
  })

  it('limit=null 的类别同样放行且不写预占', async () => {
    const { db, rows } = makeFakeDb({ imageLimit: null, videoLimit: null, textLimit: null })
    const reservation = await assertQuota(db, 'org1', 'u1', 'text.chat', 1)
    expect(reservation.id).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('受限时在锁事务内写入 pending 预占行', async () => {
    const { db, rows, getLockCalls } = makeFakeDb({ imageLimit: 5, videoLimit: null, textLimit: null })
    const reservation = await assertQuota(db, 'org1', 'u1', 'image.generate', 2)
    expect(reservation.id).not.toBeNull()
    expect(getLockCalls()).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider: 'pending', model: 'pending', purpose: 'image.generate', units: 2 })
  })

  it('不得超卖：第二次判定必须计入第一次的预占，超限抛 429 QUOTA_EXCEEDED', async () => {
    const { db, rows } = makeFakeDb({ imageLimit: 4, videoLimit: null, textLimit: null })
    const first = await assertQuota(db, 'org1', 'u1', 'image.generate', 3)
    expect(first.id).not.toBeNull()
    // 并发窗口里第二个请求想再扣 2：3+2 > 4 必须被拒（旧实现查扣分离时这里会双双放行）
    await expect(assertQuota(db, 'org1', 'u1', 'image.generate', 2))
      .rejects.toMatchObject({ name: 'HttpError', statusCode: 429, code: 'QUOTA_EXCEEDED' })
    // 被拒的请求不得留下预占行
    expect(rows).toHaveLength(1)
    // 边界：再预占 1（3+1=4）仍应放行
    const second = await assertQuota(db, 'org1', 'u1', 'image.generate', 1)
    expect(second.id).not.toBeNull()
    expect(rows).toHaveLength(2)
  })

  it('预占只影响同类别配额（video 预占不吃 image 额度）', async () => {
    const { db } = makeFakeDb({ imageLimit: 1, videoLimit: 1, textLimit: null })
    await expect(assertQuota(db, 'org1', 'u1', 'video.generate', 1)).resolves.toMatchObject({ purpose: 'video.generate' })
    await expect(assertQuota(db, 'org1', 'u1', 'image.generate', 1)).resolves.not.toBeNull()
    await expect(assertQuota(db, 'org1', 'u1', 'image.generate', 1))
      .rejects.toMatchObject({ statusCode: 429 })
  })
})

describe('recordUsage / releaseQuota', () => {
  it('带预占时把 pending 行落定为实际消耗，不新增行（不重复计数）', async () => {
    const { db, rows } = makeFakeDb({ imageLimit: 5, videoLimit: null, textLimit: null })
    const reservation = await assertQuota(db, 'org1', 'u1', 'image.generate', 3)
    await recordUsage(db, { orgId: 'org1', userId: 'u1', provider: 'bailian', model: 'm1', purpose: 'image.generate', units: 2 }, reservation)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider: 'bailian', model: 'm1', units: 2 })
  })

  it('无预占（不受限用户）直接追加流水', async () => {
    const { db, rows } = makeFakeDb(null)
    const reservation = await assertQuota(db, 'org1', 'u1', 'text.chat', 1)
    await recordUsage(db, { orgId: 'org1', userId: 'u1', provider: 'deepseek', model: 'm2', purpose: 'text.chat', units: 1 }, reservation)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider: 'deepseek', purpose: 'text.chat' })
  })

  it('releaseQuota 删除 pending 预占行；空预占不抛错', async () => {
    const { db, rows } = makeFakeDb({ imageLimit: 5, videoLimit: null, textLimit: null })
    const reservation = await assertQuota(db, 'org1', 'u1', 'image.generate', 2)
    expect(rows).toHaveLength(1)
    await releaseQuota(db, reservation)
    expect(rows).toHaveLength(0)
    await expect(releaseQuota(db, { id: null, purpose: 'image.generate', units: 1 })).resolves.toBeUndefined()
  })

  it('已落定（provider 非 pending）的行不会被 releaseQuota 误删', async () => {
    const { db, rows } = makeFakeDb({ imageLimit: 5, videoLimit: null, textLimit: null })
    const reservation = await assertQuota(db, 'org1', 'u1', 'image.generate', 2)
    await recordUsage(db, { orgId: 'org1', userId: 'u1', provider: 'bailian', model: 'm1', purpose: 'image.generate', units: 2 }, reservation)
    await releaseQuota(db, reservation)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe('bailian')
  })
})
