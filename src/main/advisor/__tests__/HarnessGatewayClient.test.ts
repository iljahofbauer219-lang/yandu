import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { HarnessGatewayClient } from '../HarnessGatewayClient'

const mockFetch = vi.fn()
;(globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch

const makeClient = () => new HarnessGatewayClient({
  appServerBaseUrl: 'http://app:8787',
  gatewayBaseUrl: 'http://gateway:8788',
  getAccessToken: () => Promise.resolve('test-user-jwt')
})

describe('HarnessGatewayClient', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connect() 首次成功：缓存 workerOrigin + cookie', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ ticket: 'jwt-ticket' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 204,
        headers: { 'set-cookie': '__Host-yandu_harness=abc.def; Path=/; HttpOnly' }
      }))
    const client = makeClient()
    const session = await client.connect()
    expect(session.url).toBeTruthy()
    expect(session.message).toContain('已就绪')
    expect(client.getCookieHeader()).toBe('__Host-yandu_harness=abc.def')
  })

  it('connect() 二次调用命中缓存，不重复请求', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'set-cookie': 'a=1' } }))
    const client = makeClient()
    await client.connect()
    const second = await client.connect()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(second.url).toBeTruthy()
  })

  it('access-ticket 403 抛出 ADVISOR_FORBIDDEN', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"FORBIDDEN"}', { status: 403 }))
    const client = makeClient()
    await expect(client.connect()).rejects.toThrow(/ADVISOR_FORBIDDEN|FORBIDDEN/)
  })

  it('gateway 502 抛出 HARNESS_UNAVAILABLE', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"BAD"}', { status: 502 }))
    const client = makeClient()
    await expect(client.connect()).rejects.toThrow(/HARNESS_UNAVAILABLE/)
  })

  it('并发 connect() 只发起一次真实请求', async () => {
    let resolveFirst!: (r: Response) => void
    mockFetch
      .mockReturnValueOnce(new Promise<Response>(r => { resolveFirst = r }))
    const client = makeClient()
    const p1 = client.connect()
    const p2 = client.connect()
    resolveFirst(new Response('{"ticket":"t1"}', { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'set-cookie': 'a=1' } }))
    await Promise.all([p1, p2])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('disconnect() 后再 getWorkerOrigin 抛错', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'set-cookie': 'a=1' } }))
    const client = makeClient()
    await client.connect()
    await client.disconnect()
    expect(() => client.getWorkerOrigin()).toThrow(/ADVISOR_NOT_CONNECTED/)
  })

  it('on("unavailable") 监听 gateway 502', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"ticket":"t1"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"BAD"}', { status: 502 }))
    const client = makeClient()
    const handler = vi.fn()
    client.on('unavailable', handler)
    await expect(client.connect()).rejects.toThrow()
    expect(handler).toHaveBeenCalled()
  })
})
