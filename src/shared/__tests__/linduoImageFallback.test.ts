import { describe, expect, it } from 'vitest'
import {
  LINDUO_NO_CHANNEL_CACHE_TTL_MS,
  LINDUO_NO_CHANNEL_MARKER,
  createLinduoNoChannelCache,
  humanizeLinduoImageError,
  isLinduoNoChannelError,
  isLinduoTextOnlyRefusal,
  isNoChannelFailure,
  isTransientLinduoFailure,
  linduoNoChannelErrorMessage,
  listLinduoFallbackChain
} from '../linduoImageFallback'

const MODELS = [
  { id: 'gpt-image-1', name: 'GPT-Image-1', maxReferenceImages: 0 },
  { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image', maxReferenceImages: 4 },
  { id: 'imagen-4.0', name: 'Imagen 4.0', maxReferenceImages: 0 }
]

describe('零度API 生图失败瞬时性判定', () => {
  it('分销无通道/网关过载判瞬时，可幂等重试', () => {
    expect(isTransientLinduoFailure(503, 'No available channel for model gpt-image-1 under group auto (distributor)')).toBe(true)
    expect(isTransientLinduoFailure(502, 'bad gateway')).toBe(true)
    expect(isTransientLinduoFailure(429, 'rate limit exceeded')).toBe(true)
    expect(isTransientLinduoFailure(500, 'internal error')).toBe(true)
  })

  it('参数/鉴权类错误不重试', () => {
    expect(isTransientLinduoFailure(404, 'Model not exist.')).toBe(false)
    expect(isTransientLinduoFailure(401, 'invalid api key')).toBe(false)
    expect(isTransientLinduoFailure(400, 'prompt is empty')).toBe(false)
  })

  it('中文「响应读取中断/超时」同样判瞬时，可幂等重试', () => {
    expect(isTransientLinduoFailure(0, '上游响应读取中断（可能已超时），请重试')).toBe(true)
    expect(isTransientLinduoFailure(200, '未返回图片结果（上游原因 IMAGE_SAFETY），请调整提示词或参照图后重试')).toBe(false)
  })

  it('HTTP 200 只有文本拒绝（通道误路由到文本模型）判瞬时，确定性拦截除外', () => {
    expect(isLinduoTextOnlyRefusal(200, '未返回图片结果（上游原因 STOP）：通常我可以提供这类帮助，但我似乎无权访问该内容，请调整提示词或参照图后重试')).toBe(true)
    expect(isTransientLinduoFailure(200, '未返回图片结果（上游原因 STOP）：我的设计用途只是处理和生成文本')).toBe(true)
    // 无 images 但没有拒绝文案（例如空 candidates）同样按瞬时处理
    expect(isLinduoTextOnlyRefusal(200, '未返回图片结果')).toBe(true)
    // 上游内容安全/背诵/超长拦截重试无意义
    expect(isLinduoTextOnlyRefusal(200, '未返回图片结果（上游原因 PROHIBITED_CONTENT）')).toBe(false)
    expect(isLinduoTextOnlyRefusal(200, '未返回图片结果（上游原因 RECITATION）')).toBe(false)
    expect(isLinduoTextOnlyRefusal(200, '未返回图片结果（上游原因 MAX_TOKENS）')).toBe(false)
    // 非 200 交给状态码/文案既有规则
    expect(isLinduoTextOnlyRefusal(503, '未返回图片结果')).toBe(false)
    expect(isLinduoTextOnlyRefusal(200, 'invalid api key')).toBe(false)
  })

  it('无通道语义单独可判（重试耗尽后触发降级）', () => {
    expect(isNoChannelFailure(503, 'No available channel for model gpt-image-1')).toBe(true)
    expect(isNoChannelFailure(500, 'internal error')).toBe(false)
  })

  /** 实测 2026-10-17：零度把两款 Banana 下架，HTTP 400 {"error":{"message":"该模型修复中","type":"upstream_error"}} */
  it('上游下架维修（HTTP 400 该模型修复中）同样按无通道处理', () => {
    expect(isNoChannelFailure(400, '该模型修复中')).toBe(true)
    expect(isNoChannelFailure(400, 'prompt is empty')).toBe(false)
    // 维修中原模型重发无意义，不判瞬时
    expect(isTransientLinduoFailure(400, '该模型修复中')).toBe(false)
  })
})

describe('零度全链降级顺序（遍历全部候选，不只试一个）', () => {
  it('无参照需求时按能力就近排序并排除当前模型', () => {
    expect(listLinduoFallbackChain(MODELS, 'gpt-image-1', 0)).toEqual(['imagen-4.0', 'gemini-2.5-flash-image-preview'])
    expect(listLinduoFallbackChain(MODELS, 'imagen-4.0', 0)).toEqual(['gpt-image-1', 'gemini-2.5-flash-image-preview'])
  })

  it('带参照需求时优先保留参照能力，其余候选兜底排在后面', () => {
    expect(listLinduoFallbackChain(MODELS, 'gpt-image-1', 1)).toEqual(['gemini-2.5-flash-image-preview', 'imagen-4.0'])
    expect(listLinduoFallbackChain(MODELS, 'gemini-2.5-flash-image-preview', 3)).toEqual(['gpt-image-1', 'imagen-4.0'])
  })

  it('没有候选能满足参照需求也遍历到底（宁可降级不出红条）', () => {
    expect(listLinduoFallbackChain(MODELS, 'gpt-image-1', 9)).toEqual(['gemini-2.5-flash-image-preview', 'imagen-4.0'])
  })

  it('目录只有当前模型时链为空', () => {
    expect(listLinduoFallbackChain([{ id: 'gpt-image-1', name: 'GPT-Image-1', maxReferenceImages: 0 }], 'gpt-image-1', 0)).toEqual([])
  })
})

describe('进程级无通道缓存（同批分镜不重复探测死模型）', () => {
  it('标记后 TTL 内判死，超过 TTL 自动放行重探', () => {
    let now = 1_000
    const cache = createLinduoNoChannelCache(60_000, () => now)
    expect(cache.isDead('gpt-image-1')).toBe(false)
    cache.markDead('gpt-image-1')
    expect(cache.isDead('gpt-image-1')).toBe(true)
    now += 59_000
    expect(cache.isDead('gpt-image-1')).toBe(true)
    now += 2_000
    expect(cache.isDead('gpt-image-1')).toBe(false)
    expect(cache.deadIds()).toEqual([])
  })

  it('只影响被标记的模型，其余候选仍可探测', () => {
    const cache = createLinduoNoChannelCache(60_000, () => 5_000)
    cache.markDead('imagen-4.0')
    expect(cache.isDead('gpt-image-1')).toBe(false)
    expect(cache.deadIds()).toEqual(['imagen-4.0'])
  })

  it('默认 TTL 为 10 分钟', () => {
    expect(LINDUO_NO_CHANNEL_CACHE_TTL_MS).toBe(600_000)
    const cache = createLinduoNoChannelCache()
    cache.markDead('gpt-image-1')
    expect(cache.isDead('gpt-image-1')).toBe(true)
  })
})

describe('无通道标记（供面板自动跨厂商恢复，不再上红条）', () => {
  it('标记错误经 IPC 包装后仍识别为零度无通道', () => {
    const raw = `Error invoking remote method 'image:generate': Error: ${linduoNoChannelErrorMessage(['gpt-image-1', 'imagen-4.0'], ['gemini-2.5-flash-image-preview'])}`
    expect(isLinduoNoChannelError(raw)).toBe(true)
    const text = humanizeLinduoImageError(raw)
    expect(text).not.toContain('LINDUO_NO_CHANNEL')
    expect(text).toContain('零度API 生图模型均无可用通道')
    expect(text).toContain('10 分钟内已确认无通道')
  })

  it('英文原文与中文全文都能判定，鉴权/参数类错误不能判定', () => {
    expect(isLinduoNoChannelError('No available channel for model gpt-image-1 under group auto (distributor)')).toBe(true)
    expect(isLinduoNoChannelError(humanizeLinduoImageError("Error invoking remote method 'image:generate': Error: gpt-image-1 零度API 生图失败（HTTP 503）：No available channel for model gpt-image-1"))).toBe(true)
    expect(isLinduoNoChannelError("Error invoking remote method 'image:generate': Error: gpt-image-1 零度API 生图失败（HTTP 401）：invalid api key")).toBe(false)
    expect(isLinduoNoChannelError('模型未返回图片，请更换模型或重试')).toBe(false)
  })
})

describe('红条中文化', () => {
  it('剥离 IPC 前缀并把无通道转中文全文', () => {
    const raw = "Error invoking remote method 'image:generate': Error: gpt-image-1 零度API 生图失败（HTTP 503）：No available channel for model gpt-image-1 under group auto (distributor) (request id: 202610150152493146769328268d9d6ungS3Qv6)"
    const text = humanizeLinduoImageError(raw)
    expect(text).not.toContain('Error invoking remote method')
    expect(text).not.toContain('No available channel')
    expect(text).toContain('零度API 当前没有可用生图通道（gpt-image-1）')
    expect(text).toContain('改用其他生图模型')
    expect(text).toContain('request id: 202610150152')
  })

  it('非无通道的零度错误保留中文标签与详情', () => {
    const text = humanizeLinduoImageError("Error invoking remote method 'image:generate': Error: imagen-4.0 零度API 生图失败（HTTP 400）：prompt is empty")
    expect(text).toContain('零度API 生图失败（HTTP 400）')
    expect(text).not.toContain('Error invoking')
  })

  it('空错误给可操作中文兜底', () => {
    expect(humanizeLinduoImageError('')).toContain('请重试或更换生图模型')
  })
})
