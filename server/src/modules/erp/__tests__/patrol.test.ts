/**
 * patrol 纯函数单测（P5 / M6）：
 *   - diffPatrolPayload：只对 payload 中「出现的字段」比对，避免缺字段假 diff；改价/改库存命中；
 *     P1-11 新增 currency/descriptionOriginal/dimensions/sourceUrl 字段命中
 *   - planApplyFields：P1-10 APPLY 解析失败字段跳过（skipped）而非静默写 null；空串仍视为源端清空
 *   - planPatrolBatches：10 万品分批数学（batchCount / maxInFlight）
 *   - chunk：按 batchSize 切块，末块不足保留
 *   - runPool：峰值并发 ≤ concurrency（并发配置生效）+ 相邻启动间隔 ≥ delayMs（节流防风控）
 * 触库路径（patrolProduct / runPatrolBatch 双通道 / listChanges / resolveChange）由 verify-erp-p5.ts e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { diffPatrolPayload, planApplyFields, planPatrolBatches, chunk, runPool, PATROL_FIELDS } from '../patrol.js'

describe('diffPatrolPayload', () => {
  it('只比对 payload 中出现的字段（缺字段不产生假 diff）', () => {
    const existing = { costPrice: 20, stockQuantity: 100, titleOriginal: 'A' }
    // payload 只回传 costPrice，未出现的 stockQuantity/titleOriginal 不参与比对
    const diffs = diffPatrolPayload(existing, { costPrice: 20 })
    expect(diffs).toEqual([])
  })

  it('改价命中：costPrice 20→18 产生一条 diff', () => {
    const diffs = diffPatrolPayload({ costPrice: 20 }, { costPrice: 18 })
    expect(diffs).toEqual([{ field: 'costPrice', oldValue: '20', newValue: '18' }])
  })

  it('改库存命中：stockQuantity 100→0 产生一条 diff', () => {
    const diffs = diffPatrolPayload({ stockQuantity: 100 }, { stockQuantity: 0 })
    expect(diffs).toEqual([{ field: 'stockQuantity', oldValue: '100', newValue: '0' }])
  })

  it('多字段同时变更：返回按 PATROL_FIELDS 顺序的多条 diff', () => {
    const diffs = diffPatrolPayload(
      { costPrice: 20, stockQuantity: 100 },
      { costPrice: 22, stockQuantity: 50 }
    )
    expect(diffs.map(d => d.field).sort()).toEqual(['costPrice', 'stockQuantity'])
  })

  it('null 归一化为空串后再比对（20→null 视为变更）', () => {
    const diffs = diffPatrolPayload({ costPrice: 20 }, { costPrice: null })
    expect(diffs).toEqual([{ field: 'costPrice', oldValue: '20', newValue: '' }])
  })

  it('P1-11：PATROL_FIELDS 覆盖 currency/descriptionOriginal/dimensions/sourceUrl', () => {
    for (const field of ['currency', 'descriptionOriginal', 'dimensions', 'sourceUrl']) {
      expect(PATROL_FIELDS).toContain(field)
    }
  })

  it('P1-11：货盘改币种产生变更标记（此前静默漏检，直接影响定价换算）', () => {
    const diffs = diffPatrolPayload({ currency: 'CNY' }, { currency: 'USD' })
    expect(diffs).toEqual([{ field: 'currency', oldValue: 'CNY', newValue: 'USD' }])
  })

  it('P1-11：dimensions（Json 列）按 JSON 序列化比对，内容一致不产生假 diff', () => {
    expect(diffPatrolPayload({ dimensions: { len: 10 } }, { dimensions: { len: 10 } })).toEqual([])
    const diffs = diffPatrolPayload({ dimensions: { len: 10 } }, { dimensions: { len: 12 } })
    expect(diffs).toEqual([{ field: 'dimensions', oldValue: '{"len":10}', newValue: '{"len":12}' }])
  })
})

describe('planApplyFields（P1-10：APPLY 解析失败不得静默写 null）', () => {
  it('数值字段合法值解析写入（costPrice 字符串→数值）', () => {
    const plan = planApplyFields([{ fieldChanged: 'costPrice', newValue: '18' }])
    expect(plan.data.costPrice).toBe(18)
    expect(plan.applied).toEqual(['costPrice'])
    expect(plan.skipped).toEqual([])
  })

  it('数值字段解析失败（非数值串）→ 跳过并计入 skipped，绝不写 null 清空成本价', () => {
    const plan = planApplyFields([{ fieldChanged: 'costPrice', newValue: 'abc' }])
    expect(plan.data).toEqual({})
    expect(plan.applied).toEqual([])
    expect(plan.skipped).toEqual(['costPrice'])
  })

  it('数值字段空串视为源端清空 → 写 null 属合法语义（不算 skipped）', () => {
    const plan = planApplyFields([{ fieldChanged: 'weight', newValue: '' }])
    expect(plan.data.weight).toBeNull()
    expect(plan.applied).toEqual(['weight'])
    expect(plan.skipped).toEqual([])
  })

  it('整数字段四舍五入；解析失败同样跳过', () => {
    expect(planApplyFields([{ fieldChanged: 'stockQuantity', newValue: '10.4' }]).data.stockQuantity).toBe(10)
    const bad = planApplyFields([{ fieldChanged: 'stockQuantity', newValue: '无货' }])
    expect(bad.skipped).toEqual(['stockQuantity'])
    expect(bad.data).toEqual({})
  })

  it('dimensions：合法 JSON 串解析回对象；非法 JSON 跳过', () => {
    const ok = planApplyFields([{ fieldChanged: 'dimensions', newValue: '{"len":12}' }])
    expect(ok.data.dimensions).toEqual({ len: 12 })
    expect(ok.applied).toEqual(['dimensions'])
    const bad = planApplyFields([{ fieldChanged: 'dimensions', newValue: '{len:12' }])
    expect(bad.skipped).toEqual(['dimensions'])
  })

  it('同字段取最新一条（入参 createdAt desc）；未知字段忽略不写', () => {
    const plan = planApplyFields([
      { fieldChanged: 'costPrice', newValue: '18' },
      { fieldChanged: 'costPrice', newValue: '15' },
      { fieldChanged: 'notAField', newValue: 'x' }
    ])
    expect(plan.data.costPrice).toBe(18)
    expect('notAField' in plan.data).toBe(false)
    expect(plan.applied).toEqual(['costPrice'])
  })

  it('新增字符串字段（currency/sourceUrl/descriptionOriginal）原样写入', () => {
    const plan = planApplyFields([
      { fieldChanged: 'currency', newValue: 'USD' },
      { fieldChanged: 'sourceUrl', newValue: 'https://1688.com/p/1' },
      { fieldChanged: 'descriptionOriginal', newValue: '新描述' }
    ])
    expect(plan.data).toEqual({ currency: 'USD', sourceUrl: 'https://1688.com/p/1', descriptionOriginal: '新描述' })
    expect(plan.skipped).toEqual([])
  })
})

describe('planPatrolBatches', () => {
  it('10 万品分批：batchSize=200 → 500 批，maxInFlight=并发上限', () => {
    const plan = planPatrolBatches(100000, 200, 3)
    expect(plan.batchCount).toBe(500)
    expect(plan.maxInFlight).toBe(3)
    expect(plan.total).toBe(100000)
  })

  it('总数不足一批：batchCount=1，maxInFlight=min(concurrency,total)', () => {
    const plan = planPatrolBatches(2, 200, 5)
    expect(plan.batchCount).toBe(1)
    expect(plan.maxInFlight).toBe(2)
  })

  it('非法 batchSize/concurrency（<1）被夹到 1', () => {
    const plan = planPatrolBatches(10, 0, 0)
    expect(plan.batchSize).toBe(1)
    expect(plan.concurrency).toBe(1)
    expect(plan.batchCount).toBe(10)
  })

  it('非整批向上取整：total=1001,size=200 → 6 批', () => {
    expect(planPatrolBatches(1001, 200, 3).batchCount).toBe(6)
  })
})

describe('chunk', () => {
  it('整除切块', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('末块不足保留剩余元素', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('空数组返回空', () => {
    expect(chunk([], 3)).toEqual([])
  })
})

describe('runPool', () => {
  it('峰值并发不超过 concurrency（并发上限生效）', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const stats = await runPool(items, 3, 0, async () => {
      await new Promise(r => setTimeout(r, 5))
    })
    expect(stats.processed).toBe(20)
    expect(stats.peakConcurrency).toBeLessThanOrEqual(3)
    expect(stats.peakConcurrency).toBeGreaterThan(1)
  })

  it('concurrency=1 时严格串行（峰值并发=1）', async () => {
    const items = Array.from({ length: 5 }, (_, i) => i)
    const stats = await runPool(items, 1, 0, async () => {
      await new Promise(r => setTimeout(r, 2))
    })
    expect(stats.peakConcurrency).toBe(1)
    expect(stats.processed).toBe(5)
  })

  it('节流：delayMs>0 时相邻启动间隔 ≥ delayMs（防风控）', async () => {
    const items = Array.from({ length: 4 }, (_, i) => i)
    const delayMs = 30
    const stats = await runPool(items, 1, delayMs, async () => { /* no-op */ })
    // 串行 + 每请求前 sleep(delayMs)，相邻启动间隔应 ≥ delayMs（留 5ms 计时器抖动容差）
    expect(stats.gapsMs.length).toBe(3)
    for (const gap of stats.gapsMs) {
      expect(gap).toBeGreaterThanOrEqual(delayMs - 5)
    }
  })

  it('worker 抛错不中断整池（processed 仍计满）', async () => {
    const items = Array.from({ length: 6 }, (_, i) => i)
    const stats = await runPool(items, 2, 0, async item => {
      if (item % 2 === 0) throw new Error('boom')
    })
    expect(stats.processed).toBe(6)
  })
})
