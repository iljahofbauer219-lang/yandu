/**
 * download-worker 纯函数单测（P2 / M2）：
 *   - 扩展名推导（content-type / URL 后缀）
 *   - fetchImageWithRetry：首次成功 / 失败后重试成功（尝试次数）/ 重试耗尽抛错 / HTTP 非 2xx 重试
 *   - 退避序列按序取用（backoffMs 用 0 避免真实延时）
 * 触库路径（runDownloadJob/enqueue）由 verify-erp-p2.ts e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { extFromContentType, extFromUrl, fetchImageWithRetry } from '../download-worker.js'

function mockResponse(ok: boolean, status: number, body: Uint8Array, contentType = 'image/jpeg'): Response {
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  } as unknown as Response
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe('extFromContentType', () => {
  it('常见类型映射正确', () => {
    expect(extFromContentType('image/jpeg')).toBe('.jpg')
    expect(extFromContentType('image/png')).toBe('.png')
    expect(extFromContentType('image/webp')).toBe('.webp')
  })
  it('带 charset 参数仍正确解析', () => {
    expect(extFromContentType('image/png; charset=binary')).toBe('.png')
  })
  it('未知/空类型回落 .jpg', () => {
    expect(extFromContentType('application/octet-stream')).toBe('.jpg')
    expect(extFromContentType('')).toBe('.jpg')
  })
})

describe('extFromUrl', () => {
  it('URL 路径后缀优先', () => {
    expect(extFromUrl('https://cdn.example.com/a/b/photo.PNG', 'image/jpeg')).toBe('.png')
    expect(extFromUrl('https://cdn.example.com/x.jpeg', 'image/png')).toBe('.jpg')
  })
  it('无后缀回落 content-type', () => {
    expect(extFromUrl('https://cdn.example.com/image?id=1', 'image/webp')).toBe('.webp')
  })
  it('非法 URL 回落 content-type', () => {
    expect(extFromUrl('not-a-url', 'image/png')).toBe('.png')
  })
})

describe('fetchImageWithRetry', () => {
  it('首次成功：attempts=1，返回 buffer 与 content-type', async () => {
    let calls = 0
    const fetcher = (async () => { calls += 1; return mockResponse(true, 200, PNG_BYTES, 'image/png') }) as unknown as typeof fetch
    const result = await fetchImageWithRetry('https://cdn/x.png', { fetcher, retries: 3, backoffMs: [0, 0, 0] })
    expect(calls).toBe(1)
    expect(result.attempts).toBe(1)
    expect(result.contentType).toBe('image/png')
    expect(Buffer.from(result.buffer).equals(Buffer.from(PNG_BYTES))).toBe(true)
  })

  it('前两次失败第三次成功：attempts=3，重试生效', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls += 1
      if (calls < 3) throw new Error('ECONNRESET')
      return mockResponse(true, 200, JPG_BYTES, 'image/jpeg')
    }) as unknown as typeof fetch
    const result = await fetchImageWithRetry('https://cdn/x.jpg', { fetcher, retries: 3, backoffMs: [0, 0, 0] })
    expect(calls).toBe(3)
    expect(result.attempts).toBe(3)
  })

  it('重试耗尽抛错，错误信息含总尝试次数', async () => {
    let calls = 0
    const fetcher = (async () => { calls += 1; throw new Error('network down') }) as unknown as typeof fetch
    await expect(
      fetchImageWithRetry('https://cdn/dead.jpg', { fetcher, retries: 2, backoffMs: [0, 0, 0] })
    ).rejects.toThrow(/共尝试 3 次/)
    expect(calls).toBe(3) // 首次 + 2 次重试
  })

  it('HTTP 非 2xx 视为失败并重试', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls += 1
      if (calls === 1) return mockResponse(false, 403, new Uint8Array(), 'image/jpeg')
      return mockResponse(true, 200, JPG_BYTES, 'image/jpeg')
    }) as unknown as typeof fetch
    const result = await fetchImageWithRetry('https://cdn/403then200.jpg', { fetcher, retries: 2, backoffMs: [0, 0, 0] })
    expect(calls).toBe(2)
    expect(result.attempts).toBe(2)
  })

  it('retries=0 时只尝试一次', async () => {
    let calls = 0
    const fetcher = (async () => { calls += 1; throw new Error('boom') }) as unknown as typeof fetch
    await expect(
      fetchImageWithRetry('https://cdn/x.jpg', { fetcher, retries: 0, backoffMs: [0] })
    ).rejects.toThrow(/共尝试 1 次/)
    expect(calls).toBe(1)
  })
})
