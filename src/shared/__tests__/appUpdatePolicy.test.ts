import { describe, expect, it } from 'vitest'
import { UPDATE_POLL_INTERVAL_MS, UPDATE_RETRY_DELAY_MS } from '../appUpdatePolicy'

describe('自动更新轮询节奏', () => {
  it('常驻轮询 30 分钟：同事半小时内能发现新版，不再等 4 小时', () => {
    expect(UPDATE_POLL_INTERVAL_MS).toBe(30 * 60 * 1000)
  })

  it('启动检查失败后的补查仍是 5 分钟', () => {
    expect(UPDATE_RETRY_DELAY_MS).toBe(5 * 60 * 1000)
  })
})