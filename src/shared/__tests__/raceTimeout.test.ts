import { describe, expect, it } from 'vitest'
import { raceTimeout } from '../raceTimeout'

describe('raceTimeout', () => {
  it('操作先完成返回结果', async () => {
    await expect(raceTimeout(Promise.resolve('ok'), 50, 'timeout')).resolves.toBe('ok')
  })

  it('操作挂死时按超时拒绝', async () => {
    const never = new Promise<string>(() => undefined)
    await expect(raceTimeout(never, 30, 'SESSION_RESTORE_TIMEOUT')).rejects.toThrow('SESSION_RESTORE_TIMEOUT')
  })

  it('操作失败时透传原错误', async () => {
    await expect(raceTimeout(Promise.reject(new Error('boom')), 50, 'timeout')).rejects.toThrow('boom')
  })
})
