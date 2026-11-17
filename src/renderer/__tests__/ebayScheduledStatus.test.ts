import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scheduleStatus } from '../../shared/ebayScheduledPublish'

/**
 * 状态位口径（2026-11-17 用户拍板）：待自动发布＝待发布中；仅真正到点失败＝发布失败；
 * 真正上架成功＝产品离开本地定时发布、转入线上产品（不在此显示）；禁用且无结果＝不显示。
 * 历史失败残留一次性清除（status-v2 标记）。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')

describe('scheduleStatus 纯函数四态口径', () => {
  it('enabled 无失败＝waiting', () => {
    expect(scheduleStatus({ enabled: true })).toBe('waiting')
  })
  it('有失败留痕＝failed（优先于 waiting）', () => {
    expect(scheduleStatus({ enabled: true, lastFailedAt: '2026-11-17T00:00:00Z' })).toBe('failed')
    expect(scheduleStatus({ enabled: false, lastFailedAt: '2026-11-17T00:00:00Z' })).toBe('failed')
  })
  it('禁用且无失败＝idle（不显示）', () => {
    expect(scheduleStatus({ enabled: false })).toBe('idle')
    expect(scheduleStatus({})).toBe('idle')
  })
})

describe('状态位渲染与成功转环节', () => {
  it('chip 按 scheduleStatus 渲染：失败红/等待待发布中/idle 不显示', () => {
    expect(app).toContain('scheduleStatus(sch)')
    expect(app).toContain('>待发布中</span>')
    expect(app).toContain('ebay-scheduled-wait')
    expect(app).toContain('>发布失败</span>')
  })
  it('CSS 有等待态样式', () => {
    expect(css).toContain('.ebay-scheduled-wait{')
  })
  it('到点上架成功后产品移除本地行并转线上产品（刷新 listings/同步）', () => {
    const seg = app.split('dueScheduledPublish(scheduledPublishRef.current')[1]?.split('},15000)')[0] ?? ''
    expect(seg).toContain('removeLocalProduct(id)')
    expect(seg).toContain('线上产品')
    expect(seg).toContain('window.desktop.ebay.listings(product.storeId)')
  })
  it('历史失败残留一次性清除（status-v2 标记）', () => {
    expect(app).toContain('ebay-sched-status-v2')
  })
})