import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../serverHttp'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) }
}
vi.stubGlobal('localStorage', localStorageStub)
store.set('sourcing.server-url:v1', 'https://mock.invalid')
const TOKENS = { accessToken: 'old', refreshToken: 'rt', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }
const NEW_TOKENS = { accessToken: 'new', refreshToken: 'rt2', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageStub)
  store.clear()
  store.set('sourcing.server-url:v1', 'https://mock.invalid')
})

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch 401 刷新重放（超时改造回归）', () => {
  it('401 → 刷新成功 → 重放一次并返回结果', async () => {
    store.set('sourcing.auth.tokens:v1', JSON.stringify(TOKENS))
    let apiCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/refresh')) return json(200, { tokens: NEW_TOKENS })
      apiCalls += 1
      if (apiCalls === 1) {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer old')
        return json(401, { error: 'SESSION', message: '过期' })
      }
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer new')
      return json(200, { v: 2 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch<{ v: number }>('/api/x')).resolves.toEqual({ v: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3) // 首次 401 + refresh + 重放
  })

  it('刷新失败抛 SESSION_EXPIRED 语义错误', async () => {
    store.set('sourcing.auth.tokens:v1', JSON.stringify(TOKENS))
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/refresh')) return json(403, {})
      return json(401, { error: 'SESSION', message: '过期' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/x')).rejects.toSatisfy((reason: unknown) => reason instanceof ApiError && reason.code === 'SESSION_EXPIRED')
  })
})
