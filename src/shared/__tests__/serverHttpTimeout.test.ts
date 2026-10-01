import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../serverHttp'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) }
})
store.set('sourcing.server-url:v1', 'https://mock.invalid')

function hangFetch() {
  // 模拟半死服务器：TCP 已连接但永不响应；尊重 AbortSignal 才贴近真实 fetch 语义
  const impl = vi.fn((url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) return
    const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort)
  }))
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch 超时兜底', () => {
  it('服务器挂死 15s 内抛 SERVER_UNREACHABLE 语义错误', async () => {
    hangFetch()
    const started = Date.now()
    await expect(apiFetch('/api/auth/login', { body: { a: 1 }, auth: false })).rejects.toMatchObject({
      code: 'SERVER_UNREACHABLE',
      message: '服务器无响应，请检查网络或稍后重试'
    })
    expect(Date.now() - started).toBeLessThan(16_000)
  }, 20_000)

  it('正常响应原样返回 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ v: 1 }) })))
    await expect(apiFetch<{ v: number }>('/api/x', { auth: false })).resolves.toEqual({ v: 1 })
  })

  it('业务错误透传 ApiError 状态与消息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'BAD', message: '参数不对' }) })))
    await expect(apiFetch('/api/x', { auth: false })).rejects.toSatisfy((reason: unknown) => reason instanceof ApiError && reason.status === 400 && reason.message === '参数不对')
  })
})
