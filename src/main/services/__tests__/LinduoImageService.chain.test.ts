/**
 * 零度API 生图整链降级与进程级无通道缓存。
 * - 上游无库存：按参照能力遍历 gpt-image-1 → imagen-4.0 → gemini，任一存活即出图并显式标注实际模型
 * - 整链无通道：抛带 [[LINDUO_NO_CHANNEL]] 标记的中文错误，交由渲染器跨厂商改用万相
 * - TTL 内已确认无通道的模型不再重复发请求（同批分镜不放大失败调用）
 * - 鉴权/参数类错误不换模型、不打标记
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ImageGenerationRequest } from '../../../shared/contracts'
import { createLinduoNoChannelCache } from '../../../shared/linduoImageFallback'
import { BANANA_REQUEST_TIMEOUT_MS, LinduoImageService } from '../LinduoImageService'

const ENDPOINT = 'https://mock-api000.test/v1'

/**
 * 单测无 Electron 运行时，nativeImage 用固定位图桩：
 * 只验证「参照确实被解码→压白底→按 JPEG 上行」，像素混合数学由 shared/linduoImageReference 单测覆盖。
 */
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (buffer: Buffer) => ({
      isEmpty: () => buffer.length === 0,
      getSize: () => ({ width: 2, height: 2 }),
      toBitmap: () => Buffer.alloc(16, 255)
    }),
    createFromBitmap: (bitmap: Buffer, options: { width: number; height: number }) => ({
      toJPEG: (quality: number) => Buffer.from(`jpeg:${bitmap.length}:${options.width}x${options.height}:${quality}`)
    })
  }
}))
/** 桩固定产出：16 字节位图、2x2、质量 92 */
const MOCK_JPEG = Buffer.from('jpeg:16:2x2:92').toString('base64')

type FetchCall = { model: string }

/** 每例独立无通道缓存，避免进程级 TTL 状态串测 */
const newService = () => new LinduoImageService('test-key', ENDPOINT, createLinduoNoChannelCache())

function respond(model: string, outcome: 'ok' | 'no-channel' | 'auth') {
  if (outcome === 'ok') return new Response(JSON.stringify({ data: [{ url: `https://img.test/${model}.png` }] }), { status: 200 })
  if (outcome === 'auth') return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })
  return new Response(JSON.stringify({ error: { message: `No available channel for model ${model} under group auto (distributor)` } }), { status: 503 })
}

/** 按模型名分派结果，并记录调用次序（重试会重复计数） */
function stubFetch(results: Record<string, 'ok' | 'no-channel' | 'auth'>) {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const bodyModel = String(JSON.parse(init?.body || '{}').model || '')
    // Nano Banana 走 Gemini 接口，模型名在 URL 上而非请求体
    const model = bodyModel || String(url).match(/\/v1beta\/models\/([^:]+):generateContent/)?.[1] || ''
    calls.push({ model })
    return respond(model, results[model] ?? 'no-channel')
  }))
  return calls
}

const request: ImageGenerationRequest = { model: 'gpt-image-1', prompt: 'a racing seat', size: '1K', count: 1, referenceImageUrls: [] }

