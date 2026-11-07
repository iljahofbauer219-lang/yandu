/**
 * 「生成即转存」：大模型出的图必须在出图当刻落自有服务器，渲染端只可能持有 /ai-assets/ 永久地址。
 * 语义与既有转存一致——任何失败都不抛出、保留原地址，但必须回中文原因，绝不静默留着会过期的厂商签名地址。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/yandu-ai-rehost-test' } }))

import { permanentizeGeneratedMediaUrls } from '../AiAssetRehostService'

const SERVER = 'http://114.55.149.192'
const PROVIDER_URLS = [
  'https://dashscope-result.oss-cn-beijing.aliyuncs.com/a.jpg?Expires=1700000000&OSSAccessKeyId=LTAI5tFake',
  'https://dashscope-result.oss-cn-beijing.aliyuncs.com/b.jpg?Expires=1700000000&OSSAccessKeyId=LTAI5tFake'
]

function stubFetch(stub: { status: number; json?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith(SERVER)) {
      return new Response(JSON.stringify(stub.json ?? { error: 'boom' }), {
        status: stub.status,
        headers: { 'content-type': 'application/json' }
      })
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0x01, 0x02]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('permanentizeGeneratedMediaUrls', () => {
  it('厂商临时地址逐张换成服务器 /ai-assets/ 永久地址，顺序一一对应', async () => {
    const { calls } = stubFetch({ status: 200, json: { items: [{ url: '/ai-assets/id1/01.jpg' }, { url: '/ai-assets/id1/02.jpg' }] } })
    const result = await permanentizeGeneratedMediaUrls({ serverUrl: SERVER, accessToken: 'token', urls: PROVIDER_URLS })
    expect(result.urls).toEqual([`${SERVER}/ai-assets/id1/01.jpg`, `${SERVER}/ai-assets/id1/02.jpg`])
    expect(result.warnings).toEqual([])
    const upload = calls.find(call => call.url === `${SERVER}/api/ai-assets`)
    expect(upload?.init?.method).toBe('POST')
    expect(JSON.stringify(upload?.init?.headers)).toContain('Bearer token')
  })

  it('未登录服务器时不换址，并明确告知是临时地址', async () => {
    const { fetchMock } = stubFetch({ status: 200, json: { items: [] } })
    const result = await permanentizeGeneratedMediaUrls({ serverUrl: SERVER, accessToken: '', urls: PROVIDER_URLS })
    expect(result.urls).toEqual(PROVIDER_URLS)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('临时地址')
    expect(result.warnings[0]).toContain('重新登录')
  })

  it('会话过期（401）保留原地址并给中文原因，不抛出', async () => {
    stubFetch({ status: 401, json: { error: 'UNAUTHORIZED' } })
    const result = await permanentizeGeneratedMediaUrls({ serverUrl: SERVER, accessToken: 'expired', urls: PROVIDER_URLS })
    expect(result.urls).toEqual(PROVIDER_URLS)
    expect(result.warnings.join('')).toContain('临时地址')
    expect(result.warnings.join('')).toContain('重新登录')
  })

  it('服务器报错时保留原地址并带出失败原因', async () => {
    stubFetch({ status: 500, json: { error: 'boom' } })
    const result = await permanentizeGeneratedMediaUrls({ serverUrl: SERVER, accessToken: 'token', urls: [PROVIDER_URLS[0]] })
    expect(result.urls).toEqual([PROVIDER_URLS[0]])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('已在服务器上的地址幂等跳过，不再占用上传', async () => {
    const { fetchMock } = stubFetch({ status: 200, json: { items: [] } })
    const permanent = `${SERVER}/ai-assets/id1/01.jpg`
    const result = await permanentizeGeneratedMediaUrls({ serverUrl: SERVER, accessToken: 'token', urls: [permanent] })
    expect(result.urls).toEqual([permanent])
    expect(result.warnings).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
