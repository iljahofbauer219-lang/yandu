import { describe, expect, it } from 'vitest'
import {
  normalizeScheduledPublish, toggleScheduledPublish, dueScheduledPublish, defaultScheduleAt,
  zonedWallClockToUtc, nextDailyRunUtc, schedulePreviewText, applyScheduleConfigToAll,
  normalizeSchedulePlan, validateSchedulePlan, allocateBatches, DEFAULT_SCHEDULE_PLAN, scheduleStatus, nextRunBeijingText,
  type EbayScheduledPublishMap, type EbaySchedulePlan
} from '../ebayScheduledPublish'

describe('本地定时发布 schedule 纯函数', () => {
  it('normalize：非法/空输入归一为空表，合法条目保留 enabled/at', () => {
    expect(normalizeScheduledPublish(null)).toEqual({})
    expect(normalizeScheduledPublish('x')).toEqual({})
    expect(normalizeScheduledPublish({ a: { enabled: true, at: '2026-11-15T10:00' }, b: { enabled: 'yes', at: 3 } }))
      .toEqual({ a: { enabled: true, at: '2026-11-15T10:00' } })
  })
  it('toggle：开启时无 at 补默认（now+1h），关闭保留 at 不清空', () => {
    const now = '2026-11-15T09:00'
    const on = toggleScheduledPublish({}, 'p1', true, '', now)
    expect(on.p1.enabled).toBe(true)
    expect(on.p1.at).toBe(defaultScheduleAt(now))
    const off = toggleScheduledPublish(on, 'p1', false, '', now)
    expect(off.p1.enabled).toBe(false)
    expect(off.p1.at).toBe(on.p1.at)
  })
  it('toggle 不抹固定时间配置：开关前后 mode/tz/start/end 保留', () => {
    const map: EbayScheduledPublishMap = { p1: { enabled: false, at: 'x', mode: 'daily', tz: 'America/New_York', start: '19:00', end: '21:00' } }
    const on = toggleScheduledPublish(map, 'p1', true, '', '2026-11-16T09:00')
    expect(on.p1.mode).toBe('daily')
    expect(on.p1.tz).toBe('America/New_York')
    expect(on.p1.start).toBe('19:00')
    const off = toggleScheduledPublish(on, 'p1', false, '', '2026-11-16T09:00')
    expect(off.p1.mode).toBe('daily')
    expect(off.p1.end).toBe('21:00')
  })
  it('due：仅 enabled 且 at<=now 的 id 到期；未来/关闭不返回', () => {
    const map: EbayScheduledPublishMap = {
      past: { enabled: true, at: '2026-11-15T08:00' },
      future: { enabled: true, at: '2026-11-15T12:00' },
      off: { enabled: false, at: '2026-11-15T08:00' },
      noat: { enabled: true, at: '' }
    }
    expect(dueScheduledPublish(map, '2026-11-15T09:00')).toEqual(['past'])
  })
  it('defaultScheduleAt：now+1h 的 datetime-local 值（YYYY-MM-DDTHH:mm）', () => {
    expect(defaultScheduleAt('2026-11-15T09:00')).toBe('2026-11-15T10:00')
  })
})

