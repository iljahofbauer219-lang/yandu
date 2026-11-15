import { describe, expect, it } from 'vitest'
import {
  normalizeScheduledPublish, toggleScheduledPublish, dueScheduledPublish, defaultScheduleAt,
  type EbayScheduledPublishMap
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