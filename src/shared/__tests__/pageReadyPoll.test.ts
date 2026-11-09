import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pollUntil } from '../pageReadyPoll'

const workspaceSource = readFileSync(new URL('../../main/browser/BrowserWorkspace.ts', import.meta.url), 'utf8')

describe('pollUntil（用就绪判定替代固定盲等，上界不变）', () => {
  it('页面已就绪时立刻返回，不再白等一个间隔', async () => {
    const started = Date.now()
    const result = await pollUntil(async () => true, { intervalMs: 500, timeoutMs: 4000 })
    expect(result).toMatchObject({ ready: true, polls: 1 })
    expect(Date.now() - started).toBeLessThan(200)
  })

  it('第 N 次判定才成立时按次返回，ready 为真', async () => {
    let probes = 0
    const result = await pollUntil(async () => (probes += 1) >= 3, { intervalMs: 5, timeoutMs: 1000 })
    expect(result.ready).toBe(true)
    expect(result.polls).toBe(3)
  })

  it('始终不成立则到上界收工：不早退、也不无限等', async () => {
    const started = Date.now()
    const result = await pollUntil(async () => false, { intervalMs: 8, timeoutMs: 60 })
    const elapsed = Date.now() - started
    expect(result.ready).toBe(false)
    expect(elapsed).toBeGreaterThanOrEqual(60)
    expect(elapsed).toBeLessThan(60 + 40)
  })

  it('判定脚本抛错只算「这次没就绪」，不把固定盲等原本不会有的失败抛给业务', async () => {
    let probes = 0
    const result = await pollUntil(async () => {
      probes += 1
      if (probes === 1) throw new Error('ERR_ABORTED')
      return probes >= 2
    }, { intervalMs: 5, timeoutMs: 1000 })
    expect(result.ready).toBe(true)
    expect(result.polls).toBe(2)
    expect(result.lastError).toBe('ERR_ABORTED')
  })

  it('上界内一直抛错则收工，ready=false 并带最后一次原因', async () => {
    const result = await pollUntil(async () => { throw new Error('页面被导航打断') }, { intervalMs: 8, timeoutMs: 40 })
    expect(result.ready).toBe(false)
    expect(result.lastError).toContain('页面被导航打断')
  })

  it('stableHits 要求连续成立才算就绪，防在 DOM 刷新中途取数', async () => {
    let probes = 0
    const result = await pollUntil(async () => (probes += 1) >= 3, { intervalMs: 5, timeoutMs: 1000, stableHits: 2 })
    expect(result).toMatchObject({ ready: true, polls: 4 })
  })

  it('单点成立随后回落不算就绪，且仍在上界收工', async () => {
    let probes = 0
    const result = await pollUntil(async () => probes++ === 1, { intervalMs: 5, timeoutMs: 60, stableHits: 2 })
    expect(result.ready).toBe(false)
  })
})

describe('BrowserWorkspace 轮询接线（上界=被替换掉的盲等时长，改动需显式批准）', () => {
  it('视频主读的上界仍是 4000ms', () => {
    expect(workspaceSource).toContain('timeoutMs: 4000, stableHits: 2')
  })

  it('视频弹窗读的上界仍是 1500ms', () => {
    expect(workspaceSource).toContain('timeoutMs: 1500, stableHits: 2')
  })

  it('主进程只有这两处轮询调用，新增必须连同上界一起在此登记', () => {
    expect(workspaceSource.split('pollUntil(').length - 1).toBe(2)
  })

  it('被替换掉的两处固定盲等不得复活', () => {
    expect(workspaceSource).not.toMatch(/await this\.sleep\(4000\)/)
    expect(workspaceSource).not.toMatch(/await this\.sleep\(1500\)\n\s*const popupVideos/)
  })

  it('每个 pollUntil 调用都写死上界，不接变量', () => {
    const calls = workspaceSource.split('pollUntil(').slice(1)
    expect(calls.length).toBeGreaterThan(0)
    calls.forEach(argument => expect(argument.slice(0, 1200)).toMatch(/timeoutMs: \d/))
  })
})
