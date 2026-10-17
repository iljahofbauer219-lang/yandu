import type { ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, ImageModelProfile } from '../../shared/contracts'
import { nativeImage } from 'electron'
import { importImage, validatePublicProductUrl } from './ImageSourceService'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { flattenOntoWhite } from '../../shared/linduoImageReference'
import {
  createLinduoNoChannelCache,
  humanizeLinduoImageError,
  isNoChannelFailure,
  isTransientLinduoFailure,
  linduoNoChannelErrorMessage,
  listLinduoFallbackChain,
  type LinduoNoChannelCache
} from '../../shared/linduoImageFallback'

/**
 * 零度API（api000.com）生图服务。
 * 兼容 OpenAI /v1/images/generations 协议；由零度API 代理 OpenAI / Google / Anthropic / Vidu 等大模型。
 * 一个 Key 解锁 37 个模型（详见 LinduoModelMallPage 静态目录）。
 *
 * 注意：零度API 是国内聚合代理，自身已处理跨境访问；本服务直连 https://api000.com/v1 即可，
 * 不复用 IMAGE_PROXY_URL。
 */

/** 零度API 旗下生图模型元数据；模型 id 需与 api000.com /v1/models 探测返回一致 */
const supportedModels: Record<string, Omit<ImageModelProfile, 'id'>> = {
  'gpt-image-1': {
    name: 'GPT-Image-1',
    description: 'OpenAI gpt-image-1（经零度API 代理），纯文生图，文字渲染与细节表现俱佳',
    maxReferenceImages: 0,
    provider: 'linduo',
    strengths: '文字渲染·细节·创意构图',
    costLabel: '按量计费'
  },
  'gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image',
    description: 'Google Gemini 2.5 Flash 多模态生图（经零度API 代理），支持参照图',
    maxReferenceImages: 4,
    provider: 'linduo',
    strengths: '多模态·速度快·参照图',
    costLabel: '按量计费'
  },
  'imagen-4.0': {
    name: 'Imagen 4.0',
    description: 'Google Imagen 4.0（经零度API 代理），高质量商品图与品牌色控制',
    maxReferenceImages: 0,
    provider: 'linduo',
    strengths: '高质量·品牌色·主图',
    costLabel: '按量计费'
  },
  'nano-banana-2': {
    name: 'Nano Banana 2',
    description: 'Google Nano Banana 2（零度API Gemini 接口），支持商品参照图与 1K/2K/4K 生图',
    maxReferenceImages: 4,
    provider: 'linduo',
    strengths: '商品参照·图像编辑·场景生成',
    costLabel: '$0.03–0.045/张'
  },
  'nano-banana-pro': {
    name: 'Nano Banana Pro',
    description: 'Google Nano Banana Pro（零度API Gemini 接口），支持商品参照图与 1K/2K/4K 生图',
    maxReferenceImages: 4,
    provider: 'linduo',
    strengths: '商品参照·精细构图·图像编辑',
    costLabel: '$0.04–0.05/张'
  }
}

const REQUEST_TIMEOUT_MS = 120_000
/** 实测带参照图的 Nano Banana 单次请求需 206–212 秒，180 秒会在响应体传输中途 abort */
export const BANANA_REQUEST_TIMEOUT_MS = 300_000
const BANANA_STREAM_BROKEN_DETAIL = '上游响应读取中断（可能已超时），请重试'

/** 仅网络/中断类异常按瞬时处理走重试；其它异常带真实原因报出，不伪装成超时 */
function bananaRequestDetail(reason: unknown): string {
  const name = reason instanceof Error ? reason.name : ''
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError'
    ? BANANA_STREAM_BROKEN_DETAIL
    : `零度API 生图请求异常：${reason instanceof Error ? reason.message : String(reason)}`
}

/**
 * 瞬时错误重试退避（毫秒，请求体不变幂等重发；次数=数组长度）。
 * 验收脚本与单测用 YANDU_LINDUO_RETRY_DELAYS=0,0 去掉真实等待。
 */
function retryDelaysMs(): number[] {
  return String(process.env.YANDU_LINDUO_RETRY_DELAYS || '1500,3000')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isFinite(value) && value >= 0)
}

/**
 * Nano Banana 并发补发窗口：实测健康请求约 45 秒出图，断流请求会把连接占满 300 秒预算后中断
 * （直接打上游复现：2K 一路 HTTP 200 45s 出图，1K 一路 513s 才 IncompleteRead）。
 * 超过该窗口仍无结果就并发补发同一请求，取先出图的一路；0 关闭补发（单测用）。
 */
function bananaHedgeDelayMs(): number {
  const raw = String(process.env.YANDU_BANANA_HEDGE_MS ?? '').trim()
  if (!raw) return 100_000
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : 100_000
}