describe('固定时间模式 · IANA 换算与每日调度', () => {
  it('墙钟→UTC：冬令时美东 19:00 = UTC 次日 00:00，夏令时 = UTC 当日 23:00（不写死小时差）', () => {
    expect(zonedWallClockToUtc('America/New_York', 2026, 11, 15, 19, 0)).toBe(Date.UTC(2026, 10, 16, 0, 0))
    expect(zonedWallClockToUtc('America/New_York', 2026, 7, 15, 19, 0)).toBe(Date.UTC(2026, 6, 15, 23, 0))
  })
  it('预览行只以美国作息为准：冬/夏北京自动 ±1h，格式恰为「美东 19:00–21:00 → 北京 次日 08:00–10:00」', () => {
    expect(schedulePreviewText('America/New_York', '19:00', '21:00', '2026-11-16T12:00:00+08:00'))
      .toBe('美东 19:00–21:00 → 北京 次日 08:00–10:00')
    expect(schedulePreviewText('America/New_York', '19:00', '21:00', '2026-07-15T12:00:00+08:00'))
      .toBe('美东 19:00–21:00 → 北京 次日 07:00–09:00')
  })
  it('跨 midnight 窗口：北京终点标次日（美东上午批 22:30–次日 00:30）', () => {
    expect(schedulePreviewText('America/New_York', '09:30', '11:30', '2026-11-16T12:00:00+08:00'))
      .toBe('美东 09:30–11:30 → 北京 22:30–次日 00:30')
  })
  it('nextDailyRun：今日窗口起点已过则取明日同一墙钟', () => {
    expect(nextDailyRunUtc('America/New_York', '19:00', '2026-11-16T09:00:00+08:00')).toBe(Date.UTC(2026, 10, 17, 0, 0))
    expect(nextDailyRunUtc('America/New_York', '19:00', '2026-11-16T07:00:00+08:00')).toBe(Date.UTC(2026, 10, 16, 0, 0))
  })
  it('due：daily 到点且当日未跑才到期；跑过当日不重复；过窗跳过等次日', () => {
    const daily = { enabled: true, at: '', mode: 'daily' as const, tz: 'America/New_York', start: '19:00', end: '21:00' }
    const map: EbayScheduledPublishMap = { d: daily }
    expect(dueScheduledPublish(map, '2026-11-16T09:00:00+08:00')).toEqual(['d'])
    expect(dueScheduledPublish({ d: { ...daily, lastRunAt: '2026-11-16T09:00:00+08:00' } }, '2026-11-16T09:30:00+08:00')).toEqual([])
    expect(dueScheduledPublish(map, '2026-11-16T11:30:00+08:00')).toEqual([])
    expect(dueScheduledPublish(map, '2026-11-16T07:00:00+08:00')).toEqual([])
  })
  it('全店统一写回：保留各商品 enabled，daily 清 lastRunAt，once 补 at', () => {
    const map: EbayScheduledPublishMap = { a: { enabled: true, at: '2026-11-15T10:00' }, b: { enabled: false, at: '' } }
    const daily = applyScheduleConfigToAll(map, ['a', 'b'], { mode: 'daily', tz: 'America/New_York', start: '19:00', end: '21:00' }, '2026-11-16T09:00')
    expect(daily.a.enabled).toBe(true)
    expect(daily.b.enabled).toBe(false)
    expect(daily.a.mode).toBe('daily')
    expect(daily.b.tz).toBe('America/New_York')
    expect(daily.a.lastRunAt).toBe('')
    const once = applyScheduleConfigToAll(map, ['a', 'b'], { mode: 'once', at: '2026-11-17T08:00' }, '2026-11-16T09:00')
    expect(once.a.at).toBe('2026-11-17T08:00')
    expect(once.b.at).toBe('2026-11-17T08:00')
    expect(once.b.mode).toBe('once')
  })
  it('normalize：v1 旧记录兼容，v2 的 mode/tz/start/end/lastRunAt 合法才保留', () => {
    expect(normalizeScheduledPublish({ a: { enabled: true, at: 'x', mode: 'daily', tz: 'America/New_York', start: '19:00', end: '21:00', lastRunAt: 'y' }, b: { enabled: true, at: 'x', mode: 'bogus', tz: 3 } }))
      .toEqual({ a: { enabled: true, at: 'x', mode: 'daily', tz: 'America/New_York', start: '19:00', end: '21:00', lastRunAt: 'y' }, b: { enabled: true, at: 'x' } })
  })
})

