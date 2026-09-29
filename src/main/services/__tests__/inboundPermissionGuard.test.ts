import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearInboundPermissionCache, requireInboundEditPermission } from '../InboundPermissionGuard'

vi.mock('../../serverConfig', () => ({ readServerUrl: () => 'https://mock.invalid' }))

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => { clearInboundPermissionCache(); vi.unstubAllGlobals() })

describe('入库写操作权限强校验', () => {
  it('canEdit=true 放行', async () => {
    mockFetchOnce(200, { canEdit: true })
    await expect(requireInboundEditPermission('tok')).resolves.toBeUndefined()
  })

  it('canEdit=false 抛语义化无权限错误', async () => {
    mockFetchOnce(200, { canEdit: false })
    await expect(requireInboundEditPermission('tok')).rejects.toThrow('无入库处理权限（需 erp.warehouse.edit）')
  })

  it('401 抛 SERVER_SESSION_EXPIRED', async () => {
    mockFetchOnce(401, {})
    await expect(requireInboundEditPermission('tok')).rejects.toThrow('SERVER_SESSION_EXPIRED')
  })

  it('网络不可达 fail closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(requireInboundEditPermission('tok')).rejects.toThrow('权限校验失败，请检查网络后重试')
  })

  it('60s 缓存：连续两次只请求一次', async () => {
    const fetchMock = mockFetchOnce(200, { canEdit: true })
    await requireInboundEditPermission('tok')
    await requireInboundEditPermission('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('缺 token 直接拒绝', async () => {
    await expect(requireInboundEditPermission('')).rejects.toThrow('登录状态缺失，请重新登录后重试')
  })
})