describe('LinduoImageService Nano Banana', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['nano-banana-2', 'nano-banana-pro'])('%s 展示于目录并通过 Gemini 传递参照图与真实 2K 尺寸', async model => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) })
      return new Response(JSON.stringify(String(url).endsWith('/models') ? { data: [] } : {
        candidates: [{ content: { parts: [{ text: '完成' }, { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }]
      }), { status: 200 })
    }))
    const service = newService()
    expect((await service.connection()).models.some(item => item.id === model && (item.maxReferenceImages ?? 0) > 0)).toBe(true)
    const result = await service.generate({ ...request, model, size: '2K', referenceImageUrls: ['data:image/png;base64,cmVm', 'data:image/png;base64,cmVm'] })
    expect(result.imageUrls).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.model).toBe(model)
    expect(result.notice).toBeUndefined()
    expect(calls[1]).toEqual({ url: `https://mock-api000.test/v1beta/models/${model}:generateContent`, body: {
      contents: [{ role: 'user', parts: [{ text: 'a racing seat' }, { inlineData: { mimeType: 'image/jpeg', data: MOCK_JPEG } }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '2K', aspectRatio: '1:1' } }
    } })
  })

  it('参照不以 PNG 上行：零度 Banana 通道读不进 PNG 参照（实测 0/4 成功）', async () => {
    const calls: Array<{ body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body || '{}')) })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }), { status: 200 })
    }))
    await newService().generate({ ...request, model: 'nano-banana-2', referenceImageUrls: ['data:image/png;base64,cmVm', 'data:image/webp;base64,cmVm'] })
    const parts = calls[0].body.contents[0].parts
    expect(parts).toHaveLength(3)
    expect(parts.slice(1).map((part: any) => part.inlineData?.mimeType)).toEqual(['image/jpeg', 'image/jpeg'])
    expect(JSON.stringify(parts)).not.toContain('image/png')
  })

  it('公网参照图转换为内嵌图片且不向图片主机发送API密钥', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return String(url).startsWith('https://93.184.216.34/')
        ? new Response('reference', { headers: { 'content-type': 'image/png' } })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }))
    }))
    const result = await newService().generate({ ...request, model: 'nano-banana-2', referenceImageUrls: ['https://93.184.216.34/ref.png'] })
    expect(result.model).toBe('nano-banana-2')
    expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(calls[1].init?.body)).contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: MOCK_JPEG } })
  })

  it('Nano Banana 文本回复不冒充出图成功，按瞬时重试后仍报错且不自动切换模型', async () => {
    vi.stubEnv('YANDU_LINDUO_RETRY_DELAYS', '0,0')
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '我似乎无权访问该内容' }] }, finishReason: 'STOP' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(newService().generate({ ...request, model: 'nano-banana-pro' })).rejects.toThrow('未返回图片结果')
      // 同一请求幂等重试 3 次（1+2），全程只打 pro 一个模型
      expect(fetcher).toHaveBeenCalledTimes(3)
      expect(fetcher.mock.calls.every(call => String(call[0]).includes('nano-banana-pro'))).toBe(true)
    } finally { vi.unstubAllEnvs() }
  })

  it('文本拒绝重试一次即成功时出图并说明已自动重试', async () => {
    vi.stubEnv('YANDU_LINDUO_RETRY_DELAYS', '0,0')
    let calls = 0
    const refusal = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '我似乎无权访问该内容' }] }, finishReason: 'STOP' }] }), { status: 200 })
    const image = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }] }), { status: 200 })
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return calls === 1 ? refusal() : image()
    }))
    try {
      const result = await newService().generate({ ...request, model: 'nano-banana-2' })
      expect(result.imageUrls).toEqual(['data:image/png;base64,aW1hZ2U='])
      expect(result.notice).toContain('已自动重试 1 次后成功')
    } finally { vi.unstubAllEnvs() }
  })

  /** 实测：健康请求 45 秒出图，断流请求会占满 300 秒预算（直连复现 IncompleteRead 163KB/1.6MB） */
  it('首路断流超过补发窗口时并发补发同一请求，取先出图的一路并取消挂住的那路', async () => {
    vi.stubEnv('YANDU_BANANA_HEDGE_MS', '20')
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      if (signals.length === 1) {
        // 第一路：响应头已回但正文永不到达，直到被取消
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
          const reason = new Error('aborted')
          reason.name = 'AbortError'
          reject(reason)
        }))
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }] }), { status: 200 })
    }))
    try {
      const result = await newService().generate({ ...request, model: 'nano-banana-2' })
      expect(result.imageUrls).toEqual(['data:image/png;base64,aW1hZ2U='])
      expect(signals).toHaveLength(2)
      expect(signals[0]?.aborted).toBe(true)
      expect(result.notice).toBeUndefined()
    } finally { vi.unstubAllEnvs() }
  })

  it('补发窗口内首路就确定性失败时不补发第二路（不重复烧额度）', async () => {
    vi.stubEnv('YANDU_BANANA_HEDGE_MS', '20')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(newService().generate({ ...request, model: 'nano-banana-2' })).rejects.toThrow('HTTP 401')
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { vi.unstubAllEnvs() }
  })

  it('两路都断流仍按瞬时错误走幂等重试，耗尽后才报中文断流原因', async () => {
    vi.stubEnv('YANDU_BANANA_HEDGE_MS', '20')
    vi.stubEnv('YANDU_LINDUO_RETRY_DELAYS', '0')
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal
      signal.addEventListener('abort', () => { const reason = new Error('closed'); reason.name = 'TypeError'; reject(reason) })
      setTimeout(() => { const reason = new Error('closed'); reason.name = 'TypeError'; reject(reason) }, 5)
    }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(newService().generate({ ...request, model: 'nano-banana-2' })).rejects.toThrow('上游响应读取中断')
      // 首路 5 毫秒即失败，未超补发窗口 → 每轮只发一路，不重复烧额度
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally { vi.unstubAllEnvs() }
  })

  it('Nano Banana 多张请求逐张生成而非忽略 count', async () => {
    let count = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/webp', data: `image${++count}` } }] } }] }))))
    const result = await newService().generate({ ...request, model: 'nano-banana-2', count: 2 })
    expect(result.imageUrls).toEqual(['data:image/webp;base64,image1', 'data:image/webp;base64,image2'])
  })

  it('多张生成后续图片瞬时失败时只重试未完成图片', async () => {
    vi.stubEnv('YANDU_LINDUO_RETRY_DELAYS', '0')
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return calls === 2
        ? new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: `image${calls}` } }] } }] }))
    }))
    try {
      const result = await newService().generate({ ...request, model: 'nano-banana-2', count: 2 })
      expect(result.imageUrls).toEqual(['data:image/png;base64,image1', 'data:image/png;base64,image3'])
      expect(calls).toBe(3)
    } finally { vi.unstubAllEnvs() }
  })

  it('配置输出目录时将图片落盘并返回短媒体地址，避免批量2K撑爆localStorage', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'banana-storage-'))
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }))))
      const service = new LinduoImageService('test-key', ENDPOINT, createLinduoNoChannelCache(), directory)
      const result = await service.generate({ ...request, model: 'nano-banana-2' })
      expect(result.imageUrls[0]).toMatch(/^cross-media:\/\/local\//)
      const file = decodeURIComponent(new URL(result.imageUrls[0]).pathname.slice(1))
      expect(path.dirname(file)).toBe(directory)
      expect((await readFile(file)).toString()).toBe('image')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('Nano Banana 拒绝内网参照图且不发送生成请求', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(newService().generate({ ...request, model: 'nano-banana-pro', referenceImageUrls: ['http://127.0.0.1/private.png'] })).rejects.toThrow('内网')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('参照图超大时跳过该张并继续用其余参照出图，不再整单失败', async () => {
    const calls: Array<{ parts: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('https://93.184.216.34/')) {
        return new Response('tiny', { headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) } })
      }
      calls.push({ parts: JSON.parse(String(init?.body || '{}')).contents[0].parts })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }] }), { status: 200 })
    }))
    const result = await newService().generate({ ...request, model: 'nano-banana-2', referenceImageUrls: ['https://93.184.216.34/huge.png', 'data:image/png;base64,cmVm'] })
    expect(result.imageUrls).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.notice).toContain('已跳过 1 张')
    expect(calls[0]?.parts).toEqual([{ text: 'a racing seat' }, { inlineData: { mimeType: 'image/jpeg', data: MOCK_JPEG } }])
  })

  /** 实测：带参照图的 nano-banana-2 请求耗时 206–212 秒，旧 180 秒上限会在响应体传输中途 abort */  it('响应体读取中断按瞬时错误重试并成功出图，不再伪装成 HTTP 200 未返回图片', async () => {
    vi.stubEnv('YANDU_LINDUO_RETRY_DELAYS', '0')
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return calls === 1
        ? new Response('{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U', { status: 200 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }), { status: 200 })
    }))
    try {
      const result = await newService().generate({ ...request, model: 'nano-banana-2' })
      expect(result.imageUrls).toEqual(['data:image/png;base64,aW1hZ2U='])
      expect(calls).toBe(2)
    } finally { vi.unstubAllEnvs() }
  })

  it('Nano Banana 单次请求超时预算需覆盖实测 212 秒上游耗时', async () => {
    expect(BANANA_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000)
  })

  it('上游明确不给图片时报出真实 finishReason 而非笼统提示', async () => {
    vi.stubEnv('YANDU_LINDUO_RETRY_DELAYS', '0')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }), { status: 200 })))
    try {
      await expect(newService().generate({ ...request, model: 'nano-banana-2' })).rejects.toThrow('IMAGE_SAFETY')
    } finally { vi.unstubAllEnvs() }
  })

  it('图片落在后续候选时仍能取出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [
      { content: { parts: [{ text: '稍等' }] }, finishReason: 'STOP' },
      { content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }, finishReason: 'STOP' }
    ] }), { status: 200 })))
    const result = await newService().generate({ ...request, model: 'nano-banana-pro' })
    expect(result.imageUrls).toEqual(['data:image/png;base64,aW1hZ2U='])
  })
})