describe('三行批次计划 · 校验/比例分配/按行 due', () => {
  it('normalize：空/非法归一默认三行 60/10/30 全选；非法 tz 丢弃、比例夹取整', () => {
    expect(normalizeSchedulePlan(null)).toEqual(DEFAULT_SCHEDULE_PLAN)
    const p = normalizeSchedulePlan({ rows: [{ tz: 'America/New_York', start: '19:00', end: '21:00', ratio: 60.4, selected: true }, { tz: 'Mars/Olympus', ratio: 50, selected: true }] })
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0].ratio).toBe(60)
  })
  it('validate：默认通过；取消一行比例和≠100 中文点名；全不选点名；窗口不完整点名', () => {
    expect(validateSchedulePlan(DEFAULT_SCHEDULE_PLAN)).toBeNull()
    const off: EbaySchedulePlan = { rows: DEFAULT_SCHEDULE_PLAN.rows.map((r, i) => i === 1 ? { ...r, selected: false } : { ...r }) }
    expect(validateSchedulePlan(off)).toContain('90')
    expect(validateSchedulePlan({ rows: DEFAULT_SCHEDULE_PLAN.rows.map(r => ({ ...r, selected: false })) })).toContain('至少选取')
    expect(validateSchedulePlan({ rows: DEFAULT_SCHEDULE_PLAN.rows.map((r, i) => i === 0 ? { ...r, start: '' } : { ...r }) })).toContain('当地时间')
  })
  it('allocate：10 个 ids 按 60/10/30 分 6/1/3，同日稳定；1 个 id 归最大余数行（美东）', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const alloc = allocateBatches(ids, DEFAULT_SCHEDULE_PLAN, '2026-11-16')
    const count = (tz: string) => Object.values(alloc).filter(r => r.tz === tz).length
    expect(count('America/New_York')).toBe(6)
    expect(count('America/Chicago')).toBe(1)
    expect(count('America/Los_Angeles')).toBe(3)
    expect(allocateBatches(ids, DEFAULT_SCHEDULE_PLAN, '2026-11-16')).toEqual(alloc)
    expect(allocateBatches(['solo'], DEFAULT_SCHEDULE_PLAN, '2026-11-16').solo.tz).toBe('America/New_York')
  })
  it('scheduleStatus：失败优先于跳过；跳过优先于等待；清跳过留痕回等待', () => {
    expect(scheduleStatus({ enabled: true, lastSkippedAt: 'x' })).toBe('skipped')
    expect(scheduleStatus({ enabled: true, lastSkippedAt: 'x', lastFailedAt: 'y' })).toBe('failed')
    expect(scheduleStatus({ enabled: true, lastSkippedAt: '' })).toBe('waiting')
    expect(scheduleStatus({ enabled: false })).toBe('idle')
  })
  it('nextRunBeijingText：daily 冬/夏按窗口起点换算北京日/时/分；once 按 at；非法 at 空串', () => {
    // 北京 11-16 09:00 → 美东 11-15 20:00，今日窗口起点已过 → 下一次 11-16 19:00 EST = 北京 11-17 08:00
    expect(nextRunBeijingText({ mode: 'daily', tz: 'America/New_York', start: '19:00' }, '2026-11-16T09:00:00+08:00')).toBe('17日 08:00')
    // 夏令时：北京 07-15 09:00 → 美东 07-14 21:00 已过 → 下一次 07-15 19:00 EDT = 北京 07-16 07:00
    expect(nextRunBeijingText({ mode: 'daily', tz: 'America/New_York', start: '19:00' }, '2026-07-15T09:00:00+08:00')).toBe('16日 07:00')
    // 窗口起点未到：北京 11-16 07:00 → 美东 11-15 18:00，下一次 11-15 19:00 EST = 北京 11-16 08:00（同日）
    expect(nextRunBeijingText({ mode: 'daily', tz: 'America/New_York', start: '19:00' }, '2026-11-16T07:00:00+08:00')).toBe('16日 08:00')
    expect(nextRunBeijingText({ mode: 'once', at: '2026-11-17T08:30' }, '2026-11-16T09:00:00+08:00')).toBe('17日 08:30')
    expect(nextRunBeijingText({ mode: 'once', at: '' }, '2026-11-16T09:00:00+08:00')).toBe('')
  })
  it('due 接计划：按分配行窗口到点判定；未到的行不触发；当日跑过不重复', () => {
    const map: EbayScheduledPublishMap = {
      a: { enabled: true, at: '', mode: 'daily' },
      b: { enabled: true, at: '', mode: 'daily' },
    }
    // 2 ids 按 60/10/30 最大余数 → a=美东、b=美西
    // 北京 09:00 = 美东前一日 20:00（窗内）/ 美西 17:00（未到 18:00）→ 仅 a
    expect(dueScheduledPublish(map, '2026-11-16T09:00:00+08:00', DEFAULT_SCHEDULE_PLAN)).toEqual(['a'])
    // 北京 11:00 = 美东 22:00（过窗跳过）/ 美西 19:00（窗内）→ 仅 b
    expect(dueScheduledPublish(map, '2026-11-16T11:00:00+08:00', DEFAULT_SCHEDULE_PLAN)).toEqual(['b'])
    // 北京 07:00 = 美东 18:00，窗口 19:00 起点未到 → 不触发
    expect(dueScheduledPublish(map, '2026-11-16T07:00:00+08:00', DEFAULT_SCHEDULE_PLAN)).toEqual([])
    const ran: EbayScheduledPublishMap = { a: { ...map.a, lastRunAt: '2026-11-16T09:00:00+08:00' }, b: map.b }
    expect(dueScheduledPublish(ran, '2026-11-16T09:30:00+08:00', DEFAULT_SCHEDULE_PLAN)).toEqual([])
  })
})