/** 零度生图目录（含参照能力），供降级链排序 */
const modelCatalog: Array<{ id: string; name: string; maxReferenceImages: number }> = Object.entries(supportedModels)
  .map(([id, item]) => ({ id, name: item.name, maxReferenceImages: item.maxReferenceImages ?? 0 }))

/**
 * 进程级无通道缓存：上游分销组无库存时，同批后续分镜卡不再重复探测已确认死亡的模型。
 * TTL 内跳过、超时后自动放行重探。
 */
const moduleNoChannelCache = createLinduoNoChannelCache()

export class LinduoImageService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    /** 无通道缓存（生产用模块级实例，单测注入独立实例） */
    private readonly noChannelCache: LinduoNoChannelCache = moduleNoChannelCache,
    private readonly outputDirectory = ''
  ) {}

  /** 零度API 端点已含 /v1，去掉尾部斜杠避免拼接出重复路径 */
  private resolveHost(): string {
    return (this.baseUrl || 'https://api000.com/v1').replace(/\/+$/, '')
  }

  /**
   * 连接探测：调 /v1/models 返回 200 即认为 Key 有效；同时返回本服务已声明的生图模型元数据。
   * 探测失败不影响模型列表展示（沿用现有 VolcImageService.connection 的容错约定）。
   */
  async connection(): Promise<ImageModelConnection> {
    if (!this.apiKey) {
      return { connected: false, models: [], message: '未配置 LINDUO_API_KEY' }
    }
    const models = Object.entries(supportedModels).map(([id, profile]) => ({ id, ...profile }))
    try {
      const response = await fetch(`${this.resolveHost()}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) {
        return {
          connected: false,
          models,
          message: `零度API 探测失败（HTTP ${response.status}），请检查 Key 与网络，但模型元数据仍展示`
        }
      }
      return {
        connected: true,
        models,
        message: `零度API 已连接 · ${models.length} 个生图模型可用`
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      return {
        connected: false,
        models,
        message: `零度API 探测异常：${detail}`
      }
    }
  }

  private resolveSize(size: string, modelId: string): string {
    // 与现有 ark/openai 行为保持一致：2K / 1K / 显式 WxH，否则按模型默认值
    if (size === '2K') return '1024x1024'
    if (size === '1K') return '1024x1024'
    if (/^\d+x\d+$/.test(size)) return size
    // Gemini Flash Image 默认支持 1024x1024；其它模型回退到 1024x1024
    return '1024x1024'
  }

  /**
   * Nano Banana 参照统一转 JPEG：实测零度通道读不进 PNG 参照（0/4 成功，HTTP 200 只回中文拒绝文案，
   * 上游把图片丢弃后交给文本模型作答），转 JPEG 后同图 8/10 成功。
   * 透明像素自己压白底：编码器合成会得到黑底参照，而 eBay 主图要求纯白底，黑底会把出图带偏。
   */
  private bananaReference(dataUrl: string): { mimeType: string; data: string } | null {
    const match = dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,(.+)$/i)
    if (!match) return null
    const image = nativeImage.createFromBuffer(Buffer.from(match[1], 'base64'))
    const { width, height } = image.getSize()
    if (image.isEmpty() || !width || !height) return null
    const bitmap = flattenOntoWhite(new Uint8Array(image.toBitmap()))
    const jpeg = nativeImage.createFromBitmap(Buffer.from(bitmap), { width, height }).toJPEG(92)
    return { mimeType: 'image/jpeg', data: jpeg.toString('base64') }
  }

  private async generateBanana(request: ImageGenerationRequest, modelId: string, imageUrls: string[]): Promise<{ imageUrls: string[]; status: number; detail: string; skippedReferences: number }> {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: request.prompt }]
    let skippedReferences = 0
    for (const reference of this.dedupReferences(request, supportedModels[modelId].maxReferenceImages ?? 0)) {
      let dataUrl = reference.startsWith('data:') ? reference : ''
      if (!dataUrl) {
        // 内网/本机地址属安全拦截照旧报错；单张超大或读取失败只跳过该张，用剩余参照继续出图
        const url = await validatePublicProductUrl(reference)
        try {
          dataUrl = (await importImage(url, '参照图')).dataUrl
        } catch {
          skippedReferences += 1
          continue
        }
      }
      const inlined = this.bananaReference(dataUrl)
      if (!inlined) {
        skippedReferences += 1
        continue
      }
      parts.push({ inlineData: inlined })
    }
    const imageSize = ['1K', '2K', '4K'].includes(request.size) ? request.size : '1K'
    const body = JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize, aspectRatio: '1:1' } }
    })
    for (let index = imageUrls.length; index < Math.max(1, Math.min(4, request.count)); index += 1) {
      const outcome = await this.bananaHedged(modelId, body)
      if (!outcome.imageUrls.length) return { imageUrls: [], status: outcome.status, detail: outcome.detail, skippedReferences }
      if (this.outputDirectory) {
        const match = outcome.imageUrls[0].match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)!
        await mkdir(this.outputDirectory, { recursive: true })
        const file = path.join(this.outputDirectory, `${modelId}-${randomUUID()}.${match[1]}`)
        await writeFile(file, Buffer.from(match[2], 'base64'))
        imageUrls.push(`cross-media://local/${encodeURIComponent(file)}`)
      } else {
        imageUrls.push(outcome.imageUrls[0])
      }
    }
    return { imageUrls, status: 200, detail: '', skippedReferences }
  }

  /**
   * 首路超过补发窗口仍未结束就并发同一请求的第二路，任一路先出图即成功；
   * 确定性问题（鉴权/安全拦截）立即返回并取消另一路，不重复烧额度。
   */
  private async bananaHedged(modelId: string, body: string): Promise<{ imageUrls: string[]; status: number; detail: string }> {
    const controller = new AbortController()
    const first = this.bananaRequest(modelId, body, controller.signal)
    const hedgeMs = bananaHedgeDelayMs()
    if (!hedgeMs) return first
    const waiting = Symbol('banana-still-running')
    let timer: ReturnType<typeof setTimeout> | undefined
    const raced = await Promise.race([first, new Promise<typeof waiting>(resolve => { timer = setTimeout(() => resolve(waiting), hedgeMs) })])
    clearTimeout(timer)
    if (raced !== waiting) {
      if (!raced.imageUrls.length) controller.abort()
      return raced
    }
    const second = this.bananaRequest(modelId, body, controller.signal)
    const legs = [first.then(result => ({ result, leg: 0 })), second.then(result => ({ result, leg: 1 }))]
    const winner = await Promise.race(legs)
    if (winner.result.imageUrls.length || !isTransientLinduoFailure(winner.result.status, winner.result.detail)) {
      controller.abort()
      return winner.result
    }
    const loser = await (winner.leg === 0 ? legs[1] : legs[0])
    controller.abort()
    return loser.result.imageUrls.length ? loser.result : winner.result
  }

  private async bananaRequest(modelId: string, body: string, signal: AbortSignal): Promise<{ imageUrls: string[]; status: number; detail: string }> {
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(`${this.resolveHost().replace(/\/v1$/, '')}/v1beta/models/${modelId}:generateContent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(BANANA_REQUEST_TIMEOUT_MS)])
      })
    } catch (reason) {
      return { imageUrls: [], status: 0, detail: bananaRequestDetail(reason) }
    }
    let rawText: string
    try {
      rawText = await response.text()
    } catch {
      return { imageUrls: [], status: 0, detail: BANANA_STREAM_BROKEN_DETAIL }
    }
    let payload: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> }; finishReason?: string; blockReason?: string }>
      promptFeedback?: { blockReason?: string }
      error?: { message?: string }
    }
    try {
      payload = rawText ? JSON.parse(rawText) : {}
    } catch {
      return { imageUrls: [], status: 0, detail: BANANA_STREAM_BROKEN_DETAIL }
    }
    if (!response.ok) return { imageUrls: [], status: response.status, detail: payload.error?.message || response.statusText }
    const responseParts = (payload.candidates || []).flatMap(candidate => candidate.content?.parts || [])
    const images = responseParts.flatMap(part => {
      const data = part.inlineData?.data || part.inline_data?.data
      const mime = part.inlineData?.mimeType || part.inline_data?.mime_type || 'image/png'
      return data && /^image\/(png|jpeg|webp)$/.test(mime) ? [`data:${mime};base64,${data}`] : []
    })
    if (!images.length) {
      const reason = payload.candidates?.[0]?.finishReason || payload.candidates?.[0]?.blockReason || payload.promptFeedback?.blockReason
      const reply = responseParts.map(part => part.text).filter(Boolean).join(' ').slice(0, 160)
      return { imageUrls: [], status: response.status, detail: `未返回图片结果${reason ? `（上游原因 ${reason}）` : ''}${reply ? `：${reply}` : ''}，请调整提示词或参照图后重试` }
    }
    return { imageUrls: images, status: response.status, detail: '' }
  }

  private dedupReferences(request: ImageGenerationRequest, limit: number): string[] {
    if (limit <= 0) return []
    const all = [...(request.referenceImageUrls || []), request.referenceImageUrl || '']
      .filter(url => Boolean(url) && /^(https?:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(url))
    return [...new Set(all)].slice(0, limit)
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.apiKey) throw new Error('未配置 LINDUO_API_KEY')
    const profile = supportedModels[request.model]
    if (!profile) throw new Error(`未在零度API 生图模型目录中：${request.model}`)

    const completedBananaImages = new Map<string, string[]>()
    // 单次请求（不重试）：返回图片或失败状态，供上层按瞬时性策略重试
    const once = async (modelId: string): Promise<{ imageUrls: string[]; status: number; detail: string; skippedReferences?: number }> => {
      if (modelId === 'nano-banana-2' || modelId === 'nano-banana-pro') {
        const completed = completedBananaImages.get(modelId) || []
        completedBananaImages.set(modelId, completed)
        return this.generateBanana(request, modelId, completed)
      }
      const endpoint = `${this.resolveHost()}/images/generations`
      const referenceLimit = supportedModels[modelId]?.maxReferenceImages ?? 0
      const references = this.dedupReferences(request, referenceLimit)
      const body: Record<string, unknown> = {
        model: modelId,
        prompt: request.prompt,
        size: this.resolveSize(request.size, modelId),
        n: Math.max(1, Math.min(4, request.count)),
        response_format: 'url'
      }
      // 零度API 的 OpenAI 兼容层：参照图通过 image 字段（数组）传入，与火山方舟语义一致
      if (references.length > 0) body.image = references
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      const payload = await response.json().catch(() => ({})) as {
        data?: Array<{ url?: string; b64_json?: string }>
        error?: { message?: string; code?: string }
        message?: string
      }
      if (!response.ok) {
        return { imageUrls: [], status: response.status, detail: payload.error?.message || payload.message || payload.error?.code || response.statusText }
      }
      const imageUrls = (payload.data || [])
        .map(item => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : ''))
        .filter(url => Boolean(url))
      if (imageUrls.length === 0) return { imageUrls: [], status: response.status || 502, detail: '未返回图片结果' }
      return { imageUrls, status: response.status, detail: '' }
    }

    // 幂等重试：仅瞬时错误（分销通道轮换/过载），请求体不变重发
    const attempt = async (modelId: string): Promise<{ imageUrls: string[]; retries: number; status: number; detail: string; skippedReferences: number }> => {
      const delays = retryDelaysMs()
      let status = 0
      let detail = ''
      let skippedReferences = 0
      for (let index = 0; index <= delays.length; index += 1) {
        const result = await once(modelId)
        skippedReferences = result.skippedReferences ?? 0
        if (result.imageUrls.length) return { imageUrls: result.imageUrls, retries: index, status: 0, detail: '', skippedReferences }
        status = result.status
        detail = result.detail
        if (!isTransientLinduoFailure(status, detail) || index === delays.length) break
        await new Promise(resolve => setTimeout(resolve, delays[index]))
      }
      return { imageUrls: [], retries: delays.length, status, detail, skippedReferences }
    }

    // 零度链内逐级降级：当前模型 + 全部候选按参照能力排序，逐个尝试；整链无通道才由渲染器跨厂商恢复
    const needReferences = this.dedupReferences(request, 99).length
    const chain = [request.model, ...listLinduoFallbackChain(modelCatalog, request.model, needReferences)]
    const attempted: string[] = []
    const skipped: string[] = []

    for (const modelId of chain) {
      if (this.noChannelCache.isDead(modelId)) {
        skipped.push(modelId)
        continue
      }
      attempted.push(modelId)
      const outcome = await attempt(modelId)
      if (outcome.imageUrls.length) {
        const notices: string[] = []
        if (modelId !== request.model) {
          notices.push(`零度API 当前无 ${request.model} 通道，已改用 ${supportedModels[modelId].name} 完成本次生成。`)
        }
        if (outcome.retries > 0) notices.push(`零度API 通道瞬时不可用，已自动重试 ${outcome.retries} 次后成功。`)
        if (outcome.skippedReferences > 0) notices.push(`已跳过 ${outcome.skippedReferences} 张无法读取或超出大小限制的参照图后完成生成。`)
        return { taskId: `linduo-${Date.now()}`, imageUrls: outcome.imageUrls, model: modelId, notice: notices.join(' ') || undefined }
      }
      if (isNoChannelFailure(outcome.status, outcome.detail)) {
        this.noChannelCache.markDead(modelId)
        continue
      }
      // 鉴权/参数/模型不存在等错误换模型无意义：立即中文化报错（渲染器保留红条+动作按钮）
      throw new Error(humanizeLinduoImageError(`${modelId} 零度API 生图失败（HTTP ${outcome.status}）：${outcome.detail}`))
    }

    // 走到这里说明链上模型要么无通道要么 TTL 内已确认无通道
    throw new Error(linduoNoChannelErrorMessage(attempted, skipped))
  }
}
