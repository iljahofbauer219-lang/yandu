import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { customRunIso, zonedDisplay, validateSchedulePlan, normalizeSchedulePlan, DEFAULT_SCHEDULE_PLAN } from '../../shared/ebayScheduledPublish'

/**
 * 自行设置发布时间（2026-11-17）：时间设置弹窗第四选项＝单选（与三批次互斥）＋发布分钟＋
 * 北京时间（now+分钟 Asia/Shanghai）＋当地时间（同刻换算美东）；确认写 once at=now+分钟。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('自行设置 · 纯函数', () => {
  it('customRunIso = now + 分钟（UTC ISO）', () => {
    const now = '2026-11-17T02:00:00.000Z'
    expect(customRunIso(30, now)).toBe('2026-11-17T02:30:00.000Z')
    expect(customRunIso(90, now)).toBe('2026-11-17T03:30:00.000Z')
  })
  it('zonedDisplay 双时区换算同一时刻', () => {
    const iso = '2026-11-17T02:30:00.000Z'
    const bj = zonedDisplay(iso, 'Asia/Shanghai')
    const ny = zonedDisplay(iso, 'America/New_York')
    expect(bj).toContain('10:30')
    expect(ny).toContain('21:30')
    expect(bj).not.toBe(ny)
  })
  it('validate：custom 选中须分钟>0，且忽略批次%合计', () => {
    const base = { rows: DEFAULT_SCHEDULE_PLAN.rows.map(r => ({ ...r, selected: false })) }
    expect(validateSchedulePlan({ ...base, custom: { selected: true, minutes: 0 } })).toBeTruthy()
    expect(validateSchedulePlan({ ...base, custom: { selected: true, minutes: 30 } })).toBeNull()
    expect(validateSchedulePlan({ ...base, custom: { selected: false, minutes: 30 } })).toBeTruthy()
  })
  it('normalize 保留 custom', () => {
    const n = normalizeSchedulePlan({ rows: DEFAULT_SCHEDULE_PLAN.rows, custom: { selected: true, minutes: 45 } })
    expect(n.custom?.selected).toBe(true)
    expect(n.custom?.minutes).toBe(45)
  })
})

describe('自行设置 · 弹窗与确认', () => {
  it('弹窗含自行设置行：单选/发布分钟/北京时间/当地时间四列', () => {
    expect(app).toContain('自行设置')
    expect(app).toContain('发布分钟')
    expect(app).toContain("zonedDisplay(customRunIso(")
    expect(app).toContain('Asia/Shanghai')
    expect(app).toContain('America/New_York')
  })
  it('单选互斥：选 custom 清批次 selected；选批次清 custom', () => {
    expect(app).toContain('custom:{selected:true,minutes:')
    expect(app).toContain('custom:{selected:false,minutes:')
  })
  it('确认 custom 走 once at=customRunIso', () => {
    expect(app).toContain("mode:'once',at:customRunIso(")
  })
})