describe('LinduoImageService 零度整链降级', () => {
  beforeEach(() => {
    process.env.YANDU_LINDUO_RETRY_DELAYS = '0,0'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.YANDU_LINDUO_RETRY_DELAYS
  })

  it('遍历到链上最后一个存活模型也能出图并标注实际模型', async () => {
    const calls = stubFetch({ 'gpt-image-1': 'no-channel', 'imagen-4.0': 'no-channel', 'gemini-2.5-flash-image-preview': 'ok' })
    const service = newService()
    const result = await service.generate({ ...request, referenceImageUrls: [] })
    expect(result.model).toBe('gemini-2.5-flash-image-preview')
    expect(result.imageUrls).toEqual(['https://img.test/gemini-2.5-flash-image-preview.png'])
    expect(result.notice).toContain('已改用 Gemini 2.5 Flash Image 完成本次生成')
    expect(calls.map(call => call.model)).toEqual([
      'gpt-image-1', 'gpt-image-1', 'gpt-image-1',
      'imagen-4.0', 'imagen-4.0', 'imagen-4.0',
      'gemini-2.5-flash-image-preview'
    ])
  })

  /** 实测 2026-10-17：零度把 nano-banana-2/pro 下架，HTTP 400「该模型修复中」——原地重发没有意义 */
  it('上游下架维修按无通道处理：只打一次该模型即降级到链上存活模型', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const model = String(url).match(/\/v1beta\/models\/([^:]+):/)?.[1] || String(JSON.parse(String(init?.body || '{}')).model || '')
      calls.push(model)
      if (model.startsWith('nano-banana')) return new Response(JSON.stringify({ error: { message: '该模型修复中', type: 'upstream_error' } }), { status: 400 })
      return new Response(JSON.stringify({ data: [{ url: `https://img.test/${model}.png` }] }), { status: 200 })
    }))
    const result = await newService().generate({ ...request, model: 'nano-banana-2', referenceImageUrls: [] })
    expect(calls[0]).toBe('nano-banana-2')
    expect(calls.filter(call => call.startsWith('nano-banana'))).toHaveLength(1)
    expect(result.model).not.toBe('nano-banana-2')
    expect(result.imageUrls).toEqual([`https://img.test/${result.model}.png`])
    expect(result.notice).toContain('零度API 当前无 nano-banana-2 通道')
  })

  it('整链无通道抛带标记中文错误且不静默跨厂商', async () => {    stubFetch({ 'gpt-image-1': 'no-channel', 'imagen-4.0': 'no-channel', 'gemini-2.5-flash-image-preview': 'no-channel' })
    const service = newService()
    const error = await service.generate(request).then(() => null).catch((reason: unknown) => reason as Error)
    expect(error?.message).toContain('[[LINDUO_NO_CHANNEL]]')
    expect(error?.message).toContain('零度API 生图模型均无可用通道')
    expect(error?.message).not.toContain('No available channel')
  })

  it('同进程后续请求跳过 TTL 内已确认无通道的模型（不再发请求）', async () => {
    const calls = stubFetch({ 'gpt-image-1': 'no-channel', 'imagen-4.0': 'no-channel', 'gemini-2.5-flash-image-preview': 'no-channel' })
    const service = newService()
    await service.generate(request).catch(() => null)
    const afterFirst = calls.length
    await service.generate(request).catch(() => null)
    expect(calls.length).toBe(afterFirst)
    const error = await service.generate(request).then(() => null).catch((reason: unknown) => reason as Error)
    expect(error?.message).toContain('10 分钟内已确认无通道')
  })

  it('带参照需求优先降级到保留参照能力的 gemini 而不是丢参照', async () => {
    const calls = stubFetch({ 'gpt-image-1': 'no-channel', 'imagen-4.0': 'no-channel', 'gemini-2.5-flash-image-preview': 'ok' })
    const service = newService()
    const result = await service.generate({ ...request, referenceImageUrls: ['https://img.test/ref-1.png', 'https://img.test/ref-2.png'] })
    expect(result.model).toBe('gemini-2.5-flash-image-preview')
    const geminiCall = calls.find(call => call.model === 'gemini-2.5-flash-image-preview')
    expect(geminiCall).toBeTruthy()
    expect(calls.some(call => call.model === 'imagen-4.0')).toBe(false)
  })

  it('鉴权类错误不换模型不打标记（保留红条语义）', async () => {
    const calls = stubFetch({ 'gpt-image-1': 'auth', 'imagen-4.0': 'ok', 'gemini-2.5-flash-image-preview': 'ok' })
    const service = newService()
    const error = await service.generate(request).then(() => null).catch((reason: unknown) => reason as Error)
    expect(error?.message).toContain('零度API 生图失败（HTTP 401）')
    expect(error?.message).not.toContain('LINDUO_NO_CHANNEL')
    expect(calls.map(call => call.model)).toEqual(['gpt-image-1'])
  })

  it('整链失败后换零度其他模型也即刻带标记失败（TTL 内不再打上游）', async () => {
    const calls = stubFetch({ 'gpt-image-1': 'no-channel', 'imagen-4.0': 'no-channel', 'gemini-2.5-flash-image-preview': 'no-channel' })
    const service = newService()
    await service.generate(request).catch(() => null)
    const afterFirst = calls.length
    const error = await service.generate({ ...request, model: 'imagen-4.0' }).then(() => null).catch((reason: unknown) => reason as Error)
    expect(calls.length).toBe(afterFirst)
    expect(error?.message).toContain('[[LINDUO_NO_CHANNEL]]')
  })
})
