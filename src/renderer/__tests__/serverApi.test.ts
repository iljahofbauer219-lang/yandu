import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverHttp = vi.hoisted(() => ({
  getTokens: vi.fn(),
  refreshSession: vi.fn()
}))

vi.mock('../../shared/serverHttp', () => ({
  ApiError: class ApiError extends Error {},
  SESSION_EXPIRED_EVENT: 'sourcing:session-expired',
  apiFetch: vi.fn(),
  clearSession: vi.fn(),
  getCachedProfile: vi.fn(),
  getServerBaseUrl: vi.fn(),
  getStoredServerUrl: vi.fn(),
  getTokens: serverHttp.getTokens,
  refreshSession: serverHttp.refreshSession,
  saveProfile: vi.fn(),
  saveTokens: vi.fn(),
  setServerBaseUrl: vi.fn()
}))

import { runWithSessionRetry } from '../serverApi'

describe('runWithSessionRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverHttp.getTokens.mockReturnValue({
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z'
    })
  })

  it('刷新会话并重试 Electron IPC 包装的独立过期错误码', async () => {
    serverHttp.refreshSession.mockImplementation(async () => {
      serverHttp.getTokens.mockReturnValue({
        accessToken: 'new-token',
        refreshToken: 'new-refresh-token',
        refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z'
      })
      return true
    })
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Error invoking remote method warehouses:download: Error: SERVER_SESSION_EXPIRED'))
      .mockResolvedValueOnce('downloaded')

    await expect(runWithSessionRetry(operation)).resolves.toBe('downloaded')
    expect(serverHttp.refreshSession).toHaveBeenCalledOnce()
    expect(serverHttp.refreshSession).toHaveBeenCalledWith('old-token')
    expect(operation).toHaveBeenNthCalledWith(1, 'old-token')
    expect(operation).toHaveBeenNthCalledWith(2, 'new-token')
  })

  it('不重试仅在业务文案中包含过期码的普通错误', async () => {
    const error = new Error('业务备注包含 SERVER_SESSION_EXPIRED 但并非会话错误')
    const operation = vi.fn().mockRejectedValue(error)

    await expect(runWithSessionRetry(operation)).rejects.toBe(error)
    expect(serverHttp.refreshSession).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledOnce()
  })

  it('刷新失败时返回现有友好文案', async () => {
    serverHttp.refreshSession.mockResolvedValue(false)
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Error invoking remote method warehouses:download: Error: SERVER_SESSION_EXPIRED'))

    await expect(runWithSessionRetry(operation)).rejects.toThrow('登录会话已过期，请重新登录后重试')
    expect(serverHttp.refreshSession).toHaveBeenCalledWith('old-token')
    expect(operation).toHaveBeenCalledOnce()
  })
})
